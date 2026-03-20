import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import dotenv from 'dotenv';
import qrcode from 'qrcode-terminal';
import { parseExpenseMessage } from './parser.js';
import {
    catatTransaksi,
    getTodayData,
    hapusItems,
    getRangkumanHariIni,
    getRangkumanBulanIni,
    invalidateCache,
} from './sheets.js';

dotenv.config();

const OWNER_NUMBER = '6287721031021@s.whatsapp.net';
const BOT_NUMBER = '6285161603362';

// Session store untuk fitur hapus (per sender)
const deleteSession = {};

// ============================================================================
// FORMAT HELPERS
// ============================================================================
function formatRupiah(num) {
    const abs = Math.abs(Number(num));
    const formatted = abs.toLocaleString('id-ID');
    return Number(num) < 0 ? `-Rp${formatted}` : `Rp${formatted}`;
}

// ============================================================================
// MENU BANTUAN
// ============================================================================
function getHelpMessage() {
    return `╔══════════════════════════╗
║   💰 *BOT FINANCE ASSISTANT*   ║
╚══════════════════════════╝

📌 *PERINTAH YANG TERSEDIA:*

━━━ 💸 *Catat Pengeluaran* ━━━
Ketik: *[deskripsi] [nominal]*
Contoh:
• kopi 15k
• makan siang 25000
• bensin 50rb
• belanja bulanan 1.5jt

━━━ 💰 *Catat Pemasukan* ━━━
Ketik: *+[deskripsi] [nominal]*
atau: *masuk [deskripsi] [nominal]*
Contoh:
• +gaji 5jt
• +freelance 500k
• masuk transfer 1.5jt

━━━ 📊 *Lihat Rangkuman* ━━━
• *rangkuman* — Rangkuman hari ini
• *bulan ini* — Rangkuman bulan ini

━━━ 🗑️ *Hapus Data* ━━━
• *hapus hari ini* — Pilih item untuk dihapus
• Lalu ketik hurufnya (a, b, abc, a,b,c)

━━━ ℹ️ *Lainnya* ━━━
• *ping* — Cek apakah bot aktif
• *menu* atau *help* — Tampilkan menu ini

💡 _Suffix angka: k/rb = ribu, jt = juta_`;
}

