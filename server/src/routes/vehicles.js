import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { query, tx } from '../db.js';
import { conflict, id, optText, parse, reqText, badRequest } from '../http.js';
import { updateRow, where } from '../sql.js';
import {
  VEHICLE_SELECT, loadVehicle, normalizePlate, serializeVehicle, setOwners,
} from '../vehicles-common.js';

const router = Router();

const STATUSES = ['sur_place', 'en_vue', 'terminee', 'en_vente'];

const plate = z.string().trim().max(20).nullable().optional()
  .transform((p) => normalizePlate(p))
  .refine((p) => p == null || p.length >= 4, 'Immatriculation trop courte.');
const vin = z.string().trim().max(30).nullable().optional()
  .transform((v) => (v ? v.toUpperCase().replace(/\s/g, '') : null))
  .refine((v) => v == null || /^[A-Z0-9]{5,30}$/.test(v), 'Numéro de série invalide.');
const year = z.coerce.number().int('Année invalide.').min(1885, 'Année invalide.').max(new Date().getFullYear() + 1, 'Année invalide.')
  .nullable().optional();

const base = {
  make: reqText(60),
  model: reqText(80),
  year,
  plate,
  vin,
  engine: optText(100),
  color: optText(50),
  notes: optText(5000),
  status: z.enum(STATUSES),
};
const createSchema = z.object({
  ...base,
  status: base.status.default('sur_place'),
  ownerIds: z.array(id).max(20).optional(),
});
const updateSchema = z.object({
  ...Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v.optional()])),
  coverDocumentId: id.nullable().optional(),
}).strict();

const COLUMNS = { make: 'make', model: 'model', year: 'year', plate: 'plate', vin: 'vin', engine: 'engine', color: 'color', notes: 'notes', status: 'status' };
const pick = (data) => Object.fromEntries(Object.entries(COLUMNS).map(([k, col]) => [col, data[k]]));

router.get('/counts', async (_req, res) => {
  const { rows } = await query(
    `SELECT status, count(*)::int AS n FROM vehicles WHERE deleted_at IS NULL GROUP BY status`,
  );
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const r of rows) counts[r.status] = r.n;
  const deleted = (await query('SELECT count(*)::int AS n FROM vehicles WHERE deleted_at IS NOT NULL')).rows[0].n;
  res.json({ ...counts, all: Object.values(counts).reduce((a, b) => a + b, 0), deleted });
});

