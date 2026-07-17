import { PrismaClient } from '@prisma/client';
import { config } from './config.js';

export const prisma = new PrismaClient({
  log: config.LOG_LEVEL === 'debug' ? ['query', 'error', 'warn'] : ['error'],
});
