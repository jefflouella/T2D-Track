import { createApp } from './app.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { logger } from './logger.js';
import { startScheduler } from './services/scheduler.js';
import { configurePush } from './services/push.js';

const app = createApp();
configurePush();

const server = app.listen(config.PORT, () => {
  logger.info('server.started', { port: config.PORT, env: config.NODE_ENV });
});

let schedulerTimer = null;
if (config.NODE_ENV !== 'test') {
  schedulerTimer = startScheduler();
}

async function shutdown(signal) {
  logger.info('server.shutdown', { signal });
  if (schedulerTimer) clearInterval(schedulerTimer);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
