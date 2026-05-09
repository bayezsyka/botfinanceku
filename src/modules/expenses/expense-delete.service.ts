import { logger } from '../../utils/logger.js';
import { formatRupiah } from '../../utils/currency.js';
import { getTodayStr } from '../../utils/date.js';
import { expenseRepository } from './expense.repository.js';

// In-memory store for delete sessions
// Key: senderJid, Value: Array of expense IDs matching the list index
const deleteSessions = new Map<string, string[]>();

export const expenseDeleteService = {
  async startDeleteProcess(senderJid: string) {
    try {
      const expenses = await expenseRepository.getExpensesByDate(getTodayStr());
      
      if (expenses.length === 0) {
        return 'Tidak ada data pengeluaran hari ini yang bisa dihapus.';
      }

      const ids = expenses.map(e => e.id!).filter(Boolean);
      deleteSessions.set(senderJid, ids);

      let message = 'Silakan pilih nomor data yang ingin dihapus:\n';
      expenses.forEach((e, index) => {
        message += `${index + 1}. ${e.subject} ${formatRupiah(e.amount)}\n`;
      });
      message += '\nBalas dengan nomornya saja (misal: 1)';
      
      return message;
    } catch (error) {
      logger.error({ error }, 'Error starting delete process');
      return 'Terjadi kesalahan saat mengambil data.';
    }
  },

  async confirmDelete(senderJid: string, indexStr: string) {
    const ids = deleteSessions.get(senderJid);
    if (!ids) return null;

    const index = parseInt(indexStr) - 1;
    if (isNaN(index) || index < 0 || index >= ids.length) {
      return 'Nomor tidak valid. Silakan pilih nomor yang sesuai dengan daftar.';
    }

    const targetId = ids[index];
    try {
      await expenseRepository.deleteExpense(targetId);
      deleteSessions.delete(senderJid);
      
      return 'Data berhasil dihapus!';
    } catch (error) {
      logger.error({ error, targetId }, 'Error deleting expense');
      return 'Gagal menghapus data. Silakan coba lagi.';
    }
  }
};
