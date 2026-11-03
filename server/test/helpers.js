import fs from 'node:fs/promises';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { hashPassword, randomToken, sha256 } from '../src/auth.js';
import { migrate, pool, query } from '../src/db.js';

export const app = createApp();

export async function resetDb() {
  await migrate();
  await query(`TRUNCATE users, vehicles, documents, audit_logs, invitations RESTART IDENTITY CASCADE`);
  await fs.rm(process.env.UPLOAD_DIR, { recursive: true, force: true });
  await fs.mkdir(process.env.UPLOAD_DIR, { recursive: true });
}

export async function closeDb() {
  await pool.end();
}

/** Crée un utilisateur directement en base et renvoie un agent connecté. */
export async function loginAs(name, { admin = false } = {}) {
  const email = `${name}@test.fr`;
  const { rows } = await query(
    'INSERT INTO users (email, display_name, password_hash, is_admin) VALUES ($1,$2,$3,$4) RETURNING id',
    [email, name, await hashPassword('motdepasse1'), admin],
  );
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email, password: 'motdepasse1' }).expect(200);
  agent.userId = rows[0].id;
  return agent;
}

export async function makeInvitation(email = null) {
  const token = randomToken();
  await query('INSERT INTO invitations (token_hash, email, expires_at) VALUES ($1,$2,now() + interval \'1 day\')', [sha256(token), email]);
  return token;
}

export const anon = () => request(app);
