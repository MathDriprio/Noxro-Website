import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { query, tx } from '../db.js';
import { badRequest, id, isoDate, notFound, optText, parse, reqText } from '../http.js';
import { updateRow, where } from '../sql.js';
import { loadVehicle } from '../vehicles-common.js';

const KINDS = ['entretien', 'reparation'];
const STATUSES = ['planifie', 'en_cours', 'termine', 'annule'];

const base = {
  kind: z.enum(KINDS),
  category: optText(80),
  title: reqText(150),
  description: optText(5000),
  status: z.enum(STATUSES),
  plannedDate: isoDate.nullable().optional(),
  doneDate: isoDate.nullable().optional(),
};
const createSchema = z.object({ ...base, status: base.status.default('planifie') });
const updateSchema = z.object(Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v.optional()]))).strict();

const COLUMNS = { kind: 'kind', category: 'category', title: 'title', description: 'description', status: 'status', plannedDate: 'planned_date', doneDate: 'done_date' };
const pick = (data) => Object.fromEntries(Object.entries(COLUMNS).map(([k, col]) => [col, data[k]]));

export const serialize = (r) => ({
  id: r.id,
  vehicleId: r.vehicle_id,
  vehicleName: r.vehicle_name,
  kind: r.kind,
  category: r.category,
  title: r.title,
  description: r.description,
  status: r.status,
  plannedDate: r.planned_date,
  doneDate: r.done_date,
  totalCost: r.total_cost == null ? undefined : r.total_cost / 100,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const SELECT = `
  SELECT i.*, v.make || ' ' || v.model AS vehicle_name,
    COALESCE((SELECT sum(CASE WHEN t.direction = 'depense' THEN t.amount_cents ELSE -t.amount_cents END)
              FROM transactions t WHERE t.intervention_id = i.id), 0) AS total_cost
  FROM interventions i JOIN vehicles v ON v.id = i.vehicle_id`;

/** Règles croisées, appliquées sur l'état final (création ou fusion avec l'existant). */
function checkRules(state) {
  if (state.status === 'planifie' && !state.planned_date) {
    throw badRequest('Une intervention planifiée doit avoir une date.', { plannedDate: 'Date obligatoire pour une intervention planifiée.' });
  }
}

export async function loadIntervention(db, iid) {
  const { rows } = await db.query(`${SELECT} WHERE i.id = $1`, [iid]);
  if (!rows[0]) throw notFound('Intervention');
  return rows[0];
}

// --- /api/interventions ---
const router = Router();

router.get('/', async (req, res) => {
  const q = parse(z.object({
    vehicleId: id.optional(),
    status: z.enum(STATUSES).optional(),
    kind: z.enum(KINDS).optional(),
    upcoming: z.enum(['true']).optional(),
  }), req.query);
  const w = where();
  w.add('v.deleted_at IS NULL');
  if (q.vehicleId) w.add('i.vehicle_id = ?', q.vehicleId);
  if (q.status) w.add('i.status = ?', q.status);
  if (q.kind) w.add('i.kind = ?', q.kind);
  if (q.upcoming) w.add(`i.status = 'planifie' AND i.planned_date >= current_date`);
  const order = q.upcoming ? 'i.planned_date ASC, i.id' : 'COALESCE(i.done_date, i.planned_date, i.created_at::date) DESC, i.id DESC';
  const { rows } = await query(`${SELECT} ${w.clause()} ORDER BY ${order}`, w.params);
  res.json({ interventions: rows.map(serialize) });
});

router.get('/:id', async (req, res) => {
  res.json({ intervention: serialize(await loadIntervention({ query }, parse(id, req.params.id))) });
});

router.patch('/:id', async (req, res) => {
  const iid = parse(id, req.params.id);
  const data = parse(updateSchema, req.body);
  const result = await tx(async (c) => {
    const cur = await loadIntervention(c, iid);
    await loadVehicle(c, cur.vehicle_id, { active: true });
    const merged = { ...cur, ...Object.fromEntries(Object.entries(pick(data)).filter(([, v]) => v !== undefined)) };
    if (data.status === 'termine' && !merged.done_date) merged.done_date = new Date().toISOString().slice(0, 10);
    checkRules(merged);
    await updateRow(c, 'interventions', iid, { ...pick(data), done_date: merged.done_date });
    await audit(c, req.user.id, 'update', 'intervention', iid, { fields: Object.keys(data) });
    return loadIntervention(c, iid);
  });
  res.json({ intervention: serialize(result) });
});

router.delete('/:id', async (req, res) => {
  const iid = parse(id, req.params.id);
  await tx(async (c) => {
    const cur = await loadIntervention(c, iid);
    await loadVehicle(c, cur.vehicle_id, { active: true });
    await c.query('DELETE FROM interventions WHERE id = $1', [iid]);
    await audit(c, req.user.id, 'delete', 'intervention', iid, { vehicleId: cur.vehicle_id, title: cur.title });
  });
  res.status(204).end();
});

// --- /api/vehicles/:id/interventions (monté séparément) ---
export const vehicleInterventions = Router({ mergeParams: true });

vehicleInterventions.get('/', async (req, res) => {
  const vid = parse(id, req.params.vehicleId);
  await loadVehicle({ query }, vid);
  const { rows } = await query(
    `${SELECT} WHERE i.vehicle_id = $1 ORDER BY COALESCE(i.done_date, i.planned_date, i.created_at::date) DESC, i.id DESC`, [vid]);
  res.json({ interventions: rows.map(serialize) });
});

vehicleInterventions.post('/', async (req, res) => {
  const vid = parse(id, req.params.vehicleId);
  const data = parse(createSchema, req.body);
  const created = await tx(async (c) => {
    await loadVehicle(c, vid, { active: true });
    const state = { ...pick(data) };
    if (state.status === 'termine' && !state.done_date) state.done_date = new Date().toISOString().slice(0, 10);
    checkRules(state);
    const { rows } = await c.query(
      `INSERT INTO interventions (vehicle_id, kind, category, title, description, status, planned_date, done_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [vid, state.kind, state.category ?? null, state.title, state.description ?? null, state.status,
        state.planned_date ?? null, state.done_date ?? null, req.user.id],
    );
    await audit(c, req.user.id, 'create', 'intervention', rows[0].id, { vehicleId: vid });
    return loadIntervention(c, rows[0].id);
  });
  res.status(201).json({ intervention: serialize(created) });
});

export default router;
