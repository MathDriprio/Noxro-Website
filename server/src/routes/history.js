import { Router } from 'express';
import { query } from '../db.js';
import { id, parse } from '../http.js';
import { loadVehicle } from '../vehicles-common.js';

const MAX_EVENTS = 1000;

// Frise chronologique d'un véhicule : tout ce qui le concerne (y compris ce qui est rattaché à ses interventions,
// dépenses et tâches), du plus récent (ou prévu) au plus ancien. Le véhicule peut être supprimé : l'historique reste consultable.
const router = Router({ mergeParams: true });

router.get('/', async (req, res) => {
  const vid = parse(id, req.params.vehicleId);
  const vehicle = await loadVehicle({ query }, vid);

  const [owners, interventions, transactions, tasks, documents, comments] = await Promise.all([
    query(
      `SELECT o.id, o.user_id, o.since, o.until, u.display_name FROM vehicle_owners o
       JOIN users u ON u.id = o.user_id WHERE o.vehicle_id = $1`, [vid]),
    query(
      `SELECT i.id, i.kind, i.category, i.title, i.status, i.planned_date, i.done_date, i.created_at, u.display_name AS actor,
         COALESCE((SELECT sum(CASE WHEN t.direction = 'depense' THEN t.amount_cents ELSE -t.amount_cents END)
                   FROM transactions t WHERE t.intervention_id = i.id), 0) AS cost_cents
       FROM interventions i LEFT JOIN users u ON u.id = i.created_by WHERE i.vehicle_id = $1`, [vid]),
    query(
      `SELECT t.id, t.label, t.category, t.direction, t.amount_cents, t.occurred_on, t.created_at, u.display_name AS actor,
              i.title AS intervention_title
       FROM transactions t LEFT JOIN users u ON u.id = t.created_by LEFT JOIN interventions i ON i.id = t.intervention_id
       WHERE t.vehicle_id = $1`, [vid]),
    query(
      `SELECT k.id, k.title, k.status, k.priority, k.due_date, k.created_at, k.updated_at,
              c.display_name AS actor, a.display_name AS assignee
       FROM tasks k LEFT JOIN users c ON c.id = k.created_by LEFT JOIN users a ON a.id = k.assignee_id
       WHERE k.vehicle_id = $1`, [vid]),
    query(
      `SELECT d.id, d.original_name, d.title, d.mime_type, d.category, d.created_at, u.display_name AS actor,
         (SELECT i.title FROM document_links l JOIN interventions i ON i.id = l.intervention_id
           WHERE l.document_id = d.id AND i.vehicle_id = $1 LIMIT 1) AS on_intervention,
         (SELECT t.label FROM document_links l JOIN transactions t ON t.id = l.transaction_id
           WHERE l.document_id = d.id AND t.vehicle_id = $1 LIMIT 1) AS on_transaction,
         (SELECT k.title FROM document_links l JOIN tasks k ON k.id = l.task_id
           WHERE l.document_id = d.id AND k.vehicle_id = $1 LIMIT 1) AS on_task
       FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE EXISTS (SELECT 1 FROM document_links l WHERE l.document_id = d.id AND (
               l.vehicle_id = $1
               OR EXISTS (SELECT 1 FROM interventions i WHERE i.id = l.intervention_id AND i.vehicle_id = $1)
               OR EXISTS (SELECT 1 FROM transactions t WHERE t.id = l.transaction_id AND t.vehicle_id = $1)
               OR EXISTS (SELECT 1 FROM tasks k WHERE k.id = l.task_id AND k.vehicle_id = $1)))`, [vid]),
    query(
      `SELECT c.id, c.body, c.created_at, u.display_name AS actor,
              i.title AS on_intervention, t.label AS on_transaction, k.title AS on_task, d.original_name AS on_document
       FROM comments c
       LEFT JOIN users u ON u.id = c.author_id
       LEFT JOIN interventions i ON i.id = c.intervention_id
       LEFT JOIN transactions t ON t.id = c.transaction_id
       LEFT JOIN tasks k ON k.id = c.task_id
       LEFT JOIN documents d ON d.id = c.document_id
       WHERE c.vehicle_id = $1 OR i.vehicle_id = $1 OR t.vehicle_id = $1 OR k.vehicle_id = $1
          OR EXISTS (SELECT 1 FROM document_links l WHERE l.document_id = c.document_id AND l.vehicle_id = $1)`, [vid]),
  ]);

  const day = (ts) => (ts instanceof Date ? ts.toISOString().slice(0, 10) : ts);
  const events = [];
  const add = (e) => events.push({ ...e, sort: e.created ?? `${e.date}T00:00:00.000Z` });

  add({ type: 'vehicle', key: `vehicle-${vid}`, id: vid, date: day(vehicle.created_at), created: vehicle.created_at.toISOString(),
    title: 'Véhicule ajouté', tab: 'apercu' });

  for (const o of owners.rows) {
    add({ type: 'owner', key: `owner-since-${o.id}`, id: o.id, date: o.since, title: `${o.display_name} devient propriétaire`, tab: 'apercu' });
    if (o.until) add({ type: 'owner', key: `owner-until-${o.id}`, id: o.id, date: o.until, title: `${o.display_name} n'est plus propriétaire`, tab: 'apercu' });
  }

  for (const i of interventions.rows) {
    add({
      type: 'intervention', key: `intervention-${i.id}`, id: i.id,
      date: i.done_date ?? i.planned_date ?? day(i.created_at), created: i.created_at.toISOString(),
      title: i.title, kind: i.kind, category: i.category, status: i.status, plannedDate: i.planned_date, doneDate: i.done_date,
      cost: i.cost_cents / 100, actor: i.actor, tab: 'interventions',
    });
  }

  for (const t of transactions.rows) {
    add({
      type: 'transaction', key: `transaction-${t.id}`, id: t.id, date: t.occurred_on, created: t.created_at.toISOString(),
      title: t.label, direction: t.direction, category: t.category, amount: t.amount_cents / 100,
      intervention: t.intervention_title, actor: t.actor, tab: 'depenses',
    });
  }

  for (const k of tasks.rows) {
    const done = k.status === 'fait';
    add({
      type: 'task', key: `task-${k.id}`, id: k.id, date: done ? day(k.updated_at) : (k.due_date ?? day(k.created_at)),
      created: (done ? k.updated_at : k.created_at).toISOString(),
      title: k.title, status: k.status, priority: k.priority, dueDate: k.due_date, assignee: k.assignee, actor: k.actor, tab: 'taches',
    });
  }

  for (const d of documents.rows) {
    const image = d.mime_type.startsWith('image/');
    add({
      type: 'document', key: `document-${d.id}`, id: d.id, date: day(d.created_at), created: d.created_at.toISOString(),
      title: d.title || d.original_name, category: d.category, isImage: image && d.mime_type !== 'image/svg+xml',
      url: `/api/documents/${d.id}/file`, thumbUrl: image ? `/api/documents/${d.id}/thumb` : null, originalName: d.original_name,
      on: d.on_intervention ? { kind: 'intervention', title: d.on_intervention }
        : d.on_transaction ? { kind: 'transaction', title: d.on_transaction }
          : d.on_task ? { kind: 'task', title: d.on_task } : null,
      actor: d.actor, tab: 'documents',
    });
  }

  for (const c of comments.rows) {
    add({
      type: 'comment', key: `comment-${c.id}`, id: c.id, date: day(c.created_at), created: c.created_at.toISOString(),
      title: c.body.length > 240 ? `${c.body.slice(0, 240)}…` : c.body,
      on: c.on_intervention ? { kind: 'intervention', title: c.on_intervention }
        : c.on_transaction ? { kind: 'transaction', title: c.on_transaction }
          : c.on_task ? { kind: 'task', title: c.on_task }
            : c.on_document ? { kind: 'document', title: c.on_document } : null,
      actor: c.actor, tab: 'commentaires',
    });
  }

  events.sort((a, b) => b.date.localeCompare(a.date) || b.sort.localeCompare(a.sort) || a.key.localeCompare(b.key));
  const truncated = events.length > MAX_EVENTS;
  res.json({ events: events.slice(0, MAX_EVENTS).map(({ sort, created, ...e }) => e), truncated });
});

export default router;
