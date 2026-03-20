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
 * dengan cara manual (koordinat cell) untuk menghindari bug "overwriting".
 */
export async function catatPengeluaran(tanggal, deskripsi, nominal) {
    try {
        await doc.loadInfo(); 
        const sheet = doc.sheetsByIndex[0];

        // Ambil baris yang sudah ada untuk menentukan baris kosong berikutnya
        const rows = await sheet.getRows();
        
        // Baris 1: Header
        // Baris 2 s/d (rows.length + 1) : Data existing
        // Maka baris kosong berikutnya: rows.length + 2
        const targetRowIndex = rows.length + 1; // getRows mengembalikan data row, indeks 0 di lib = Baris 2 di Sheet

        // Load 1 baris target tersebut saja agar efisien
        // Baris di loadCells menggunakan index 0 (0 = Baris 1/Header, 1 = Baris 2, dst)
        const nextBlankRowIndex = rows.length + 1;
        await sheet.loadCells({
            startRowIndex: nextBlankRowIndex,
            endRowIndex: nextBlankRowIndex + 1,
            startColumnIndex: 0,
            endColumnIndex: 3
        });

        // Isi Cell secara manual ke Baris yang dituju
        sheet.getCell(nextBlankRowIndex, 0).value = tanggal;
        sheet.getCell(nextBlankRowIndex, 1).value = deskripsi;
        sheet.getCell(nextBlankRowIndex, 2).value = Number(nominal);

        await sheet.saveUpdatedCells();

        // Hitung ulang total harian setelah update (menggunakan data fresh)
        const updatedRows = await sheet.getRows();
        const datePrefix = tanggal.split(' ')[0];
        let totalHarian = 0;
        
        updatedRows.forEach(row => {
            const rowDate = row._rawData[0];
            if (rowDate && rowDate.startsWith(datePrefix)) {
                const rawAmount = row._rawData[2] || '0';
                const rowAmount = parseFloat(rawAmount.toString().replace(/[^\d]/g, ''));
                if (!isNaN(rowAmount)) totalHarian += rowAmount;
            }
        });

        return { success: true, total: totalHarian };
    } catch (error) {
        console.error('❌ [Critical Error]:', error);
        return { success: false, total: 0 };
    }
}

/**
 * Mendapatkan daftar pengeluaran untuk hari ini.
 */
export async function getTodayData(tanggalSekarang) {
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];
        const rows = await sheet.getRows();
        const datePrefix = tanggalSekarang.split(' ')[0];

        const todayRows = rows.filter(row => {
            const rowDate = row._rawData[0];
            return rowDate && rowDate.startsWith(datePrefix);
        });

        return todayRows.map(row => ({
            timestamp: row._rawData[0],
            description: row._rawData[1],
            amount: row._rawData[2],
            originalRow: row
        }));
    } catch (error) {
        return [];
    }
}

