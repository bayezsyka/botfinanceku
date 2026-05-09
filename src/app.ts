import { validateEnv } from './config/env.js';
import { connectToWhatsApp } from './lib/whatsapp.js';
import { logger } from './utils/logger.js';

async function main() {
  try {
    logger.info('Starting Bot Finance WA...');
    validateEnv();
    await connectToWhatsApp();
  } catch (error) {
    logger.error({ error }, 'Fatal error during startup');
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled Rejection');
});

process.on('uncaughtException', (error) => {
  logger.error({ error }, 'Uncaught Exception');
});

main();
