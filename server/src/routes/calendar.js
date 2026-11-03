import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { badRequest, isoDate, parse } from '../http.js';

const router = Router();
const MAX_DAYS = 100;

// Événements à venir sur une période : interventions planifiées / en cours (date prévue) et tâches non terminées (échéance).
router.get('/', async (req, res) => {
  const { from, to } = parse(z.object({ from: isoDate, to: isoDate }), req.query);
  const days = (Date.parse(to) - Date.parse(from)) / 86400_000;
  if (days < 0 || days > MAX_DAYS) {
    throw badRequest(`La période doit faire entre 0 et ${MAX_DAYS} jours.`, { to: `Période de ${MAX_DAYS} jours maximum.` });
  }

  const [interventions, tasks] = await Promise.all([
    query(
      `SELECT i.id, i.title, i.planned_date AS date, i.status, i.kind, v.id AS vehicle_id, v.make || ' ' || v.model AS vehicle_name
       FROM interventions i JOIN vehicles v ON v.id = i.vehicle_id
       WHERE v.deleted_at IS NULL AND i.status IN ('planifie', 'en_cours') AND i.planned_date BETWEEN $1 AND $2`,
      [from, to],
    ),
    query(
      `SELECT t.id, t.title, t.due_date AS date, t.status, t.priority, t.vehicle_id, v.make || ' ' || v.model AS vehicle_name,
              u.display_name AS assignee_name
       FROM tasks t LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.status <> 'fait' AND t.due_date BETWEEN $1 AND $2 AND (v.id IS NULL OR v.deleted_at IS NULL)`,
      [from, to],
    ),
  ]);

  const events = [
    ...interventions.rows.map((r) => ({
      type: 'intervention', id: r.id, title: r.title, date: r.date, status: r.status, kind: r.kind,
      vehicleId: r.vehicle_id, vehicleName: r.vehicle_name,
    })),
    ...tasks.rows.map((r) => ({
      type: 'task', id: r.id, title: r.title, date: r.date, status: r.status, priority: r.priority,
      vehicleId: r.vehicle_id, vehicleName: r.vehicle_name, assigneeName: r.assignee_name,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type) || a.id - b.id);

  res.json({ from, to, events });
});

export default router;
