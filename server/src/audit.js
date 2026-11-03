import { query } from './db.js';

/** Historique interne. Ne doit jamais faire échouer la requête principale. */
export async function audit(client, userId, action, entityType, entityId, details = null) {
  try {
    await (client ?? { query }).query(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5)',
      [userId ?? null, action, entityType, entityId ?? null, details],
    );
  } catch (err) {
    console.error('audit:', err.message);
  }
}
