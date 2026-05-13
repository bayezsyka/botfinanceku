import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { whatsappLinkService } from '../modules/whatsapp-links/whatsapp-link.service.js';
import { expenseService } from '../modules/expenses/expense.service.js';
import { dailyReportService } from '../modules/reports/daily-report.service.js';
import { getTodayStr, getYesterdayStr } from '../utils/date.js';
import { initReportScheduler } from '../modules/reports/daily-report.scheduler.js';
import { expenseDeleteService } from '../modules/expenses/expense-delete.service.js';

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
      const shouldReconnect =
        (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

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
      try {
        if (!msg.message || msg.key.fromMe) continue;

        const senderJid = msg.key.remoteJid;
        if (!senderJid || senderJid.endsWith('@g.us')) continue;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (!text) continue;

        const senderPhone = senderJid.split('@')[0].split(':')[0];
        const normalizedText = text.trim();
        const lowerText = normalizedText.toLowerCase();

        logger.info(`Message from ${senderPhone} (Raw JID: ${senderJid}): ${normalizedText}`);

        const verificationResponse = await whatsappLinkService.handleVerificationMessage(
          normalizedText,
          senderJid
        );

        if (verificationResponse) {
          await sock.sendMessage(senderJid, { text: verificationResponse });
          continue;
        }

        const deleteChoiceResponse = await expenseDeleteService.confirmDelete(
          senderJid,
          normalizedText
        );

        if (deleteChoiceResponse) {
          await sock.sendMessage(senderJid, { text: deleteChoiceResponse });
          continue;
        }

        if (lowerText === 'hapus') {
          const response = await expenseDeleteService.startDeleteProcess(senderJid);
          await sock.sendMessage(senderJid, { text: response });
          continue;
        }

        if (lowerText === 'laporan' || lowerText === 'rekap') {
          const senderLink = await whatsappLinkService.getVerifiedSenderByPhone(senderPhone);

          if (!senderLink) {
            continue;
          }

          const report = await dailyReportService.generateDailyReport(
            getTodayStr(),
            senderLink.workspace_id,
            senderLink.display_name
          );

          await sock.sendMessage(senderJid, { text: report });
          continue;
        }

        if (lowerText === 'kemarin') {
          const senderLink = await whatsappLinkService.getVerifiedSenderByPhone(senderPhone);

          if (!senderLink) {
            continue;
          }

          const report = await dailyReportService.generateDailyReport(
            getYesterdayStr(),
            senderLink.workspace_id,
            senderLink.display_name
          );

          await sock.sendMessage(senderJid, { text: report });
          continue;
        }

        const response = await expenseService.handleMessage(normalizedText, senderJid);

        if (response) {
          await sock.sendMessage(senderJid, { text: response });
        }
      } catch (error) {
        logger.error({ error }, 'Failed to handle incoming WhatsApp message');
      }
    }
  });

  return sock;
}
