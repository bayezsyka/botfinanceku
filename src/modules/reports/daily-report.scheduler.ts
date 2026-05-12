import cron from 'node-cron';
import { dailyReportService } from './daily-report.service.js';
import { env } from '../../config/env.js';
import { getTodayStr, getYesterdayStr } from '../../utils/date.js';
import { logger } from '../../utils/logger.js';
import { WASocket } from '@whiskeysockets/baileys';

export function initReportScheduler(sock: WASocket) {
  const { DAILY_REPORT_HOUR, DAILY_REPORT_MINUTE, MOTHER_WA_NUMBER } = env;
  
  const cronTime = `${DAILY_REPORT_MINUTE} ${DAILY_REPORT_HOUR} * * *`;
  
  cron.schedule(cronTime, async () => {
    logger.info('Running daily report scheduler...');
    try {
      // Jika dijadwalkan jam 00:00, maka ambil laporan hari kemarin
      const reportDate = (DAILY_REPORT_HOUR === 0 && DAILY_REPORT_MINUTE === 0) 
        ? getYesterdayStr() 
        : getTodayStr();
        
      const report = await dailyReportService.generateDailyReport(reportDate);
      await sock.sendMessage(`${MOTHER_WA_NUMBER}@s.whatsapp.net`, { text: report });
      logger.info(`Daily report sent to ${MOTHER_WA_NUMBER}`);
    } catch (error) {
      logger.error(error, 'Failed to run daily report scheduler');
    }
  }, {
    timezone: env.TZ
  });

  logger.info(`Daily report scheduled at ${DAILY_REPORT_HOUR}:${DAILY_REPORT_MINUTE.toString().padStart(2, '0')} ${env.TZ}`);
}
