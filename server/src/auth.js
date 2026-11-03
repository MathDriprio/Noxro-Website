import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import { query } from './db.js';
import { HttpError } from './http.js';

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'noxro_session';

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('base64url');

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

export async function startSession(res, userId) {
  const token = randomToken();
  const expires = new Date(Date.now() + config.sessionDays * 86400_000);
  await query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)', [sha256(token), userId, expires]);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.production,
    expires,
    path: '/',
  });
}

export async function endSession(req, res) {
  const token = req.cookies?.[COOKIE];
  if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  res.clearCookie(COOKIE, { path: '/' });
}

export const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  displayName: u.display_name,
  isAdmin: u.is_admin,
  theme: u.theme ?? null,
});

/** Charge req.user si une session valide existe. */
export async function loadUser(req, _res, next) {
  const token = req.cookies?.[COOKIE];
  if (token) {
    const { rows } = await query(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [sha256(token)],
    );
    req.user = rows[0] ?? null;
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) throw new HttpError(401, 'unauthenticated', 'Connexion requise.');
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) throw new HttpError(401, 'unauthenticated', 'Connexion requise.');
  if (!req.user.is_admin) throw new HttpError(403, 'forbidden', 'Réservé à l\'administrateur.');
  next();
}
