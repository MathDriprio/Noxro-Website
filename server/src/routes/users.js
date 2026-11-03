import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { hashPassword, publicUser, verifyPassword } from '../auth.js';
import { query } from '../db.js';
import { HttpError, parse, reqText } from '../http.js';
import { THEMES } from '../themes.js';

const router = Router();

// Liste minimale pour choisir propriétaires / responsables.
router.get('/', async (_req, res) => {
  const { rows } = await query('SELECT id, display_name FROM users ORDER BY display_name');
  res.json({ users: rows.map((u) => ({ id: u.id, displayName: u.display_name })) });
});

router.patch('/me', async (req, res) => {
  const data = parse(z.object({
    displayName: reqText(80).optional(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8, 'Au moins 8 caractères.').max(200).optional(),
    theme: z.enum(THEMES, 'Thème inconnu.').nullable().optional(), // null = retour au thème par défaut
  }).strict().refine((d) => !d.newPassword || d.currentPassword, { message: 'Mot de passe actuel requis.', path: ['currentPassword'] }), req.body);

  let passwordHash;
  if (data.newPassword) {
    if (!(await verifyPassword(data.currentPassword, req.user.password_hash))) {
      throw new HttpError(400, 'validation', 'Mot de passe actuel incorrect.', { currentPassword: 'Mot de passe incorrect.' });
    }
    passwordHash = await hashPassword(data.newPassword);
  }
  const { rows } = await query(
    `UPDATE users SET display_name = COALESCE($2, display_name), password_hash = COALESCE($3, password_hash),
                      theme = CASE WHEN $4 THEN $5 ELSE theme END
     WHERE id = $1 RETURNING *`,
    [req.user.id, data.displayName ?? null, passwordHash ?? null, data.theme !== undefined, data.theme ?? null],
  );
  await audit(null, req.user.id, 'update', 'user', req.user.id, { fields: Object.keys(data).filter((k) => !/assword/.test(k)) });
  res.json({ user: publicUser(rows[0]) });
});

export default router;
