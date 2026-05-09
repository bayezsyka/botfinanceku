import { expenseRepository } from '../expenses/expense.repository.js';
import { formatRupiah } from '../../utils/currency.js';
import { env } from '../../config/env.js';

export const dailyReportService = {
  async generateDailyReport(date: string) {
    const expenses = await expenseRepository.getExpensesByDate(date);
    const ownerName = env.BOT_OWNER_NAME;

    if (expenses.length === 0) {
      return `${ownerName} hari ini tidak mencatat pengeluaran.`;
    }

    const total = expenses.reduce((sum, exp) => sum + exp.amount, 0);
    
    let report = `${ownerName} hari ini menghabiskan uang sebanyak: ${formatRupiah(total)}.\n\n`;
    report += 'Berikut adalah rinciannya:\n';
    
    expenses.forEach((exp, index) => {
      report += `${index + 1}. ${exp.subject} ${formatRupiah(exp.amount)}\n`;
    });

    return report.trim();
  },
};
