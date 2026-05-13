import { logger } from '../../utils/logger.js';
import { formatRupiah } from '../../utils/currency.js';
import { getTodayStr } from '../../utils/date.js';
import { parseExpenseMessage } from './expense.parser.js';
import { expenseRepository } from './expense.repository.js';
import { dailyReportService } from '../reports/daily-report.service.js';
import { predictExpenseCategory } from '../../lib/ai-client.js';
import { whatsappLinkService } from '../whatsapp-links/whatsapp-link.service.js';

export const expenseService = {
  async handleMessage(message: string, senderJid: string) {
    const senderPhone = senderJid.split('@')[0].split(':')[0];

    const verificationResponse = await whatsappLinkService.handleVerificationMessage(message, senderJid);
    if (verificationResponse) {
      return verificationResponse;
    }

    const senderLink = await whatsappLinkService.getVerifiedSenderByPhone(senderPhone);
    if (!senderLink) {
      logger.info(
        { senderPhone },
        'Ignored message because sender is not linked to any workspace'
      );

      return 'Nomor ini belum terhubung ke workspace. Silakan login ke dashboard BotFinanceku lalu hubungkan WhatsApp.';
    }

    const parsed = parseExpenseMessage(message);
    if (!parsed) {
      return 'Format belum sesuai.\n\nContoh yang benar:\nmakan 15k\nbensin 50rb\nbelanja 1.5jt';
    }

    try {
      logger.info({ parsed, senderPhone }, 'Attempting to save expense to Supabase...');

      const aiPrediction = await predictExpenseCategory(parsed.subject, parsed.amount);

      const result = await expenseRepository.createExpense({
        workspace_id: senderLink.workspace_id,
        created_by_phone: senderPhone,

        subject: parsed.subject,
        amount: parsed.amount,
        raw_amount: parsed.raw_amount,
        sender_jid: senderJid,
        sender_phone: senderPhone,
        expense_date: getTodayStr(),

        predicted_category: aiPrediction?.predicted_category ?? null,
        confidence: aiPrediction?.confidence ?? null,
        is_confident: aiPrediction?.is_confident ?? false,
        confirmed_category: null,
        is_confirmed: false,
        model_version: aiPrediction?.model_version ?? null,
      });

      logger.info({ result, aiPrediction }, 'Expense saved successfully');

      const report = await dailyReportService.generateDailyReport(getTodayStr(), senderLink.workspace_id, senderLink.display_name);

      const aiText = aiPrediction
        ? `\n\nPrediksi AI: ${aiPrediction.predicted_category} (${Math.round(aiPrediction.confidence * 100)}%)`
        : '\n\nPrediksi AI: belum tersedia';

      return `Tercatat: ${parsed.subject} ${formatRupiah(parsed.amount)}${aiText}\n\n${report}`;
    } catch (error) {
      logger.error({ error }, 'Failed to save expense');
      return 'Catatan belum berhasil disimpan. Coba lagi sebentar.';
    }
  },
};
