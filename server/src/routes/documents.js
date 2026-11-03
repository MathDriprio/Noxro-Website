import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { z } from 'zod';
import { audit } from '../audit.js';
import { config } from '../config.js';
import { query, tx } from '../db.js';
import { badRequest, id, notFound, optText, parse } from '../http.js';
import { COLUMN, assertTargetUsable, pickTarget } from '../targets.js';

const CATEGORIES = ['facture', 'carte_grise', 'photo', 'administratif', 'autre'];
const LINK_KEYS = ['vehicleId', 'interventionId', 'transactionId', 'taskId', 'userId'];
const uploadDir = path.resolve(config.uploadDir);
const thumbDir = path.join(uploadDir, '.thumbs');
await fsp.mkdir(thumbDir, { recursive: true });
sharp.concurrency(2); // évite de saturer un petit VPS quand une page demande beaucoup de vignettes d'un coup

// Largeurs de vignettes autorisées (liste fermée : évite de générer n'importe quelle taille à la demande)
const THUMB_WIDTHS = [320, 640, 1280, 1920];
const DEFAULT_THUMB = 640;

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, _file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: config.maxFileBytes, files: 20 },
  defParamCharset: 'utf8',
});

// Types que le navigateur peut afficher sans risque (détectés par signature, pas par l'en-tête client).
const INLINE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'application/pdf']);

async function sniffMime(file) {
  const fh = await fsp.open(file, 'r');
  const buf = Buffer.alloc(16);
  await fh.read(buf, 0, 16, 0);
  await fh.close();
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('latin1');
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  return null;
}

const SELECT = `
  SELECT d.*, u.display_name AS uploader_name,
    COALESCE((SELECT json_agg(json_build_object(
        'type', CASE WHEN l.vehicle_id IS NOT NULL THEN 'vehicle' WHEN l.intervention_id IS NOT NULL THEN 'intervention'
                     WHEN l.transaction_id IS NOT NULL THEN 'transaction' WHEN l.task_id IS NOT NULL THEN 'task' ELSE 'user' END,
        'id', COALESCE(l.vehicle_id, l.intervention_id, l.transaction_id, l.task_id, l.user_id)))
      FROM document_links l WHERE l.document_id = d.id), '[]'::json) AS links
  FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by`;

// Visible = sans lien (document général) ou lié à au moins un élément qui n'appartient pas à un véhicule supprimé.
const VISIBLE = `(
  NOT EXISTS (SELECT 1 FROM document_links l WHERE l.document_id = d.id)
  OR EXISTS (SELECT 1 FROM document_links l WHERE l.document_id = d.id AND (
    l.user_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM vehicles v WHERE v.id = l.vehicle_id AND v.deleted_at IS NULL)
    OR EXISTS (SELECT 1 FROM interventions i JOIN vehicles v ON v.id = i.vehicle_id WHERE i.id = l.intervention_id AND v.deleted_at IS NULL)
    OR EXISTS (SELECT 1 FROM transactions t LEFT JOIN vehicles v ON v.id = t.vehicle_id WHERE t.id = l.transaction_id AND (v.id IS NULL OR v.deleted_at IS NULL))
    OR EXISTS (SELECT 1 FROM tasks t LEFT JOIN vehicles v ON v.id = t.vehicle_id WHERE t.id = l.task_id AND (v.id IS NULL OR v.deleted_at IS NULL))
  ))
)`;

const isImageMime = (m) => m.startsWith('image/') && INLINE_TYPES.has(m);
const thumbFile = (storedName, w) => path.join(thumbDir, `${storedName}-${w}.webp`);
const inFlight = new Map();

/** Crée (une seule fois) la vignette WebP d'une image ; renvoie son chemin. Les originaux ne sont jamais modifiés. */
function ensureThumb(storedName, w) {
  const target = thumbFile(storedName, w);
  if (!inFlight.has(target)) {
    const job = (async () => {
      try { await fsp.access(target); return target; } catch { /* pas encore créée */ }
      await fsp.mkdir(thumbDir, { recursive: true });
      const tmp = `${target}.${process.pid}.tmp`;
      await sharp(path.join(uploadDir, storedName)).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 78 }).toFile(tmp);
      await fsp.rename(tmp, target);
      return target;
    })().finally(() => inFlight.delete(target));
    inFlight.set(target, job);
  }
  return inFlight.get(target);
}

const removeThumbs = (storedName) => Promise.all(THUMB_WIDTHS.map((w) => fsp.rm(thumbFile(storedName, w), { force: true })));

