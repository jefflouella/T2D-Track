import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { config, isProd, APP_VERSION } from './config.js';
import { prisma } from './db.js';
import { logger } from './logger.js';
import { loadUserFromSessionToken } from './services/auth.js';
import { csrfProtection, csrfTokenHandler, generateCsrfToken } from './middleware/csrf.js';
import { HttpError } from './util.js';
import { getSchedulerHealth } from './services/scheduler.js';

import authRoutes from './routes/auth.js';
import accountRoutes from './routes/account.js';
import medicationRoutes from './routes/medications.js';
import todayRoutes from './routes/today.js';
import healthRoutes from './routes/health.js';
import reportRoutes from './routes/reports.js';
import pushRoutes from './routes/push.js';
import householdRoutes from './routes/household.js';
import extrasRoutes from './routes/extras.js';
import securityRoutes from './routes/security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'script-src': ["'self'", "'unsafe-inline'"],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'https://fonts.gstatic.com'],
          'img-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
        },
      },
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use(express.static(path.join(root, 'public')));

  app.use(async (req, res, next) => {
    try {
      const raw = req.cookies?.t2d_session;
      req.sessionToken = raw || null;
      if (raw) {
        const loaded = await loadUserFromSessionToken(raw);
        if (loaded) {
          req.user = loaded.user;
          req.session = loaded.session;
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  });

  app.get('/health', async (_req, res) => {
    let dbOk = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch {
      dbOk = false;
    }
    let scheduler = null;
    try {
      scheduler = await getSchedulerHealth();
    } catch {
      scheduler = { error: 'unavailable' };
    }
    const status = dbOk ? 200 : 503;
    res.status(status).json({
      ok: dbOk,
      version: APP_VERSION,
      env: config.NODE_ENV,
      database: dbOk ? 'up' : 'down',
      scheduler,
    });
  });

  app.get('/api/csrf', (req, res) => csrfTokenHandler(req, res));

  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    return csrfProtection(req, res, next);
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/account', accountRoutes);
  app.use('/api', accountRoutes);
  app.use('/api', householdRoutes);
  app.use('/api', medicationRoutes);
  app.use('/api', todayRoutes);
  app.use('/api', healthRoutes);
  app.use('/api', reportRoutes);
  app.use('/api', extrasRoutes);
  app.use('/api/security', securityRoutes);
  app.use('/api/push', pushRoutes);
  app.use('/api/user', pushRoutes);

  const pages = [
    '/',
    '/login',
    '/register',
    '/onboarding',
    '/today',
    '/medications',
    '/medications/new',
    '/health',
    '/health/trends',
    '/health/labs',
    '/reports',
    '/settings',
    '/household',
    '/supplies',
    '/invite',
    '/verify-email',
    '/recovery',
  ];

  for (const route of pages) {
    app.get(route, (req, res) => {
      res.sendFile(path.join(root, 'public', 'index.html'));
    });
  }

  app.get('/medications/:id', (_req, res) => {
    res.sendFile(path.join(root, 'public', 'index.html'));
  });

  app.use((err, req, res, _next) => {
    if (err instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: err.flatten(),
      });
    }
    if (err instanceof HttpError) {
      return res.status(err.status).json({
        error: err.message,
        details: err.details,
        ...(err.details || {}),
      });
    }
    logger.error('request.failed', {
      path: req.path,
      method: req.method,
      error: err.message,
      stack: isProd ? undefined : err.stack,
    });
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

export { generateCsrfToken };
