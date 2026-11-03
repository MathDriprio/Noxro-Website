import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

router.get('/', async (_req, res) => {
  const [inProgress, interventions, tasks, stats] = await Promise.all([
    // véhicules sur lesquels une intervention est en cours
    query(`
      SELECT v.id, v.make, v.model,
        COALESCE(v.cover_document_id, (SELECT d.id FROM document_links l JOIN documents d ON d.id = l.document_id
                                       WHERE l.vehicle_id = v.id AND d.category = 'photo' ORDER BY d.created_at, d.id LIMIT 1)) AS cover_id,
        json_agg(json_build_object('id', i.id, 'title', i.title) ORDER BY i.id) AS interventions
      FROM vehicles v JOIN interventions i ON i.vehicle_id = v.id AND i.status = 'en_cours'
      WHERE v.deleted_at IS NULL GROUP BY v.id ORDER BY v.id`),
    query(`
      SELECT i.id, i.title, i.planned_date, v.id AS vehicle_id, v.make || ' ' || v.model AS vehicle_name
      FROM interventions i JOIN vehicles v ON v.id = i.vehicle_id
      WHERE v.deleted_at IS NULL AND i.status = 'planifie' ORDER BY i.planned_date LIMIT 20`),
    query(`
      SELECT t.id, t.title, t.due_date, t.priority, t.vehicle_id, v.make || ' ' || v.model AS vehicle_name
      FROM tasks t LEFT JOIN vehicles v ON v.id = t.vehicle_id
      WHERE t.status <> 'fait' AND t.due_date IS NOT NULL AND (v.id IS NULL OR v.deleted_at IS NULL)
      ORDER BY t.due_date LIMIT 20`),
    query(`
      SELECT
        (SELECT count(*) FROM vehicles WHERE deleted_at IS NULL)::int AS vehicles,
        (SELECT count(*) FROM tasks t LEFT JOIN vehicles v ON v.id = t.vehicle_id WHERE t.status <> 'fait' AND (v.id IS NULL OR v.deleted_at IS NULL))::int AS open_tasks,
        COALESCE((SELECT sum(amount_cents) FROM transactions t LEFT JOIN vehicles v ON v.id = t.vehicle_id
                  WHERE t.direction = 'depense' AND (v.id IS NULL OR v.deleted_at IS NULL)
                    AND t.occurred_on >= date_trunc('month', current_date)), 0) AS spent_this_month`),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = [
    ...interventions.rows.map((r) => ({
      type: 'intervention', id: r.id, title: r.title, date: r.planned_date, vehicleId: r.vehicle_id, vehicleName: r.vehicle_name,
    })),
    ...tasks.rows.map((r) => ({
      type: 'task', id: r.id, title: r.title, date: r.due_date, priority: r.priority, vehicleId: r.vehicle_id, vehicleName: r.vehicle_name,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date)).map((e) => ({ ...e, overdue: e.date < today }));

  const s = stats.rows[0];
  res.json({
    inProgress: inProgress.rows.map((r) => ({
      id: r.id, name: `${r.make} ${r.model}`, coverUrl: r.cover_id ? `/api/documents/${r.cover_id}/file` : null, interventions: r.interventions,
    })),
    upcoming,
    stats: { vehicles: s.vehicles, openTasks: s.open_tasks, spentThisMonth: s.spent_this_month / 100 },
  });
});

export default router;