const serialize = (r) => ({
  id: r.id,
  originalName: r.original_name,
  title: r.title,
  mimeType: r.mime_type,
  sizeBytes: r.size_bytes,
  category: r.category,
  isImage: isImageMime(r.mime_type),
  url: `/api/documents/${r.id}/file`,
  thumbUrl: isImageMime(r.mime_type) ? `/api/documents/${r.id}/thumb` : null,
  uploadedBy: r.uploaded_by,
  uploadedByName: r.uploader_name,
  createdAt: r.created_at,
  links: r.links,
});

async function loadDocument(db, did) {
  const { rows } = await db.query(`${SELECT} WHERE d.id = $1`, [did]);
  if (!rows[0]) throw notFound('Document');
  return rows[0];
}

const router = Router();

router.get('/', async (req, res) => {
  const q = parse(z.object({
    vehicleId: id.optional(),
    interventionId: id.optional(),
    transactionId: id.optional(),
    taskId: id.optional(),
    userId: id.optional(),
    general: z.enum(['true']).optional(),
    category: z.enum(CATEGORIES).optional(),
    include: z.enum(['children']).optional(),
    q: z.string().trim().max(100).optional(),
  }), req.query);

  const conds = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };

  if (q.vehicleId) {
    // Les documents d'un véhicule visible même si le véhicule est supprimé (page "supprimés").
    const direct = `EXISTS (SELECT 1 FROM document_links l WHERE l.document_id = d.id AND l.vehicle_id = ${p(q.vehicleId)})`;
    if (q.include === 'children') {
      const vid = `$${params.length}`;
      conds.push(`(${direct}
        OR EXISTS (SELECT 1 FROM document_links l JOIN interventions i ON i.id = l.intervention_id WHERE l.document_id = d.id AND i.vehicle_id = ${vid})
        OR EXISTS (SELECT 1 FROM document_links l JOIN transactions t ON t.id = l.transaction_id WHERE l.document_id = d.id AND t.vehicle_id = ${vid})
        OR EXISTS (SELECT 1 FROM document_links l JOIN tasks t ON t.id = l.task_id WHERE l.document_id = d.id AND t.vehicle_id = ${vid}))`);
    } else conds.push(direct);
  } else {
    conds.push(VISIBLE);
  }
  for (const [key, col] of [['interventionId', 'intervention_id'], ['transactionId', 'transaction_id'], ['taskId', 'task_id'], ['userId', 'user_id']]) {
    if (q[key]) conds.push(`EXISTS (SELECT 1 FROM document_links l WHERE l.document_id = d.id AND l.${col} = ${p(q[key])})`);
  }
  if (q.general) conds.push('NOT EXISTS (SELECT 1 FROM document_links l WHERE l.document_id = d.id)');
  if (q.category) conds.push(`d.category = ${p(q.category)}`);
  if (q.q) conds.push(`(d.original_name ILIKE ${p(`%${q.q.replace(/[\\%_]/g, '\\$&')}%`)} OR d.title ILIKE $${params.length})`);

  const { rows } = await query(
    `${SELECT} ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''} ORDER BY d.created_at DESC, d.id DESC`, params);
  res.json({ documents: rows.map(serialize) });
});

