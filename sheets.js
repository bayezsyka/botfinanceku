import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import dotenv from 'dotenv';

dotenv.config();

/*
 * ==============================================================================
 * CARA MENDAPATKAN KREDENSIAL SERVICE ACCOUNT DARI GOOGLE CLOUD CONSOLE
 * ==============================================================================
 * 1. Buka Google Cloud Console (https://console.cloud.google.com/)
 * 2. Buat Project baru atau pilih Project yang sudah ada.
 * 3. Aktifkan "Google Sheets API" di menu "APIs & Services" > "Library".
 * 4. Buka menu "APIs & Services" > "Credentials".
 * 5. Klik "Create Credentials" > "Service account".
 * 6. Isi nama service account bebas, lalu klik "Done".
 * 7. Di daftar Service Account, klik email yang baru saja dibuat.
 * 8. Buka tab "Keys" > "Add Key" > "Create new key" > Pilih format "JSON".
 * 9. File JSON akan terunduh. Buka file tersebut dan copy nilai:
 *    - `client_email` paste ke variabel GOOGLE_SERVICE_ACCOUNT_EMAIL di .env
 *    - `private_key` paste ke variabel GOOGLE_PRIVATE_KEY di .env
 *    (Catatan: Pastikan copy private_key secara utuh termasuk tanda -----BEGIN PRIVATE KEY----- dsb)
 * 10. TERAKHIR SANGAT PENTING: Buka file target Google Sheets Anda di browser, 
 *     klik tombol "Bagikan" (Share) di pojok kanan atas, lalu tambahkan "client_email" 
 *     tadi sebagai "Editor".
 * ==============================================================================
 */

// Konfigurasi Autentikasi menggunakan JWT dari google-auth-library
const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    // Replace secara spesifik \n string menjadi enter asli, akibat pemrosesan .env
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// Inisiasi Doc berdasarkan ID Spreadsheet (diambil dari URL Sheets Anda)
const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, serviceAccountAuth);

/**
 * Fungsi untuk menambah data pengeluaran (append row) ke Google Sheets
 * Akan mengisi 3 kolom berurutan.
 * Kolom A: Tanggal & Waktu
 * Kolom B: Deskripsi
 * Kolom C: Nominal pengeluaran (angka murni)
 * 
 * @param {string} tanggal Tanggal atau waktu transaksi
 * @param {string} deskripsi Deskripsi / nama pengeluaran
 * @param {number} nominal Nominal angka tanpa titik koma
 * @returns {Promise<boolean>} Status berhasil/tidaknya
 */
export async function catatPengeluaran(tanggal, deskripsi, nominal) {
    try {
        // Meload properti awal dari dokumen sheet
        await doc.loadInfo(); 
        
        // Memilih Lembaran (Worksheet) ke-1 dari dokumen
        const sheet = doc.sheetsByIndex[0];

        // Menyisipkan array langsung sebagai baris baru
        // Elemen array akan otomatis masuk ke Kolom A, B, dan C
        await sheet.addRow([tanggal, deskripsi, nominal]);

        console.log(`✅ [Google Sheets] Berhasil mencatat Rp ${nominal} untuk "${deskripsi}"`);
        return true;
    } catch (error) {
        console.error('❌ [Google Sheets] Gagal mencatat pengeluaran:', error);
        return false;
    }
}
