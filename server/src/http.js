import { z } from 'zod';

z.config(z.locales.fr());

export class HttpError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const badRequest = (message, fields) => new HttpError(400, 'validation', message, fields);
export const notFound = (what = 'Élément') => new HttpError(404, 'not_found', `${what} introuvable.`);
export const conflict = (message, code = 'conflict') => new HttpError(409, code, message);
export const forbidden = (message = 'Action non autorisée.') => new HttpError(403, 'forbidden', message);

/** Valide `data` avec un schéma zod ; lève une 400 avec les erreurs par champ. */
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  throw badRequest('Certaines informations sont invalides.', fields);
}

export function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, fields: err.fields } });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: { code: 'file_too_large', message: 'Fichier trop volumineux (30 Mo maximum).' } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'bad_json', message: 'Requête JSON invalide.' } });
  }
  // violations de contraintes PostgreSQL non anticipées
  if (err.code === '23505') {
    return res.status(409).json({ error: { code: 'conflict', message: 'Cet élément existe déjà.' } });
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: { code: 'validation', message: 'Référence invalide.' } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'internal', message: 'Erreur interne du serveur.' } });
}

// schémas réutilisables
export const id = z.coerce.number().int().positive();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ).')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Date invalide.');
export const optText = (max = 2000) =>
  z.string().trim().max(max).transform((s) => (s === '' ? null : s)).nullable().optional();
export const reqText = (max = 200) => z.string().trim().min(1, 'Champ obligatoire.').max(max);
