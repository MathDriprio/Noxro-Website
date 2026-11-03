import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { query, tx } from '../db.js';
import { forbidden, id, notFound, parse } from '../http.js';
import { COLUMN, assertTargetUsable, pickTarget } from '../targets.js';

const KEYS = ['vehicleId', 'interventionId', 'transactionId', 'taskId', 'documentId'];
const body = z.string().trim().min(1, 'Le commentaire ne peut pas être vide.').max(5000, 'Commentaire trop long.');

const serialize = (r) => ({
  id: r.id,
  authorId: r.author_id,
  authorName: r.author_name,
  body: r.body,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  edited: r.updated_at.getTime() - r.created_at.getTime() > 1000,
});

const SELECT = `SELECT c.*, u.display_name AS author_name FROM comments c LEFT JOIN users u ON u.id = c.author_id`;

const router = Router();

router.get('/', async (req, res) => {
  const t = pickTarget(req.query, KEYS);
  const { rows } = await query(`${SELECT} WHERE c.${COLUMN[t.key]} = $1 ORDER BY c.created_at, c.id`, [t.value]);
  res.json({ comments: rows.map(serialize) });
});

router.post('/', async (req, res) => {
  const t = pickTarget(req.body ?? {}, KEYS);
  const { body: text } = parse(z.object({ body }).passthrough(), req.body);
  const created = await tx(async (c) => {
    await assertTargetUsable(c, t);
    const { rows } = await c.query(
      `INSERT INTO comments (author_id, body, ${COLUMN[t.key]}) VALUES ($1,$2,$3) RETURNING id`,
      [req.user.id, text, t.value],
    );
    await audit(c, req.user.id, 'create', 'comment', rows[0].id, { [t.key]: t.value });
    return (await c.query(`${SELECT} WHERE c.id = $1`, [rows[0].id])).rows[0];
  });
  res.status(201).json({ comment: serialize(created) });
});

async function loadOwned(c, cid, user, { allowAdmin }) {
  const { rows } = await c.query('SELECT * FROM comments WHERE id = $1', [cid]);
  if (!rows[0]) throw notFound('Commentaire');
  const isAuthor = rows[0].author_id === user.id;
  if (!isAuthor && !(allowAdmin && user.is_admin)) throw forbidden('Tu ne peux modifier que tes propres commentaires.');
  return rows[0];
}

router.patch('/:id', async (req, res) => {
  const cid = parse(id, req.params.id);
  const data = parse(z.object({ body }).strict(), req.body);
  const updated = await tx(async (c) => {
    await loadOwned(c, cid, req.user, { allowAdmin: false });
    await c.query('UPDATE comments SET body = $2, updated_at = now() WHERE id = $1', [cid, data.body]);
    await audit(c, req.user.id, 'update', 'comment', cid);
    return (await c.query(`${SELECT} WHERE c.id = $1`, [cid])).rows[0];
  });
  res.json({ comment: serialize(updated) });
});

router.delete('/:id', async (req, res) => {
  const cid = parse(id, req.params.id);
  await tx(async (c) => {
    await loadOwned(c, cid, req.user, { allowAdmin: true });
    await c.query('DELETE FROM comments WHERE id = $1', [cid]);
    await audit(c, req.user.id, 'delete', 'comment', cid);
  });
  res.status(204).end();
});

export default router;
