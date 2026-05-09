import { logger } from '../../utils/logger.js';
import { formatRupiah } from '../../utils/currency.js';
import { getTodayStr } from '../../utils/date.js';
import { parseExpenseMessage } from './expense.parser.js';
import { expenseRepository } from './expense.repository.js';
import { env } from '../../config/env.js';
import { dailyReportService } from '../reports/daily-report.service.js';

export const expenseService = {
  async handleMessage(message: string, senderJid: string) {
    const senderPhone = senderJid.split('@')[0].split(':')[0];

    const allowedOwners = env.OWNER_WA_NUMBER
      .split(',')
      .map((number) => number.trim())
      .filter(Boolean);

    if (!allowedOwners.includes(senderPhone)) {
      logger.info(
        { senderPhone, allowedOwners },
        'Ignored message in expense service because sender is not allowed'
      );
      return null;
    }

    const parsed = parseExpenseMessage(message);
    if (!parsed) {
      return 'Format belum sesuai.\n\nContoh yang benar:\nmakan 15k\nbensin 50rb\nbelanja 1.5jt';
    }

    try {
      logger.info({ parsed, senderPhone }, 'Attempting to save expense to Supabase...');

      const result = await expenseRepository.createExpense({
        subject: parsed.subject,
        amount: parsed.amount,
        raw_amount: parsed.raw_amount,
        sender_jid: senderJid,
        sender_phone: senderPhone,
        expense_date: getTodayStr(),
      });

      logger.info({ result }, 'Expense saved successfully');

      const report = await dailyReportService.generateDailyReport(getTodayStr());
      return `Tercatat: ${parsed.subject} ${formatRupiah(parsed.amount)}\n\n${report}`;
    } catch (error) {
      logger.error({ error }, 'Failed to save expense');
      return 'Catatan belum berhasil disimpan. Coba lagi sebentar.';
    }
  },
};