// ============================================================================
// KONEKSI WHATSAPP
// ============================================================================
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Desktop')
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrcode.generate(qr, { small: true });
            console.log('\n☝️ Scan QR Code di atas menggunakan WhatsApp Anda!');
        }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = reason !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus. Kode alasan:', reason, '| Reconnecting:', shouldReconnect);

            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 3000);
            }
        } else if (connection === 'open') {
            console.log('✅ Bot Finance Assistant terhubung ke WhatsApp!');
        }
    });

    // ============================================================================
    // MESSAGE HANDLER
    // ============================================================================
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];

        // Abaikan pesan kosong atau dari bot sendiri
        if (!msg.message || msg.key.fromMe) return;

        const senderNumber = msg.key.remoteJid;

        // Filter: HANYA proses dari owner
        if (senderNumber !== OWNER_NUMBER) return;

        const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (!textMessage) return;

        const text = textMessage.trim();
        const textLower = text.toLowerCase();

        console.log(`\n[💌 Pesan Baru] Dari Owner: ${text}`);

        // Reply helper
        const reply = async (content) => {
            await sock.sendMessage(senderNumber, { text: content }, { quoted: msg });
        };

        try {
            // ==============================================================
            // COMMAND: ping
            // ==============================================================
            if (textLower === 'ping') {
                await reply('🏓 Pong! Bot Finance Assistant siap digunakan!');
                return;
            }

            // ==============================================================
            // COMMAND: menu / help
            // ==============================================================
            if (textLower === 'menu' || textLower === 'help' || textLower === 'bantuan') {
                await reply(getHelpMessage());
                return;
            }

            // ==============================================================
            // COMMAND: rangkuman (hari ini)
            // ==============================================================
            if (textLower === 'rangkuman' || textLower === 'hari ini' || textLower === 'summary') {
                const data = await getRangkumanHariIni();
                if (!data) {
                    await reply('📭 Belum ada transaksi hari ini.');
                    return;
                }

                let msg = '📊 *RANGKUMAN HARI INI*\n\n';

                data.items.forEach((item, idx) => {
                    const icon = item.tipe === 'masuk' ? '💰' : '💸';
                    msg += `${icon} ${item.waktu} — ${item.desc}: *${formatRupiah(item.amount)}*\n`;
                });

                msg += `\n━━━━━━━━━━━━━━━━━━━━━━`;
                if (data.totalMasuk > 0) msg += `\n💰 Total Masuk  : *${formatRupiah(data.totalMasuk)}*`;
                if (data.totalKeluar > 0) msg += `\n💸 Total Keluar : *${formatRupiah(data.totalKeluar)}*`;
                msg += `\n📌 *Saldo Hari Ini : ${formatRupiah(data.saldo)}*`;

                await reply(msg);
                return;
            }

            // ==============================================================
            // COMMAND: bulan ini
            // ==============================================================
            if (textLower === 'bulan ini' || textLower === 'monthly' || textLower === 'bulanan') {
                const data = await getRangkumanBulanIni();
                if (!data) {
                    await reply('📭 Belum ada data bulan ini.');
                    return;
                }

                let msg = `📅 *RANGKUMAN BULAN ${data.bulan.toUpperCase()}*\n\n`;
                msg += `📆 Jumlah hari tercatat : *${data.jumlahHari} hari*\n`;
                if (data.totalMasuk > 0) msg += `💰 Total Pemasukan     : *${formatRupiah(data.totalMasuk)}*\n`;
                msg += `💸 Total Pengeluaran   : *${formatRupiah(data.totalKeluar)}*\n`;
                msg += `\n━━━━━━━━━━━━━━━━━━━━━━`;
                msg += `\n📌 *Saldo Bulan Ini : ${formatRupiah(data.saldo)}*`;

                if (data.jumlahHari > 0) {
                    const avgPerHari = Math.round(data.totalKeluar / data.jumlahHari);
                    msg += `\n📉 Rata-rata pengeluaran/hari : *${formatRupiah(avgPerHari)}*`;
                }

                await reply(msg);
                return;
            }

            // ==============================================================
            // COMMAND: hapus hari ini
            // ==============================================================
            if (textLower === 'hapus hari ini') {
                invalidateCache();
                const items = await getTodayData();

                if (items.length === 0) {
                    await reply('📭 Belum ada transaksi hari ini yang bisa dihapus.');
                    return;
                }

                let listMsg = '🗑️ *Pilih item yang mau dihapus:*\n\n';
                deleteSession[senderNumber] = {};

                items.forEach((item, index) => {
                    const letter = String.fromCharCode(97 + index); // a, b, c, ...
                    deleteSession[senderNumber][letter] = item;
                    const icon = (item.tipe || '').includes('Masuk') ? '💰' : '💸';
                    listMsg += `*${letter}.* ${icon} ${item.description} — ${formatRupiah(item.amount)}\n`;
                });

                listMsg += '\n✏️ Ketik hurufnya untuk menghapus.';
                listMsg += '\nContoh: *a* atau *a,b,c* atau *abc*';
                listMsg += '\nKetik *batal* untuk membatalkan.';
                await reply(listMsg);
                return;
            }

            // ==============================================================
            // HANDLE: Batal hapus
            // ==============================================================
            if (textLower === 'batal' && deleteSession[senderNumber]) {
                delete deleteSession[senderNumber];
                await reply('✅ Proses hapus dibatalkan.');
                return;
            }

            // ==============================================================
            // HANDLE: Input huruf untuk hapus (a, abc, a,b,c)
            // ==============================================================
            const session = deleteSession[senderNumber];
            if (session && Object.keys(session).length > 0 && text.length >= 1 && text.length <= 50) {
                // Bersihkan input: "a,b,c" -> ['a','b','c'], "abc" -> ['a','b','c']
                const selectedLetters = textLower.replace(/[^a-z]/g, '').split('');
                const uniqueLetters = [...new Set(selectedLetters)]; // Deduplicate

                const itemsToDelete = [];
                const invalidLetters = [];

                uniqueLetters.forEach(letter => {
                    if (session[letter]) {
                        itemsToDelete.push(session[letter]);
                    } else {
                        invalidLetters.push(letter);
                    }
                });

                if (invalidLetters.length > 0 && itemsToDelete.length === 0) {
                    // Semua huruf tidak valid — mungkin ini bukan input hapus
                    // Jangan block, lanjut ke parser biasa
                } else if (itemsToDelete.length > 0) {
                    // Konfirmasi dan hapus
                    const result = await hapusItems(itemsToDelete);

                    delete deleteSession[senderNumber];

                    if (result.success) {
                        const confirmMsg = itemsToDelete.length > 1
                            ? `✅ Berhasil menghapus ${itemsToDelete.length} item:\n• ${result.deletedNames.join('\n• ')}`
                            : `✅ Berhasil menghapus *${result.deletedNames[0]}* dari catatan hari ini.`;
                        await reply(confirmMsg);
                    } else {
                        await reply('❌ Gagal menghapus data. Coba lagi nanti.');
                    }
                    return;
                }
            }

            // ==============================================================
            // PARSE: Catat transaksi (pengeluaran / pemasukan)
            // ==============================================================
            const parsedData = parseExpenseMessage(text);

            if (!parsedData) {
                // Abaikan pesan pendek random yang bukan command
                // Balesi hanya jika terlihat seperti percobaan input (ada spasi)
                if (text.split(' ').length > 1) {
                    await reply(
                        `❌ Format tidak dikenali.\n\n` +
                        `💡 *Contoh pengeluaran:* kopi 15k\n` +
                        `💡 *Contoh pemasukan:* +gaji 5jt\n\n` +
                        `Ketik *menu* untuk melihat semua perintah.`
                    );
                }
                return;
            }

            // Catat ke Google Sheets
            invalidateCache();
            const { description, amount, tipe } = parsedData;
            const result = await catatTransaksi(description, amount, tipe);

            if (result.success) {
                const icon = tipe === 'pemasukan' ? '💰' : '💸';
                const label = tipe === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran';
                await reply(
                    `${icon} *${label} dicatat!*\n\n` +
                    `📝 ${description}\n` +
                    `💵 ${formatRupiah(amount)}\n\n` +
                    `📌 Saldo hari ini: *${formatRupiah(result.total)}*`
                );
            } else {
                await reply('❌ Gagal mencatat ke Google Sheets. Coba lagi nanti.');
            }
        } catch (error) {
            console.error('\n❌ Error handling message:', error);
            await reply('❌ Terjadi error. Coba lagi nanti.');
        }
    });
}

connectToWhatsApp();
