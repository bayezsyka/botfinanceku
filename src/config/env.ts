import dotenv from 'dotenv';
import { logger } from '../utils/logger.js';

dotenv.config();

const requiredEnvs = [
  'BOT_OWNER_NAME',
  'TZ',
  'OWNER_WA_NUMBER',
  'MOTHER_WA_NUMBER',
  'DAILY_REPORT_HOUR',
  'DAILY_REPORT_MINUTE',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'BAILEYS_AUTH_DIR',
] as const;

export const env = {
  BOT_OWNER_NAME: process.env.BOT_OWNER_NAME!,
  TZ: process.env.TZ || 'Asia/Jakarta',
  OWNER_WA_NUMBER: process.env.OWNER_WA_NUMBER!,
  MOTHER_WA_NUMBER: process.env.MOTHER_WA_NUMBER!,
  DAILY_REPORT_HOUR: parseInt(process.env.DAILY_REPORT_HOUR || '0', 10),
  DAILY_REPORT_MINUTE: parseInt(process.env.DAILY_REPORT_MINUTE || '0', 10),
  SUPABASE_URL: process.env.SUPABASE_URL!,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  BAILEYS_AUTH_DIR: process.env.BAILEYS_AUTH_DIR || 'auth/session',
};

export function validateEnv() {
  const missing = requiredEnvs.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    logger.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}
