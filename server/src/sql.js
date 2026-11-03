/** UPDATE partiel : `fields` = { colonne: valeur }, les valeurs `undefined` sont ignorées. */
export async function updateRow(client, table, id, fields) {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  const sets = entries.map(([col], i) => `${col} = $${i + 2}`);
  sets.push('updated_at = now()');
  const { rows } = await client.query(
    `UPDATE ${table} SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    [id, ...entries.map(([, v]) => v)],
  );
  return rows[0];
}

/** Ajoute une condition et son paramètre à une requête construite dynamiquement. */
export function where() {
  const conds = [];
  const params = [];
  return {
    params,
    add(sql, ...values) {
      let i = params.length;
      conds.push(sql.replace(/\?/g, () => `$${++i}`));
      params.push(...values);
    },
    clause: () => (conds.length ? `WHERE ${conds.join(' AND ')}` : ''),
  };
}
