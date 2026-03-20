import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import dotenv from 'dotenv';
import qrcode from 'qrcode-terminal';
import { parseExpenseMessage } from './parser.js';
import { catatPengeluaran, getTodayData } from './sheets.js';

// Variabel Session Store (Sederhana untuk handle reply hapus)
let deleteSession = {};

// Load environment variables dari .env file
dotenv.config();

const OWNER_NUMBER = '6287721031021@s.whatsapp.net';
const BOT_NUMBER = '6285161603362'; // Nomor yang digunakan bot

async function connectToWhatsApp() {
    // Session akan disimpan di folder auth_info_baileys
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    // Ambil versi WA Web terbaru untuk mencegah bug 405
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }), // Menyembunyikan log yang tidak penting
        browser: Browsers.macOS('Desktop') // Identitas default agar tidak diblokir WA
    });

    // Event ketika state kredensial berubah (sukses login, dsb.)
    sock.ev.on('creds.update', saveCreds);

    // Event deteksi jika koneksi berubah (tersambung, putus)
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // Render QR Code manual jika tersedia
        if (qr) {
            qrcode.generate(qr, { small: true });
            console.log('\n☝️ Scan QR Code di atas menggunakan WhatsApp Anda!');
        }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = reason !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus. Kode alasan:', reason, '| Reconnecting:', shouldReconnect);
            
            // Reconnect jika errornya bukan karena logout dari perangkat
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 3000); // Beri jeda 3 detik agar tidak spam loop
            }
        } else if (connection === 'open') {
            console.log('✅ Koneksi WhatsApp berhasil terhubung!');
        }
    });

    // Event pendeteksi pesan masuk
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        
        // 1. Abaikan pesan kosong atau pesan dari bot itu sendiri
        if (!msg.message || msg.key.fromMe) return;

        const senderNumber = msg.key.remoteJid;

        // 2. Filter utama: HANYA proses dan balas jika pengirim adalah owner
        if (senderNumber !== OWNER_NUMBER) {
            // Jika bukan dari owner, abaikan (bisa masuk dari grup atau nomor orang lain)
            return;
        }

        // Ambil isi pesannya
        const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (textMessage) {
            console.log(`\n[💌 Pesan Baru] Dari Owner: ${textMessage}`);

            // Cek sapaan sederhana untuk mengetes bot sudah responsif
            if (textMessage.toLowerCase() === 'ping') {
                await sock.sendMessage(senderNumber, { text: 'Pong! Bot finance Anda siap digunakan bosku. 📊' }, { quoted: msg });
                return;
            }

            // Fitur Hapus Pengeluaran Hari Ini
            if (textMessage.toLowerCase() === 'hapus hari ini') {
                try {
                    const todayDate = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\./g, ':');
                    const items = await getTodayData(todayDate);

                    if (items.length === 0) {
                        await sock.sendMessage(senderNumber, { text: 'Belum ada pengeluaran hari ini yang bisa dihapus.' }, { quoted: msg });
                        return;
                    }

                    let listMsg = '📊 *Daftar Pengeluaran Hari Ini:*\n\n';
                    deleteSession[senderNumber] = {}; // Reset session pengirim

                    items.forEach((item, index) => {
                        const letter = String.fromCharCode(97 + index); // a, b, c, ...
                        deleteSession[senderNumber][letter] = item.originalRow; // Simpan row mapping
                        listMsg += `*${letter}.* ${item.description} - Rp${item.amount}\n`;
                    });

                    listMsg += '\nKetik hurufnya (misal: *a*) untuk menghapus.';
                    await sock.sendMessage(senderNumber, { text: listMsg }, { quoted: msg });
                    return;
                } catch (err) {
                    console.error('Error list hapus:', err);
                    await sock.sendMessage(senderNumber, { text: 'Gagal mengambil data hapus.' }, { quoted: msg });
                    return;
                }
            }

            // Handle Input Huruf untuk Hapus (a, b, c...)
            if (textMessage.length === 1 && /^[a-z]$/i.test(textMessage)) {
                const letter = textMessage.toLowerCase();
                const session = deleteSession[senderNumber];

                if (session && session[letter]) {
                    try {
                        const rowToDelete = session[letter];
                        const description = rowToDelete._rawData[1];
                        const amount = rowToDelete._rawData[2];

                        await rowToDelete.delete(); // Delete baris di Google Sheets
                        delete deleteSession[senderNumber]; // Clear session

                        await sock.sendMessage(senderNumber, { text: `✅ Berhasil menghapus *${description}* (Rp${amount}) dari catatan hari ini.` }, { quoted: msg });
                        return;
                    } catch (err) {
                        console.error('Error delete row:', err);
                        await sock.sendMessage(senderNumber, { text: 'Gagal menghapus data di Google Sheets.' }, { quoted: msg });
                        return;
                    }
                }
            }

            // Parsing pengeluaran (Input Manual)
            const parsedData = parseExpenseMessage(textMessage);

            if (!parsedData) {
                // Jangan bales kalau cuma ngetik random (abaikan pesan pendek non-format)
                if (textMessage.split(' ').length > 1) {
                    await sock.sendMessage(senderNumber, { text: 'Format salah bos! Ketik dengan format: [deskripsi] [nominal/k/rb]' }, { quoted: msg });
                }
                return;
            }

            try {
                // Mendapatkan tanggal & waktu lengkap dengan timezone WIB
                const dateOptions = { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' };
                const tanggalSekarang = new Date().toLocaleString('id-ID', dateOptions).replace(/\./g, ':');
                
                const { description, amount } = parsedData;

                // Jalankan record transaksi ke Google Sheets
                const result = await catatPengeluaran(tanggalSekarang, description, amount);

                if (result.success) {
                    await sock.sendMessage(senderNumber, { text: `Sip! Pengeluaran *${description}* sebesar *Rp${amount}* berhasil dicatat.\n\n💰 Total hari ini: *Rp${result.total}*` }, { quoted: msg });
                } else {
                    await sock.sendMessage(senderNumber, { text: '❌ Gagal mencatat ke database' }, { quoted: msg });
                }
            } catch (error) {
                console.error('\n❌ Terjadi error sistem saat mencatat:', error);
                await sock.sendMessage(senderNumber, { text: '❌ Gagal mencatat ke database' }, { quoted: msg });
            }
        }
    });
}

connectToWhatsApp();
