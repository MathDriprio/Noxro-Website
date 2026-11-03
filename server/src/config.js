export const config = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: process.env.DATABASE_URL,
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
  production: process.env.PRODUCTION === 'true',
  // Origines de front autorisées en plus du Host de la requête (ex. http://localhost:5173 en dev)
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  autoDevApiKey: process.env.AUTODEV_API_KEY || null,
  maxFileBytes: 30 * 1024 * 1024,
  sessionDays: 30,
  invitationDays: 7,
};

if (!config.databaseUrl) throw new Error('DATABASE_URL manquant');
