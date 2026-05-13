import { supabase } from '../../lib/supabase.js';
import { logger } from '../../utils/logger.js';

type WhatsappRole = 'sender' | 'report_receiver';

export interface VerifiedWhatsappLink {
  id: string;
  workspace_id: string;
  role: WhatsappRole;
  phone_number: string;
  display_name?: string | null;
}

function normalizePhone(phone: string) {
  return phone.split('@')[0].split(':')[0].replace(/\D/g, '');
}

function parseVerificationMessage(message: string): { role: WhatsappRole; code: string } | null {
  const text = message.trim().toUpperCase();

  const match = text.match(/^(PENGIRIM|LAPORAN)\s+(BF-[A-Z0-9]{6})$/);

  if (!match) return null;

  const role: WhatsappRole = match[1] === 'PENGIRIM' ? 'sender' : 'report_receiver';

  return {
    role,
    code: match[2],
  };
}

export const whatsappLinkService = {
  parseVerificationMessage,

  async getVerifiedSenderByPhone(phone: string): Promise<VerifiedWhatsappLink | null> {
    const senderPhone = normalizePhone(phone);

    const { data, error } = await supabase
      .from('whatsapp_links')
      .select('id, workspace_id, role, phone_number, display_name')
      .eq('phone_number', senderPhone)
      .eq('role', 'sender')
      .eq('status', 'verified')
      .order('verified_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.error({ error, senderPhone }, 'Failed to find verified sender link');
      return null;
    }

    return data as VerifiedWhatsappLink | null;
  },

  async handleVerificationMessage(message: string, senderJid: string) {
    const parsed = parseVerificationMessage(message);

    if (!parsed) return null;

    const senderPhone = normalizePhone(senderJid);

    const { data: link, error: findError } = await supabase
      .from('whatsapp_links')
      .select('*')
      .eq('verification_code', parsed.code)
      .eq('role', parsed.role)
      .eq('status', 'pending')
      .single();

    if (findError || !link) {
      logger.warn({ findError, parsed, senderPhone }, 'WhatsApp verification code not found');

      return 'Kode tidak ditemukan atau sudah tidak berlaku. Silakan buat kode baru dari dashboard.';
    }

    const expiresAt = new Date(link.expires_at).getTime();
    const now = Date.now();

    if (Number.isFinite(expiresAt) && expiresAt < now) {
      await supabase
        .from('whatsapp_links')
        .update({
          status: 'expired',
          updated_at: new Date().toISOString(),
        })
        .eq('id', link.id);

      return 'Kode sudah kedaluwarsa. Silakan buat kode baru dari dashboard.';
    }

    const { data: updated, error: updateError } = await supabase
      .from('whatsapp_links')
      .update({
        phone_number: senderPhone,
        status: 'verified',
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', link.id)
      .select('*')
      .single();

    if (updateError || !updated) {
      logger.error({ updateError, linkId: link.id, senderPhone }, 'Failed to verify WhatsApp link');

      return 'Nomor belum berhasil dihubungkan. Coba lagi sebentar.';
    }

    if (parsed.role === 'sender') {
      return 'Nomor ini berhasil terhubung sebagai Pengirim. Sekarang kamu bisa mencatat pengeluaran lewat bot ini.';
    }

    return 'Nomor ini berhasil terhubung sebagai Penerima Laporan. Nomor ini akan menerima laporan sesuai pengaturan workspace.';
  },
};
