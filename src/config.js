import './loadEnv.js';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(16),
  APP_URL: z.string().url(),
  RESEND_API_KEY: z.string().optional().default(''),
  FROM_EMAIL: z.string().default('T2D Track <noreply@example.com>'),
  VAPID_PUBLIC_KEY: z.string().optional().default(''),
  VAPID_PRIVATE_KEY: z.string().optional().default(''),
  VAPID_SUBJECT: z.string().default('mailto:admin@example.com'),
  SCHEDULER_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),
  SCHEDULER_CATCHUP_HOURS: z.coerce.number().int().positive().default(6),
  SCHEDULER_STALE_NOTIFY_MINUTES: z.coerce.number().int().positive().default(120),
  LOW_STOCK_DIGEST_LOCAL_HOUR: z.coerce.number().int().min(0).max(23).default(9),
  REGISTRATION_MODE: z.enum(['first_user_only', 'invite_only', 'open']).default('first_user_only'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export const config = envSchema.parse(process.env);

export const isProd = config.NODE_ENV === 'production';
export const APP_VERSION = process.env.npm_package_version || '1.0.0';
