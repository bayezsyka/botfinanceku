import { logger } from '../../utils/logger.js';
import { formatRupiah } from '../../utils/currency.js';
import { getTodayStr } from '../../utils/date.js';
import { expenseRepository } from './expense.repository.js';
import { whatsappLinkService } from '../whatsapp-links/whatsapp-link.service.js';

type DeleteSession = {
  workspaceId: string;
  ids: string[];
};

const deleteSessions = new Map<string, DeleteSession>();

export const expenseDeleteService = {
  async startDeleteProcess(senderJid: string) {
    try {
      const senderPhone = senderJid.split('@')[0].split(':')[0];
      const senderLink = await whatsappLinkService.getVerifiedSenderByPhone(senderPhone);

      if (!senderLink) {
        return 'Nomor ini belum terhubung ke workspace. Silakan hubungkan lewat dashboard terlebih dahulu.';
      }

      const expenses = await expenseRepository.getExpensesByDate(getTodayStr(), senderLink.workspace_id);

      if (expenses.length === 0) {
        return 'Tidak ada data pengeluaran hari ini yang bisa dihapus.';
      }

      const ids = expenses.map(e => e.id!).filter(Boolean);
      deleteSessions.set(senderJid, {
        workspaceId: senderLink.workspace_id,
        ids,
      });

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
    const session = deleteSessions.get(senderJid);
    if (!session) return null;

    const index = parseInt(indexStr) - 1;
    if (isNaN(index) || index < 0 || index >= session.ids.length) {
      return 'Nomor tidak valid. Silakan pilih nomor yang sesuai dengan daftar.';
    }

    const targetId = session.ids[index];

    try {
      await expenseRepository.deleteExpense(targetId, session.workspaceId);
      deleteSessions.delete(senderJid);

      return 'Data berhasil dihapus!';
    } catch (error) {
      logger.error({ error, targetId }, 'Error deleting expense');
      return 'Gagal menghapus data. Silakan coba lagi.';
    }
  }
};