router.post('/', upload.array('files', 20), async (req, res) => {
  const files = req.files ?? [];
  const cleanup = () => Promise.all(files.map((f) => fsp.rm(f.path, { force: true })));
  try {
    if (!files.length) throw badRequest('Aucun fichier envoyé.', { files: 'Choisis au moins un fichier.' });
    const meta = parse(z.object({
      category: z.enum(CATEGORIES).default('autre'),
      title: optText(150),
    }).passthrough(), req.body ?? {});
    const hasTarget = LINK_KEYS.some((k) => req.body?.[k] !== undefined && req.body[k] !== '');
    const target = hasTarget ? pickTarget(req.body, LINK_KEYS) : null;

    const created = await tx(async (c) => {
      if (target) await assertTargetUsable(c, target);
      const out = [];
      for (const f of files) {
        const sniffed = await sniffMime(f.path);
        // Le type affichable vient de la signature du fichier, jamais de l'en-tête client.
        const declared = f.mimetype || 'application/octet-stream';
        const mime = sniffed ?? (INLINE_TYPES.has(declared) ? 'application/octet-stream' : declared);
        // Une "photo" doit réellement être une image.
        const category = meta.category === 'photo' && !sniffed?.startsWith('image/') ? 'autre' : meta.category;
        const { rows } = await c.query(
          `INSERT INTO documents (original_name, stored_name, mime_type, size_bytes, category, title, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [f.originalname.slice(0, 255), f.filename, mime, f.size, category, files.length === 1 ? (meta.title ?? null) : null, req.user.id],
        );
        if (target) {
          await c.query(`INSERT INTO document_links (document_id, ${COLUMN[target.key]}) VALUES ($1,$2)`, [rows[0].id, target.value]);
        }
        await audit(c, req.user.id, 'create', 'document', rows[0].id, { name: f.originalname, ...(target ? { [target.key]: target.value } : {}) });
        out.push(rows[0].id);
      }
      return Promise.all(out.map((did) => loadDocument(c, did)));
    });
    res.status(201).json({ documents: created.map(serialize) });
    for (const d of created.filter((x) => isImageMime(x.mime_type))) {
      ensureThumb(d.stored_name, 320).catch(() => {});
      ensureThumb(d.stored_name, DEFAULT_THUMB).catch(() => {});
    }
  } catch (err) {
    await cleanup();
    throw err;
  }
});

router.get('/:id', async (req, res) => {
  res.json({ document: serialize(await loadDocument({ query }, parse(id, req.params.id))) });
});

router.get('/:id/file', async (req, res) => {
  const doc = await loadDocument({ query }, parse(id, req.params.id));
  const file = path.join(uploadDir, doc.stored_name);
  try { await fsp.access(file); } catch { throw notFound('Fichier'); }
  const inline = INLINE_TYPES.has(doc.mime_type) && req.query.download !== '1';
  res.type(INLINE_TYPES.has(doc.mime_type) ? doc.mime_type : 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(doc.original_name)}`);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  fs.createReadStream(file).pipe(res);
});

router.get('/:id/thumb', async (req, res) => {
  const doc = await loadDocument({ query }, parse(id, req.params.id));
  const { w } = parse(z.object({ w: z.coerce.number().refine((n) => THUMB_WIDTHS.includes(n), `Largeur autorisée : ${THUMB_WIDTHS.join(', ')}.`).default(DEFAULT_THUMB) }), req.query);
  if (!isImageMime(doc.mime_type)) throw notFound('Miniature');
  let file;
  try {
    file = await ensureThumb(doc.stored_name, w);
  } catch (err) {
    console.error(`miniature impossible (document ${doc.id}) :`, err.message);
    return res.redirect(`/api/documents/${doc.id}/file`); // image illisible pour sharp : on sert l'original
  }
  res.type('image/webp');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable'); // le contenu d'un document ne change jamais
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
  fs.createReadStream(file).pipe(res);
});

router.patch('/:id', async (req, res) => {
  const did = parse(id, req.params.id);
  const data = parse(z.object({ title: optText(150), category: z.enum(CATEGORIES).optional() }).strict(), req.body);
  const updated = await tx(async (c) => {
    await loadDocument(c, did);
    await c.query('UPDATE documents SET title = COALESCE($2, title), category = COALESCE($3, category) WHERE id = $1',
      [did, data.title === undefined ? null : data.title, data.category ?? null]);
    await audit(c, req.user.id, 'update', 'document', did, { fields: Object.keys(data) });
    return loadDocument(c, did);
  });
  res.json({ document: serialize(updated) });
});

router.post('/:id/links', async (req, res) => {
  const did = parse(id, req.params.id);
  const target = pickTarget(req.body ?? {}, LINK_KEYS);
  const updated = await tx(async (c) => {
    await loadDocument(c, did);
    await assertTargetUsable(c, target);
    await c.query(`INSERT INTO document_links (document_id, ${COLUMN[target.key]}) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [did, target.value]);
    await audit(c, req.user.id, 'link', 'document', did, { [target.key]: target.value });
    return loadDocument(c, did);
  });
  res.json({ document: serialize(updated) });
});

router.delete('/:id/links', async (req, res) => {
  const did = parse(id, req.params.id);
  const target = pickTarget(req.query, LINK_KEYS);
  const updated = await tx(async (c) => {
    await loadDocument(c, did);
    await c.query(`DELETE FROM document_links WHERE document_id = $1 AND ${COLUMN[target.key]} = $2`, [did, target.value]);
    await audit(c, req.user.id, 'unlink', 'document', did, { [target.key]: target.value });
    return loadDocument(c, did);
  });
  res.json({ document: serialize(updated) });
});

router.delete('/:id', async (req, res) => {
  const did = parse(id, req.params.id);
  const doc = await tx(async (c) => {
    const d = await loadDocument(c, did);
    await c.query('DELETE FROM documents WHERE id = $1', [did]);
    await audit(c, req.user.id, 'delete', 'document', did, { name: d.original_name });
    return d;
  });
  await fsp.rm(path.join(uploadDir, doc.stored_name), { force: true });
  await removeThumbs(doc.stored_name);
  res.status(204).end();
});

export default router;
