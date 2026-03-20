import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import dotenv from 'dotenv';
import { parseExpenseMessage } from './parser.js';
import { catatPengeluaran } from './sheets.js';

// Load environment variables dari .env file
dotenv.config();

const OWNER_NUMBER = '6287721031021@s.whatsapp.net';
const BOT_NUMBER = '6285161603362'; // Nomor yang digunakan bot

async function connectToWhatsApp() {
    // Session akan disimpan di folder auth_info_baileys
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Set false karena request kode pairing di bawah
        logger: pino({ level: 'silent' }), // Menyembunyikan log yang tidak penting
        browser: ['Chrome (Finance Bot)', '', ''] // Browser yang dipakai untuk pairing code
    });

    // Fitur Pairing Code: Memperbolehkan masuk ke WhatsApp di nomor X (Bot Number) tanpa scan QR
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
             console.log(`\n⚙️ Meminta kode pairing untuk nomor: ${BOT_NUMBER}`);
             try {
                const code = await sock.requestPairingCode(BOT_NUMBER);
                console.log(`\n==========================================`);
                console.log(`✨ KODE PAIRING ANDA: ${code?.match(/.{1,4}/g)?.join('-') || code}`);
                console.log(`==========================================\n`);
                console.log(`Masukkan kode ini di aplikasi WhatsApp -> Tautkan Perangkat`);
             } catch(e) {
                console.error('❌ Gagal mendapatkan kode pairing:', e);
             }
        }, 3000);
    }

    // Event ketika state kredensial berubah (sukses login, dsb.)
    sock.ev.on('creds.update', saveCreds);

    // Event deteksi jika koneksi berubah (tersambung, putus)
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus karena ter-logout atau masalah jaringan. Reconnecting:', shouldReconnect);
            
            // Reconnect jika errornya bukan karena logout dari perangkat
            if (shouldReconnect) {
                connectToWhatsApp();
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

            // Parsing pengeluaran
            const parsedData = parseExpenseMessage(textMessage);

            if (!parsedData) {
                // Balasan jika tidak memenuhi kriteria regex parser.js
                await sock.sendMessage(senderNumber, { text: 'Format salah bos! Ketik dengan format: [deskripsi] [nominal/k/rb]' }, { quoted: msg });
                return;
            }

            try {
                // Mendapatkan tanggal & waktu lengkap dengan timezone WIB
                const dateOptions = { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' };
                // .replace mencegah format waktu lokal OS berubah jadi titik seperti (10.30)
                const tanggalSekarang = new Date().toLocaleString('id-ID', dateOptions).replace(/\./g, ':');
                
                const { description, amount } = parsedData;

                // Jalankan record transaksi ke Google Sheets
                const isSuccess = await catatPengeluaran(tanggalSekarang, description, amount);

                if (isSuccess) {
                    await sock.sendMessage(senderNumber, { text: `Sip! Pengeluaran ${description} sebesar Rp${amount} berhasil dicatat.` }, { quoted: msg });
                } else {
                    await sock.sendMessage(senderNumber, { text: 'Gagal mencatat ke database' }, { quoted: msg });
                }
            } catch (error) {
                console.error('\n❌ Terjadi error sistem saat mencatat:', error);
                // Return fallback message yang diminta dalam Try...Catch block
                await sock.sendMessage(senderNumber, { text: 'Gagal mencatat ke database' }, { quoted: msg });
            }
        }
    });
}

connectToWhatsApp();
