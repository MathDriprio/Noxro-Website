import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { loadUser, requireAuth } from './auth.js';
import { config } from './config.js';
import { HttpError, errorHandler } from './http.js';
import authRouter, { adminRouter } from './routes/auth.js';
import calendarRouter from './routes/calendar.js';
import commentsRouter from './routes/comments.js';
import dashboardRouter from './routes/dashboard.js';
import documentsRouter from './routes/documents.js';
import historyRouter from './routes/history.js';
import interventionsRouter, { vehicleInterventions } from './routes/interventions.js';
import tasksRouter from './routes/tasks.js';
import transactionsRouter from './routes/transactions.js';
import usersRouter from './routes/users.js';
import vehiclesRouter from './routes/vehicles.js';
import vinRouter from './routes/vin.js';

export function createApp() {
  const app = express();
  if (config.production) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Protection CSRF : les requêtes qui modifient des données doivent venir de notre propre origine.
  app.use((req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin && new URL(origin).host !== req.get('host') && !config.allowedOrigins.includes(origin)) {
      throw new HttpError(403, 'forbidden', 'Origine non autorisée.');
    }
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use(loadUser);

  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);

  const api = express.Router();
  api.use(requireAuth);
  api.use('/users', usersRouter);
  api.use('/vehicles/:vehicleId/interventions', vehicleInterventions);
  api.use('/vehicles/:vehicleId/history', historyRouter);
  api.use('/vehicles', vehiclesRouter);
  api.use('/interventions', interventionsRouter);
  api.use('/transactions', transactionsRouter);
  api.use('/tasks', tasksRouter);
  api.use('/documents', documentsRouter);
  api.use('/comments', commentsRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/calendar', calendarRouter);
  api.use('/vin', vinRouter);
  app.use('/api', api);

  app.use('/api', (_req, _res) => { throw new HttpError(404, 'not_found', 'Route inconnue.'); });
  app.use(errorHandler);
  return app;
}
