import { expenseRepository } from '../expenses/expense.repository.js';
import { formatRupiah } from '../../utils/currency.js';
import { env } from '../../config/env.js';
import { getTodayStr, getYesterdayStr } from '../../utils/date.js';

export const dailyReportService = {
  async generateDailyReport(date: string) {
    const expenses = await expenseRepository.getExpensesByDate(date);
    const ownerName = env.BOT_OWNER_NAME;

    const isToday = date === getTodayStr();
    const isYesterday = date === getYesterdayStr();
    const timeRef = isToday ? 'hari ini' : (isYesterday ? 'kemarin' : `pada tanggal ${date}`);

    if (expenses.length === 0) {
      return `${ownerName} ${timeRef} tidak mencatat pengeluaran.`;
    }

    const total = expenses.reduce((sum, exp) => sum + exp.amount, 0);
    
    let report = `${ownerName} ${timeRef} menghabiskan uang sebanyak: ${formatRupiah(total)}.\n\n`;
    report += 'Berikut adalah rinciannya:\n';
    
    expenses.forEach((exp, index) => {
      report += `${index + 1}. ${exp.subject} ${formatRupiah(exp.amount)}\n`;
    });

    return report.trim();
  },
};