router.get('/', async (req, res) => {
  const q = parse(z.object({
    status: z.enum([...STATUSES, 'all']).default('all'),
    deleted: z.enum(['true', 'false']).default('false'),
    owner: z.string().regex(/^(me|garage|\d+)$/, 'Filtre propriétaire invalide.').optional(),
    q: z.string().trim().max(100).optional(),
  }), req.query);

  const w = where();
  w.add(q.deleted === 'true' ? 'v.deleted_at IS NOT NULL' : 'v.deleted_at IS NULL');
  if (q.status !== 'all') w.add('v.status = ?', q.status);
  if (q.owner === 'garage') {
    w.add('NOT EXISTS (SELECT 1 FROM vehicle_owners o WHERE o.vehicle_id = v.id AND o.until IS NULL)');
  } else if (q.owner) {
    w.add('EXISTS (SELECT 1 FROM vehicle_owners o WHERE o.vehicle_id = v.id AND o.until IS NULL AND o.user_id = ?)',
      q.owner === 'me' ? req.user.id : Number(q.owner));
  }
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, '\\$&')}%`;
    w.add(`(v.make ILIKE ? OR v.model ILIKE ? OR v.plate ILIKE ? OR v.vin ILIKE ?
            OR (v.make || ' ' || v.model) ILIKE ?)`, like, like, `%${normalizePlate(q.q) ?? '\u0000'}%`, like, like);
  }
  const { rows } = await query(`${VEHICLE_SELECT} ${w.clause()} ORDER BY v.created_at DESC, v.id DESC`, w.params);
  res.json({ vehicles: rows.map(serializeVehicle) });
});

router.post('/', async (req, res) => {
  const data = parse(createSchema, req.body);
  const { vehicle, reactivated } = await tx(async (c) => {
    let reactivated = false;
    let vehicleId;
    if (data.plate) {
      const { rows } = await c.query('SELECT id, deleted_at FROM vehicles WHERE plate = $1 FOR UPDATE', [data.plate]);
      if (rows[0]) {
        if (!rows[0].deleted_at) {
          throw Object.assign(conflict('Un véhicule avec cette immatriculation existe déjà.', 'plate_taken'),
            { fields: { plate: 'Un véhicule avec cette immatriculation existe déjà.' } });
        }
        // Immatriculation d'un véhicule supprimé : on le réactive au lieu de créer un doublon.
        vehicleId = rows[0].id;
        await updateRow(c, 'vehicles', vehicleId, { ...pick(data), deleted_at: null });
        reactivated = true;
        await audit(c, req.user.id, 'restore', 'vehicle', vehicleId, { reason: 'plate_reused' });
      }
    }
    if (!vehicleId) {
      const cols = Object.keys(COLUMNS).map((k) => COLUMNS[k]);
      const { rows } = await c.query(
        `INSERT INTO vehicles (${cols.join(', ')}, created_by) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1}) RETURNING id`,
        [...Object.keys(COLUMNS).map((k) => data[k] ?? null), req.user.id],
      );
      vehicleId = rows[0].id;
      await audit(c, req.user.id, 'create', 'vehicle', vehicleId);
    }
    if (data.ownerIds) await setOwners(c, vehicleId, data.ownerIds);
    return { vehicle: await loadVehicle(c, vehicleId), reactivated };
  });
  res.status(reactivated ? 200 : 201).json({ vehicle: serializeVehicle(vehicle), reactivated });
});

router.get('/:id', async (req, res) => {
  const vid = parse(id, req.params.id);
  const v = await loadVehicle({ query }, vid);
  const [stats, history] = await Promise.all([
    query(
      `SELECT
         COALESCE((SELECT sum(amount_cents) FROM transactions WHERE vehicle_id = $1 AND direction = 'depense'), 0) AS expenses,
         COALESCE((SELECT sum(amount_cents) FROM transactions WHERE vehicle_id = $1 AND direction = 'revenu'), 0) AS revenue,
         (SELECT count(*) FROM interventions WHERE vehicle_id = $1)::int AS interventions,
         (SELECT count(*) FROM tasks WHERE vehicle_id = $1 AND status <> 'fait')::int AS open_tasks,
         (SELECT count(*) FROM document_links WHERE vehicle_id = $1)::int AS documents,
         (SELECT count(*) FROM comments WHERE vehicle_id = $1)::int AS comments`,
      [vid],
    ),
    query(
      `SELECT o.user_id, u.display_name, o.since, o.until FROM vehicle_owners o
       JOIN users u ON u.id = o.user_id WHERE o.vehicle_id = $1 ORDER BY o.since DESC, o.id DESC`,
      [vid],
    ),
  ]);
  const s = stats.rows[0];
  res.json({
    vehicle: serializeVehicle(v),
    stats: {
      expenses: s.expenses / 100,
      revenue: s.revenue / 100,
      net: (s.revenue - s.expenses) / 100,
      interventions: s.interventions,
      openTasks: s.open_tasks,
      documents: s.documents,
      comments: s.comments,
    },
    ownerHistory: history.rows.map((r) => ({ userId: r.user_id, displayName: r.display_name, since: r.since, until: r.until })),
  });
});

router.patch('/:id', async (req, res) => {
  const vid = parse(id, req.params.id);
  const data = parse(updateSchema, req.body);
  const updated = await tx(async (c) => {
    const current = await loadVehicle(c, vid, { active: true, lock: true });
    if (data.plate && data.plate !== current.plate) {
      const dup = await c.query('SELECT 1 FROM vehicles WHERE plate = $1 AND id <> $2', [data.plate, vid]);
      if (dup.rowCount) {
        throw Object.assign(conflict('Un véhicule avec cette immatriculation existe déjà.', 'plate_taken'),
          { fields: { plate: 'Un véhicule avec cette immatriculation existe déjà.' } });
      }
    }
    if (data.coverDocumentId) {
      const ok = await c.query('SELECT 1 FROM document_links WHERE vehicle_id = $1 AND document_id = $2', [vid, data.coverDocumentId]);
      if (!ok.rowCount) throw badRequest('La photo principale doit être un document de ce véhicule.', { coverDocumentId: 'Document non lié à ce véhicule.' });
    }
    const fields = { ...pick(data), cover_document_id: data.coverDocumentId };
    await updateRow(c, 'vehicles', vid, fields);
    const changed = Object.keys(data);
    await audit(c, req.user.id, 'update', 'vehicle', vid, { fields: changed });
    return loadVehicle(c, vid);
  });
  res.json({ vehicle: serializeVehicle(updated) });
});

router.put('/:id/owners', async (req, res) => {
  const vid = parse(id, req.params.id);
  const { userIds } = parse(z.object({ userIds: z.array(id).max(20) }), req.body);
  const updated = await tx(async (c) => {
    await loadVehicle(c, vid, { active: true, lock: true });
    await setOwners(c, vid, userIds);
    await audit(c, req.user.id, 'update', 'vehicle', vid, { owners: userIds });
    return loadVehicle(c, vid);
  });
  res.json({ vehicle: serializeVehicle(updated) });
});

// Suppression douce : rien n'est effacé, le véhicule est seulement masqué.
router.delete('/:id', async (req, res) => {
  const vid = parse(id, req.params.id);
  await tx(async (c) => {
    await loadVehicle(c, vid, { active: true, lock: true });
    await c.query('UPDATE vehicles SET deleted_at = now(), updated_at = now() WHERE id = $1', [vid]);
    await audit(c, req.user.id, 'delete', 'vehicle', vid);
  });
  res.status(204).end();
});

router.post('/:id/restore', async (req, res) => {
  const vid = parse(id, req.params.id);
  const v = await tx(async (c) => {
    const cur = await loadVehicle(c, vid, { lock: true });
    if (!cur.deleted_at) throw conflict('Ce véhicule n\'est pas supprimé.', 'not_deleted');
    await c.query('UPDATE vehicles SET deleted_at = NULL, updated_at = now() WHERE id = $1', [vid]);
    await audit(c, req.user.id, 'restore', 'vehicle', vid);
    return loadVehicle(c, vid);
  });
  res.json({ vehicle: serializeVehicle(v) });
});

export default router;
