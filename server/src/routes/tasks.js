import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { query, tx } from '../db.js';
import { badRequest, id, isoDate, notFound, optText, parse, reqText } from '../http.js';
import { updateRow, where } from '../sql.js';
import { loadVehicle } from '../vehicles-common.js';

const STATUSES = ['a_faire', 'en_cours', 'fait'];
const PRIORITIES = ['basse', 'normale', 'haute'];

const base = {
  vehicleId: id.nullable().optional(),
  title: reqText(150),
  description: optText(5000),
  status: z.enum(STATUSES),
  priority: z.enum(PRIORITIES),
  dueDate: isoDate.nullable().optional(),
  assigneeId: id.nullable().optional(),
};
const createSchema = z.object({ ...base, status: base.status.default('a_faire'), priority: base.priority.default('normale') });
const updateSchema = z.object(Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v.optional()]))).strict();

const SELECT = `
  SELECT t.*, v.make || ' ' || v.model AS vehicle_name, u.display_name AS assignee_name
  FROM tasks t
  LEFT JOIN vehicles v ON v.id = t.vehicle_id
  LEFT JOIN users u ON u.id = t.assignee_id`;

const serialize = (r) => ({
  id: r.id,
  vehicleId: r.vehicle_id,
  vehicleName: r.vehicle_name,
  title: r.title,
  description: r.description,
  status: r.status,
  priority: r.priority,
  dueDate: r.due_date,
  assigneeId: r.assignee_id,
  assigneeName: r.assignee_name,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

async function loadTask(db, tid) {
  const { rows } = await db.query(`${SELECT} WHERE t.id = $1`, [tid]);
  if (!rows[0]) throw notFound('Tâche');
  return rows[0];
}

async function checkRefs(c, { vehicleId, assigneeId }) {
  if (vehicleId) {
    try { await loadVehicle(c, vehicleId, { active: true }); } catch (e) {
      if (e.status === 404) throw badRequest('Véhicule inconnu.', { vehicleId: 'Véhicule inconnu.' });
      throw e;
    }
  }
  if (assigneeId) {
    const { rowCount } = await c.query('SELECT 1 FROM users WHERE id = $1', [assigneeId]);
    if (!rowCount) throw badRequest('Utilisateur inconnu.', { assigneeId: 'Utilisateur inconnu.' });
  }
}

const router = Router();

router.get('/', async (req, res) => {
  const q = parse(z.object({
    vehicleId: id.optional(),
    status: z.enum([...STATUSES, 'open']).optional(),
    assigneeId: z.union([id, z.literal('me')]).optional(),
    general: z.enum(['true']).optional(),
  }), req.query);
  const w = where();
  w.add('(t.vehicle_id IS NULL OR v.deleted_at IS NULL OR t.vehicle_id = ?)', q.vehicleId ?? 0);
  if (q.vehicleId) w.add('t.vehicle_id = ?', q.vehicleId);
  if (q.general) w.add('t.vehicle_id IS NULL');
  if (q.status === 'open') w.add(`t.status <> 'fait'`);
  else if (q.status) w.add('t.status = ?', q.status);
  if (q.assigneeId) w.add('t.assignee_id = ?', q.assigneeId === 'me' ? req.user.id : q.assigneeId);
  const { rows } = await query(
    `${SELECT} ${w.clause()}
     ORDER BY (t.status = 'fait'), t.due_date ASC NULLS LAST,
              CASE t.priority WHEN 'haute' THEN 0 WHEN 'normale' THEN 1 ELSE 2 END, t.id DESC`,
    w.params,
  );
  res.json({ tasks: rows.map(serialize) });
});

router.post('/', async (req, res) => {
  const data = parse(createSchema, req.body);
  const created = await tx(async (c) => {
    await checkRefs(c, data);
    const { rows } = await c.query(
      `INSERT INTO tasks (vehicle_id, title, description, status, priority, due_date, assignee_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [data.vehicleId ?? null, data.title, data.description ?? null, data.status, data.priority,
        data.dueDate ?? null, data.assigneeId ?? null, req.user.id],
    );
    await audit(c, req.user.id, 'create', 'task', rows[0].id, { vehicleId: data.vehicleId ?? null });
    return loadTask(c, rows[0].id);
  });
  res.status(201).json({ task: serialize(created) });
});

router.get('/:id', async (req, res) => {
  res.json({ task: serialize(await loadTask({ query }, parse(id, req.params.id))) });
});

router.patch('/:id', async (req, res) => {
  const tid = parse(id, req.params.id);
  const data = parse(updateSchema, req.body);
  const updated = await tx(async (c) => {
    const cur = await loadTask(c, tid);
    if (cur.vehicle_id) await loadVehicle(c, cur.vehicle_id, { active: true });
    await checkRefs(c, data);
    await updateRow(c, 'tasks', tid, {
      vehicle_id: data.vehicleId, title: data.title, description: data.description,
      status: data.status, priority: data.priority, due_date: data.dueDate, assignee_id: data.assigneeId,
    });
    await audit(c, req.user.id, 'update', 'task', tid, { fields: Object.keys(data) });
    return loadTask(c, tid);
  });
  res.json({ task: serialize(updated) });
});

router.delete('/:id', async (req, res) => {
  const tid = parse(id, req.params.id);
  await tx(async (c) => {
    const cur = await loadTask(c, tid);
    if (cur.vehicle_id) await loadVehicle(c, cur.vehicle_id, { active: true });
    await c.query('DELETE FROM tasks WHERE id = $1', [tid]);
    await audit(c, req.user.id, 'delete', 'task', tid, { title: cur.title });
  });
  res.status(204).end();
});

export default router;
