// Usage : npm run invite -- [email]   -> affiche le lien à envoyer
import { randomToken, sha256 } from '../src/auth.js';
import { config } from '../src/config.js';
import { pool, query } from '../src/db.js';

const email = process.argv[2] ?? null;
const token = randomToken();
await query('INSERT INTO invitations (token_hash, email, expires_at) VALUES ($1,$2,$3)', [
  sha256(token), email, new Date(Date.now() + config.invitationDays * 86400_000),
]);
const base = process.env.PUBLIC_URL ?? 'http://localhost:5173';
console.log(`Invitation valable ${config.invitationDays} jours :\n${base}/inscription/${token}`);
await pool.end();
