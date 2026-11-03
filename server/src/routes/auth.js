import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { audit } from '../audit.js';
import {
  endSession, hashPassword, publicUser, requireAuth, requireAdmin,
  randomToken, sha256, startSession, verifyPassword,
} from '../auth.js';
import { config } from '../config.js';
import { query, tx } from '../db.js';
import { HttpError, conflict, parse, reqText } from '../http.js';

const router = Router();

const limiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: process.env.NODE_ENV === 'test' || process.env.PORT === '0' ? 1000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Trop de tentatives, réessaie plus tard.' } },
});

const password = z.string().min(8, 'Au moins 8 caractères.').max(200);

router.post('/login', limiter, async (req, res) => {
  const body = parse(z.object({ email: z.string().trim().min(1, 'Champ obligatoire.'), password: z.string().min(1, 'Champ obligatoire.') }), req.body);
  const { rows } = await query('SELECT * FROM users WHERE lower(email) = lower($1)', [body.email]);
  const user = rows[0];
  // même réponse que l'utilisateur existe ou non
  if (!user || !(await verifyPassword(body.password, user.password_hash))) {
    throw new HttpError(401, 'bad_credentials', 'Email ou mot de passe incorrect.');
  }
  await startSession(res, user.id);
  await audit(null, user.id, 'login', 'user', user.id);
  res.json({ user: publicUser(user) });
});

router.post('/logout', async (req, res) => {
  await endSession(req, res);
  res.status(204).end();
});

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

// Vérifie un lien d'invitation avant d'afficher le formulaire d'inscription.
router.get('/invitations/:token', limiter, async (req, res) => {
  const inv = await findInvitation(req.params.token);
  res.json({ email: inv.email });
});

router.post('/register', limiter, async (req, res) => {
  const body = parse(z.object({
    token: z.string().min(1),
    email: z.string().trim().email('Email invalide.').max(200),
    displayName: reqText(80),
    password,
  }), req.body);

  const user = await tx(async (c) => {
    const { rows } = await c.query(
      `SELECT * FROM invitations WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`,
      [sha256(body.token)],
    );
    const inv = rows[0];
    if (!inv) throw new HttpError(400, 'invalid_invitation', 'Invitation invalide ou expirée.');
    if (inv.email && inv.email.toLowerCase() !== body.email.toLowerCase()) {
      throw new HttpError(400, 'invalid_invitation', 'Cette invitation est destinée à une autre adresse email.');
    }
    const exists = await c.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [body.email]);
    if (exists.rowCount) throw conflict('Un compte existe déjà avec cet email.');
    const created = await c.query(
      'INSERT INTO users (email, display_name, password_hash) VALUES ($1,$2,$3) RETURNING *',
      [body.email, body.displayName, await hashPassword(body.password)],
    );
    await c.query('UPDATE invitations SET used_at = now(), used_by = $1 WHERE id = $2', [created.rows[0].id, inv.id]);
    await audit(c, created.rows[0].id, 'register', 'user', created.rows[0].id);
    return created.rows[0];
  });
  await startSession(res, user.id);
  res.status(201).json({ user: publicUser(user) });
});

async function findInvitation(token) {
  const { rows } = await query(
    'SELECT * FROM invitations WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()',
    [sha256(token)],
  );
  if (!rows[0]) throw new HttpError(400, 'invalid_invitation', 'Invitation invalide ou expirée.');
  return rows[0];
}

// --- création d'invitations (admin) ---
export const adminRouter = Router();
adminRouter.use(requireAdmin);

adminRouter.post('/invitations', async (req, res) => {
  const body = parse(z.object({ email: z.string().trim().email('Email invalide.').nullable().optional() }), req.body ?? {});
  const token = randomToken();
  const expires = new Date(Date.now() + config.invitationDays * 86400_000);
  const { rows } = await query(
    'INSERT INTO invitations (token_hash, email, created_by, expires_at) VALUES ($1,$2,$3,$4) RETURNING id, email, expires_at',
    [sha256(token), body.email ?? null, req.user.id, expires],
  );
  await audit(null, req.user.id, 'create', 'invitation', rows[0].id);
  res.status(201).json({ id: rows[0].id, email: rows[0].email, expiresAt: rows[0].expires_at, token });
});

adminRouter.get('/invitations', async (_req, res) => {
  const { rows } = await query(
    `SELECT id, email, expires_at, used_at, created_at FROM invitations ORDER BY created_at DESC LIMIT 100`,
  );
  res.json({ invitations: rows });
});

adminRouter.get('/logs', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const { rows } = await query(
    `SELECT l.id, l.action, l.entity_type, l.entity_id, l.details, l.created_at, u.display_name AS user_name
     FROM audit_logs l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT $1`,
    [limit],
  );
  res.json({ logs: rows });
});

export default router;
