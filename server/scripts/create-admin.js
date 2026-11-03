// Usage : npm run create-admin -- email "Nom affiché" motdepasse
import { audit } from '../src/audit.js';
import { hashPassword } from '../src/auth.js';
import { pool, query } from '../src/db.js';

const [email, displayName, password] = process.argv.slice(2);
if (!email || !displayName || !password || password.length < 8) {
  console.error('Usage : npm run create-admin -- email "Nom affiché" motdepasse (8 caractères min.)');
  process.exit(1);
}
const { rows } = await query(
  `INSERT INTO users (email, display_name, password_hash, is_admin) VALUES ($1,$2,$3,true)
   ON CONFLICT (lower(email)) DO UPDATE SET is_admin = true, password_hash = EXCLUDED.password_hash
   RETURNING id`,
  [email, displayName, await hashPassword(password)],
);
await audit(null, rows[0].id, 'create-admin', 'user', rows[0].id);
console.log(`Administrateur prêt (id ${rows[0].id}).`);
await pool.end();
