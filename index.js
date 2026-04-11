import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import dotenv from 'dotenv';
import qrcode from 'qrcode-terminal';
import cron from 'node-cron';
import { parseExpenseMessage } from './parser.js';
import {
    catatTransaksi,
    getTodayData,
    hapusItems,
    getRangkumanHariIni,
    getRangkumanBulanIni,
    invalidateCache,
    cleanupAllStaleBlocks,
    ensureSheetReady,
    resetSemuaData,
    getDataMingguIni
} from './sheets.js';
import { generateRangkumanFoto, generateGrafikMingguIni } from './visuals.js';

dotenv.config();

const OWNER_NUMBERS = [
    '6287721031021@s.whatsapp.net',
    '84306181542117@lid'
];
const BOT_NUMBER = '6285161603362';

const deleteSession = {};
let sock; // Global scope for cron

function formatRupiah(num) {
    const abs = Math.abs(Number(num));
    const formatted = abs.toLocaleString('id-ID');
    return Number(num) < 0 ? `-Rp${formatted}` : `Rp${formatted}`;
}

function getHelpMessage() {
    return `╔══════════════════════════╗
║   💰 *BOT FINANCE ASSISTANT*   ║
╚══════════════════════════╝

📌 *PERINTAH YANG TERSEDIA:*

━━━ 💸 *Catat Pengeluaran* ━━━
Ketik: *[deskripsi] [nominal]*
Contoh: kopi 15k, makan siang 25000

━━━ 💰 *Catat Pemasukan* ━━━
Ketik: *+[deskripsi] [nominal]*
Contoh: +gaji 5jt, +freelance 500k

━━━ 📊 *Lihat Rangkuman* ━━━
• *rangkuman* — Rangkuman hari ini
• *bulan ini* — Rangkuman bulan ini

━━━ 🗑️ *Hapus Data* ━━━
• *hapus* — Pilih item untuk dihapus
• Lalu ketik hurufnya (a, b, abc, a,b,c)

━━━ ℹ️ *Lainnya* ━━━
• *ping* — Cek apakah bot aktif
• *bersih* — Bersihkan baris kosong di Sheet
• *reset* — Hapus SEMUA data
• *rangkuman foto* — Generate tabel rangkuman hari ini (Gambar)
• *grafik* — Generate visualisasi Chart saldo mingguan (Gambar)
• *menu* atau *help* — Tampilkan menu ini

💡 _Suffix angka: k/rb = ribu, jt = juta_`;
}

// ============================================================================
// CRON JOBS (REMINDERS)
// ============================================================================
function initCron() {
    // 09.00, 12.00, 15.00, 18.00, 21.00, 00.00
    const hours = ['0', '9', '12', '15', '18', '21'];
    
    hours.forEach(hour => {
        cron.schedule(`0 0 ${hour} * * *`, async () => {
            if (sock) {
                console.log(`[⏰ Cron] Sending reminder for ${hour}:00`);
                for (const num of OWNER_NUMBERS) {
                    await sock.sendMessage(num, { 
                        text: '⚠️ *REMINDER FINANCE* ⚠️\n\nAda pengeluaran yang belum dicatet ngga boss?? Biar ngga lupa langsung ketik aja ya! 📊' 
                    });
                }
            }
        }, {
            scheduled: true,
            timezone: "Asia/Jakarta"
        });
    });
    console.log('✅ Cron jobs initialized for reminders.');
}

