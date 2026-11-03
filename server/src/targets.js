import { badRequest, conflict, notFound } from './http.js';

// Éléments auxquels on peut rattacher documents (+ utilisateur) et commentaires (+ document).
export const TARGETS = {
  vehicleId: { table: 'vehicles', label: 'Véhicule' },
  interventionId: { table: 'interventions', label: 'Intervention' },
  transactionId: { table: 'transactions', label: 'Transaction' },
  taskId: { table: 'tasks', label: 'Tâche' },
  userId: { table: 'users', label: 'Utilisateur' },
  documentId: { table: 'documents', label: 'Document' },
};

/** Extrait l'unique cible d'un objet (query ou body) parmi `allowed`. */
export function pickTarget(source, allowed) {
  const present = allowed.filter((k) => source[k] !== undefined && source[k] !== null && source[k] !== '');
  if (present.length !== 1) {
    throw badRequest('Indique exactement un élément cible.', { _: `Un seul parmi : ${allowed.join(', ')}.` });
  }
  const key = present[0];
  const value = Number(source[key]);
  if (!Number.isInteger(value) || value <= 0) throw badRequest('Identifiant invalide.', { [key]: 'Identifiant invalide.' });
  return { key, value };
}

export const COLUMN = { vehicleId: 'vehicle_id', interventionId: 'intervention_id', transactionId: 'transaction_id', taskId: 'task_id', userId: 'user_id', documentId: 'document_id' };

/** Vérifie que la cible existe et ne dépend pas d'un véhicule supprimé. */
export async function assertTargetUsable(db, { key, value }) {
  const t = TARGETS[key];
  const { rows } = await db.query(`SELECT * FROM ${t.table} WHERE id = $1`, [value]);
  if (!rows[0]) throw notFound(t.label);
  let vehicleId = null;
  if (key === 'vehicleId') vehicleId = value;
  else if (['interventionId', 'transactionId', 'taskId'].includes(key)) vehicleId = rows[0].vehicle_id;
  if (vehicleId) {
    const v = await db.query('SELECT deleted_at FROM vehicles WHERE id = $1', [vehicleId]);
    if (v.rows[0]?.deleted_at) {
      throw conflict('Le véhicule est supprimé : restaure-le avant de modifier ses éléments.', 'vehicle_deleted');
    }
  }
  return rows[0];
}
