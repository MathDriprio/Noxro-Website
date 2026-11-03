import { badRequest, notFound, conflict } from './http.js';

export const normalizePlate = (p) => {
  if (p == null) return null;
  const n = String(p).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return n === '' ? null : n;
};

export const VEHICLE_SELECT = `
  SELECT v.*,
    COALESCE(v.cover_document_id, (
      SELECT d.id FROM document_links l JOIN documents d ON d.id = l.document_id
      WHERE l.vehicle_id = v.id AND d.category = 'photo' ORDER BY d.created_at, d.id LIMIT 1
    )) AS cover_id,
    COALESCE((
      SELECT json_agg(json_build_object('userId', u.id, 'displayName', u.display_name, 'since', o.since)
                      ORDER BY o.since, o.id)
      FROM vehicle_owners o JOIN users u ON u.id = o.user_id
      WHERE o.vehicle_id = v.id AND o.until IS NULL
    ), '[]'::json) AS owners
  FROM vehicles v`;

export function serializeVehicle(r) {
  return {
    id: r.id,
    make: r.make,
    model: r.model,
    year: r.year,
    plate: r.plate,
    vin: r.vin,
    engine: r.engine,
    color: r.color,
    notes: r.notes,
    status: r.status,
    coverDocumentId: r.cover_id ?? null,
    coverUrl: r.cover_id ? `/api/documents/${r.cover_id}/file` : null,
    coverThumbUrl: r.cover_id ? `/api/documents/${r.cover_id}/thumb` : null,
    owners: r.owners,
    isGarage: r.owners.length === 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

/** Récupère un véhicule ; `active: true` refuse les véhicules supprimés. */
export async function loadVehicle(db, id, { active = false, lock = false } = {}) {
  const { rows } = await db.query(`${VEHICLE_SELECT} WHERE v.id = $1${lock ? ' FOR UPDATE OF v' : ''}`, [id]);
  if (!rows[0]) throw notFound('Véhicule');
  if (active && rows[0].deleted_at) {
    throw conflict('Ce véhicule est supprimé : restaure-le avant de le modifier.', 'vehicle_deleted');
  }
  return rows[0];
}

/** Remplace la liste des propriétaires actuels en conservant l'historique. */
export async function setOwners(client, vehicleId, userIds) {
  const ids = [...new Set(userIds)];
  if (ids.length) {
    const { rows } = await client.query('SELECT id FROM users WHERE id = ANY($1)', [ids]);
    if (rows.length !== ids.length) {
      const known = new Set(rows.map((r) => r.id));
      throw badRequest('Utilisateur inconnu.', { ownerIds: `Utilisateur inconnu : ${ids.find((i) => !known.has(i))}.` });
    }
  }
  await client.query(
    `UPDATE vehicle_owners SET until = current_date
     WHERE vehicle_id = $1 AND until IS NULL AND NOT (user_id = ANY($2))`,
    [vehicleId, ids],
  );
  await client.query(
    `INSERT INTO vehicle_owners (vehicle_id, user_id)
     SELECT $1, u FROM unnest($2::int[]) u ON CONFLICT DO NOTHING`,
    [vehicleId, ids],
  );
}
