import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState, 
  fetchLatestBaileysVersion, 
  Browsers 
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { expenseService } from '../modules/expenses/expense.service.js';
import { dailyReportService } from '../modules/reports/daily-report.service.js';
import { getTodayStr, getYesterdayStr } from '../utils/date.js';
import { initReportScheduler } from '../modules/reports/daily-report.scheduler.js';

export async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(env.BAILEYS_AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: logger as any,
    browser: Browsers.macOS('Desktop'),
    printQRInTerminal: false,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrcode.generate(qr, { small: true });
      logger.info('Scan the QR code above to connect.');
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      logger.info({ shouldReconnect }, 'Connection closed, reconnecting...');
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      logger.info('WhatsApp connected successfully!');
      initReportScheduler(sock);
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    if (m.type !== 'notify') return;

    for (const msg of m.messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const senderJid = msg.key.remoteJid;
      if (!senderJid || senderJid.endsWith('@g.us')) continue;

      const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
      if (!text) continue;

      const senderPhone = senderJid.split('@')[0].split(':')[0];
      
      logger.info(`Message from ${senderPhone} (Raw JID: ${senderJid}): ${text}`);

      const allowedOwners = env.OWNER_WA_NUMBER.split(',').map(n => n.trim());

      if (!allowedOwners.includes(senderPhone)) {
        logger.info(`Ignored message from ${senderPhone} (Not in allowed owners: ${env.OWNER_WA_NUMBER})`);
        continue;
      }

      // Handle special commands for testing
      try {
        if (text.toLowerCase() === 'cek') {
          await sock.sendMessage(senderJid, { text: 'aman' });
          continue;
        }

        if (text.toLowerCase() === 'rekap hari ini') {
          const report = await dailyReportService.generateDailyReport(getTodayStr());
          await sock.sendMessage(senderJid, { text: report });
          continue;
        }

        if (text.toLowerCase() === 'rekap kemarin') {
          const report = await dailyReportService.generateDailyReport(getYesterdayStr());
          await sock.sendMessage(senderJid, { text: report });
          continue;
        }

        if (text.toLowerCase() === 'kirim rekap' || text.toLowerCase() === 'kirim') {
          const report = await dailyReportService.generateDailyReport(getTodayStr());
          // Kirim ke owner dulu
          await sock.sendMessage(senderJid, { text: `Menyiapkan laporan...\n\n${report}\n\n*Laporan di atas juga telah dikirimkan ke Ibu.*` });
          // Baru kirim ke ibu
          await sock.sendMessage(`${env.MOTHER_WA_NUMBER}@s.whatsapp.net`, { text: report });
          continue;
        }

        if (text.toLowerCase() === 'kirim kemarin') {
          const report = await dailyReportService.generateDailyReport(getYesterdayStr());
          // Kirim ke owner dulu
          await sock.sendMessage(senderJid, { text: `Menyiapkan laporan kemarin...\n\n${report}\n\n*Laporan di atas juga telah dikirimkan ke Ibu.*` });
          // Baru kirim ke ibu
          await sock.sendMessage(`${env.MOTHER_WA_NUMBER}@s.whatsapp.net`, { text: report });
          continue;
        }

        // Default: parse as expense
        const reply = await expenseService.handleMessage(text, senderJid);
        if (reply) {
          await sock.sendMessage(senderJid, { text: reply }, { quoted: msg });
        }
      } catch (error) {
        logger.error({ error, text }, 'Error handling message');
        await sock.sendMessage(senderJid, { text: 'Terjadi kesalahan saat memproses pesan Anda.' });
      }
    }
  });

  return sock;
}
