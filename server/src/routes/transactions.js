import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { query, tx } from '../db.js';
import { badRequest, id, isoDate, notFound, optText, parse, reqText } from '../http.js';
import { updateRow, where } from '../sql.js';
import { loadVehicle } from '../vehicles-common.js';

const CATEGORIES = ['piece', 'reparation', 'entretien', 'achat_vehicule', 'vente_vehicule', 'frais_garage', 'autre'];
const DIRECTIONS = ['depense', 'revenu'];

// Montant saisi en euros, 2 décimales max.
const amount = z.coerce.number('Montant invalide.')
  .positive('Le montant doit être supérieur à 0.')
  .max(10_000_000, 'Montant trop élevé.')
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Deux décimales maximum.');

const base = {
  vehicleId: id.nullable().optional(),
  interventionId: id.nullable().optional(),
  direction: z.enum(DIRECTIONS),
  category: z.enum(CATEGORIES),
  label: reqText(150),
  amount,
  occurredOn: isoDate,
  notes: optText(2000),
};
const createSchema = z.object({
  ...base,
  direction: base.direction.default('depense'),
  category: base.category.default('autre'),
  occurredOn: base.occurredOn.default(() => new Date().toISOString().slice(0, 10)),
});
const updateSchema = z.object(Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v.optional()]))).strict();

const serialize = (r) => ({
  id: r.id,
  vehicleId: r.vehicle_id,
  vehicleName: r.vehicle_name,
  interventionId: r.intervention_id,
  interventionTitle: r.intervention_title,
  direction: r.direction,
  category: r.category,
  label: r.label,
  amount: r.amount_cents / 100,
  occurredOn: r.occurred_on,
  notes: r.notes,
  documentCount: r.document_count,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const SELECT = `
  SELECT t.*, v.make || ' ' || v.model AS vehicle_name, i.title AS intervention_title,
    (SELECT count(*) FROM document_links l WHERE l.transaction_id = t.id)::int AS document_count
  FROM transactions t
  LEFT JOIN vehicles v ON v.id = t.vehicle_id
  LEFT JOIN interventions i ON i.id = t.intervention_id`;

async function loadTransaction(db, tid) {
  const { rows } = await db.query(`${SELECT} WHERE t.id = $1`, [tid]);
  if (!rows[0]) throw notFound('Transaction');
  return rows[0];
}

/** Résout vehicle_id / intervention_id cohérents ; vérifie que le véhicule est actif. */
async function resolveLinks(c, vehicleId, interventionId) {
  if (interventionId) {
    const { rows } = await c.query('SELECT vehicle_id FROM interventions WHERE id = $1', [interventionId]);
    if (!rows[0]) throw badRequest('Intervention inconnue.', { interventionId: 'Intervention inconnue.' });
    if (vehicleId && vehicleId !== rows[0].vehicle_id) {
      throw badRequest('Cette intervention concerne un autre véhicule.', { interventionId: 'Intervention d\'un autre véhicule.' });
    }
    vehicleId = rows[0].vehicle_id;
  }
  if (vehicleId) {
    try { await loadVehicle(c, vehicleId, { active: true }); } catch (e) {
      if (e.status === 404) throw badRequest('Véhicule inconnu.', { vehicleId: 'Véhicule inconnu.' });
      throw e;
    }
  }
  return { vehicleId: vehicleId ?? null, interventionId: interventionId ?? null };
}

const router = Router();

router.get('/', async (req, res) => {
  const q = parse(z.object({
    vehicleId: id.optional(),
    interventionId: id.optional(),
    general: z.enum(['true']).optional(),
    category: z.enum(CATEGORIES).optional(),
    direction: z.enum(DIRECTIONS).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  }), req.query);
  const w = where();
  w.add('(t.vehicle_id IS NULL OR v.deleted_at IS NULL OR t.vehicle_id = ?)', q.vehicleId ?? 0);
  if (q.vehicleId) w.add('t.vehicle_id = ?', q.vehicleId);
  if (q.interventionId) w.add('t.intervention_id = ?', q.interventionId);
  if (q.general) w.add('t.vehicle_id IS NULL');
  if (q.category) w.add('t.category = ?', q.category);
  if (q.direction) w.add('t.direction = ?', q.direction);
  if (q.from) w.add('t.occurred_on >= ?', q.from);
  if (q.to) w.add('t.occurred_on <= ?', q.to);
  const { rows } = await query(`${SELECT} ${w.clause()} ORDER BY t.occurred_on DESC, t.id DESC`, w.params);
  const sum = (dir) => rows.filter((r) => r.direction === dir).reduce((a, r) => a + r.amount_cents, 0) / 100;
  const totals = { expenses: sum('depense'), revenue: sum('revenu') };
  totals.net = Math.round((totals.revenue - totals.expenses) * 100) / 100;
  res.json({ transactions: rows.map(serialize), totals });
});

router.post('/', async (req, res) => {
  const data = parse(createSchema, req.body);
  const created = await tx(async (c) => {
    const links = await resolveLinks(c, data.vehicleId, data.interventionId);
    const { rows } = await c.query(
      `INSERT INTO transactions (vehicle_id, intervention_id, direction, category, label, amount_cents, occurred_on, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [links.vehicleId, links.interventionId, data.direction, data.category, data.label,
        Math.round(data.amount * 100), data.occurredOn, data.notes ?? null, req.user.id],
    );
    await audit(c, req.user.id, 'create', 'transaction', rows[0].id, { vehicleId: links.vehicleId, amount: data.amount });
    return loadTransaction(c, rows[0].id);
  });
  res.status(201).json({ transaction: serialize(created) });
});

router.get('/:id', async (req, res) => {
  res.json({ transaction: serialize(await loadTransaction({ query }, parse(id, req.params.id))) });
});

router.patch('/:id', async (req, res) => {
  const tid = parse(id, req.params.id);
  const data = parse(updateSchema, req.body);
  const updated = await tx(async (c) => {
    const cur = await loadTransaction(c, tid);
    if (cur.vehicle_id) await loadVehicle(c, cur.vehicle_id, { active: true });
    const touchesLinks = data.vehicleId !== undefined || data.interventionId !== undefined;
    const links = touchesLinks
      ? await resolveLinks(
        c,
        data.vehicleId !== undefined ? data.vehicleId : (data.interventionId ? undefined : cur.vehicle_id),
        data.interventionId !== undefined ? data.interventionId : cur.intervention_id,
      )
      : { vehicleId: cur.vehicle_id, interventionId: cur.intervention_id };
    await updateRow(c, 'transactions', tid, {
      vehicle_id: links.vehicleId,
      intervention_id: links.interventionId,
      direction: data.direction,
      category: data.category,
      label: data.label,
      amount_cents: data.amount === undefined ? undefined : Math.round(data.amount * 100),
      occurred_on: data.occurredOn,
      notes: data.notes,
    });
    await audit(c, req.user.id, 'update', 'transaction', tid, { fields: Object.keys(data) });
    return loadTransaction(c, tid);
  });
  res.json({ transaction: serialize(updated) });
});

router.delete('/:id', async (req, res) => {
  const tid = parse(id, req.params.id);
  await tx(async (c) => {
    const cur = await loadTransaction(c, tid);
    if (cur.vehicle_id) await loadVehicle(c, cur.vehicle_id, { active: true });
    await c.query('DELETE FROM transactions WHERE id = $1', [tid]);
    await audit(c, req.user.id, 'delete', 'transaction', tid, { label: cur.label, amount: cur.amount_cents / 100 });
  });
  res.status(204).end();
});

export default router;