// ============================================================================
// KONEKSI WHATSAPP
// ============================================================================
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'info' }),
        browser: Browsers.macOS('Desktop')
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) { qrcode.generate(qr, { small: true }); console.log('\n☝️ Scan QR Code!'); }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = reason !== DisconnectReason.loggedOut;
            if (shouldReconnect) { setTimeout(connectToWhatsApp, 3000); }
        } else if (connection === 'open') {
            console.log('✅ Bot Finance Assistant terhubung!');
            invalidateCache(); // Initial cache reset
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const senderNumber = msg.key.remoteJid;
        console.log(`[🔎 Check] Incoming message from: ${senderNumber}`);
        if (!OWNER_NUMBERS.includes(senderNumber)) {
            console.log(`[⚠️ Skip] Message from non-owner ignored.`);
            return;
        }

        const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (!textMessage) return;

        const text = textMessage.trim();
        const textLower = text.toLowerCase();
        console.log(`\n[💌 Pesan Baru] Dari Owner: ${text}`);

        const reply = async (content) => { await sock.sendMessage(senderNumber, { text: content }, { quoted: msg }); };

        try {
            if (textLower === 'ping') { await reply('🏓 Pong!'); return; }
            if (textLower === 'menu' || textLower === 'help' || textLower === 'bantuan') { await reply(getHelpMessage()); return; }

            // COMMAND: bersih
            if (textLower === 'bersih' || textLower === 'cleanup') {
                await reply('🧹 Sedang membersihkan baris kosong di Google Sheets...');
                invalidateCache();
                const sheet = await ensureSheetReady();
                await cleanupAllStaleBlocks(sheet);
                await reply('✅ Google Sheets sudah rapi kembali!');
                return;
            }

            // COMMAND: reset
            if (textLower === 'reset' || textLower === 'reset data') {
                await reply('⚠️ Sedang menghapus SEMUA data di Google Sheets...');
                const success = await resetSemuaData();
                if (success) {
                    await reply('✅ Berhasil! Semua data telah dihapus dan Sheet kembali bersih.');
                } else {
                    await reply('❌ Gagal mereset data. Silakan cek koneksi atau Google Sheet Anda.');
                }
                return;
            }

            // COMMAND: rangkuman
            if (textLower === 'rangkuman' || textLower === 'hari ini' || textLower === 'summary') {
                const data = await getRangkumanHariIni();
                if (!data) { await reply('📭 Belum ada transaksi hari ini.'); return; }
                let msg = '📊 *RANGKUMAN HARI INI*\n\n';
                data.items.forEach(item => {
                    const icon = item.tipe === 'masuk' ? '💰' : '💸';
                    msg += `${icon} ${item.waktu} — ${item.desc}: *${formatRupiah(item.amount)}*\n`;
                });
                msg += `\n━━━━━━━━━━━━━━━━━━━━━━`;
                if (data.totalMasuk > 0) msg += `\n💰 Total Masuk  : *${formatRupiah(data.totalMasuk)}*`;
                if (data.totalKeluar > 0) msg += `\n💸 Total Keluar : *${formatRupiah(data.totalKeluar)}*`;
                msg += `\n📌 *Saldo Hari Ini : ${formatRupiah(data.saldo)}*`;
                await reply(msg); return;
            }

            // COMMAND: rangkuman foto
            if (textLower === 'rangkuman foto') {
                await reply('📸 Sedang generate gambar rangkuman hari ini, tunggu sebentar...');
                const data = await getRangkumanHariIni();
                if (!data) { await reply('📭 Belum ada transaksi hari ini.'); return; }
                
                const imageBuffer = await generateRangkumanFoto(data);
                if (imageBuffer) {
                    await sock.sendMessage(senderNumber, { image: imageBuffer, caption: '📊 *Rangkuman Transaksi Hari Ini*' }, { quoted: msg });
                } else {
                    await reply('❌ Gagal memuat gambar/grafik.');
                }
                return;
            }

            // COMMAND: grafik
            if (textLower === 'grafik') {
                await reply('📈 Sedang menyusun chart saldo, tunggu sebentar...');
                const dataMingguan = await getDataMingguIni();
                if (!dataMingguan || dataMingguan.length === 0) { await reply('📭 Belum ada data yang cukup untuk grafik.'); return; }
                
                const buffer = await generateGrafikMingguIni(dataMingguan);
                if (buffer) {
                    await sock.sendMessage(senderNumber, { image: buffer, caption: '📉 *Grafik Saldo 7 Hari Terakhir*' }, { quoted: msg });
                } else {
                    await reply('❌ Gagal memuat gambar/grafik.');
                }
                return;
            }

            // COMMAND: bulan ini
            if (textLower === 'bulan ini' || textLower === 'monthly' || textLower === 'bulanan') {
                const data = await getRangkumanBulanIni();
                if (!data) { await reply('📭 Belum ada data bulan ini.'); return; }
                let msg = `📅 *RANGKUMAN BULAN ${data.bulan.toUpperCase()}*\n\n`;
                msg += `📆 Jumlah hari : *${data.jumlahHari} hari*\n`;
                if (data.totalMasuk > 0) msg += `💰 Total Masuk  : *${formatRupiah(data.totalMasuk)}*\n`;
                msg += `💸 Total Keluar : *${formatRupiah(data.totalKeluar)}*\n`;
                msg += `\n━━━━━━━━━━━━━━━━━━━━━━`;
                msg += `\n📌 *Saldo Bulan Ini : ${formatRupiah(data.saldo)}*`;
                if (data.jumlahHari > 0) {
                    const avg = Math.round(data.totalKeluar / data.jumlahHari);
                    msg += `\n📉 Rata-rata keluar/hari : *${formatRupiah(avg)}*`;
                }
                await reply(msg); return;
            }

            // COMMAND: hapus (CHANGED)
            if (textLower === 'hapus' || textLower === 'hapus hari ini') {
                invalidateCache();
                const items = await getTodayData();
                if (items.length === 0) { await reply('📭 Belum ada transaksi hari ini.'); return; }
                let listMsg = '🗑️ *Pilih item yang mau dihapus:*\n\n';
                deleteSession[senderNumber] = {};
                items.forEach((item, index) => {
                    const letter = String.fromCharCode(97 + index);
                    // 🔥 Simpan item utuh (termasuk UUID) ke session
                    deleteSession[senderNumber][letter] = item; 
                    const icon = item.tipe.includes('Masuk') ? '💰' : '💸';
                    listMsg += `*${letter}.* ${icon} ${item.description} — ${formatRupiah(item.amount)}\n`;
                });
                listMsg += '\n✏️ Ketik hurufnya (misal: *a* atau *abc*).';
                listMsg += '\nKetik *batal* untuk membatalkan.';
                await reply(listMsg); return;
            }

            if (textLower === 'batal' && deleteSession[senderNumber]) {
                delete deleteSession[senderNumber]; await reply('✅ Batal!'); return;
            }

            const session = deleteSession[senderNumber];
            if (session && Object.keys(session).length > 0 && text.length <= 50 && !textLower.startsWith('ping')) {
                const selectedLetters = textLower.replace(/[^a-z]/g, '').split('');
                const uniqueLetters = [...new Set(selectedLetters)];
                const itemsToDelete = [];
                uniqueLetters.forEach(l => { if (session[l]) itemsToDelete.push(session[l]); });

                if (itemsToDelete.length > 0) {
                    // 🔥 hapusItems sekarang memproses array objek yang memiliki property uuid
                    const result = await hapusItems(itemsToDelete);
                    delete deleteSession[senderNumber];
                    if (result.success) {
                        const confirmMsg = `✅ Berhasil menghapus:\n• ${result.deletedNames.join('\n• ')}`;
                        await reply(confirmMsg);
                    } else { await reply('❌ Gagal!'); }
                    return;
                }
            }

            const parsedData = parseExpenseMessage(text);
            if (!parsedData) {
                if (text.split(' ').length > 1) {
                    await reply(`❌ Format salah!\n\nContoh: kopi 15k, +gaji 5jt.\nKetik *menu* untuk bantuan.`);
                }
                return;
            }

            invalidateCache();
            const { description, amount, tipe } = parsedData;
            const result = await catatTransaksi(description, amount, tipe);
            if (result.success) {
                const icon = tipe === 'pemasukan' ? '💰' : '💸';
                await reply(`${icon} *Dicatat!*\n\n📝 ${description}\n💵 ${formatRupiah(amount)}\n\n📌 Saldo: *${formatRupiah(result.total)}*`);
            } else { await reply('❌ Gagal!'); }
        } catch (error) { console.error(error); await reply('❌ Error!'); }
    });
}

initCron();
connectToWhatsApp();
