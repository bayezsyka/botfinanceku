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
 * Fungsi untuk mencatat pengeluaran dengan format Grouping per Hari.
 * Layout: 
 * [Hari] | [Waktu] | [Deskripsi] | [Nominal]
 * [Date] | [Time]  | [Desc]      | [Amount]
 * Total  |         |             | [Sum]
 */
export async function catatPengeluaran(tanggalFull, deskripsi, nominal) {
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];

        // Format Tanggal: Sabtu, 28 Agu 2027
        const dateObj = new Date();
        const hariIndo = dateObj.toLocaleString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
        const waktuIndo = dateObj.toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).replace(/:/g, '.');

        // Pastikan header sesuai (Hari, Waktu, Deskripsi, Nominal)
        await sheet.loadHeaderRow().catch(() => {});
        if (!sheet.headerValues || sheet.headerValues.length === 0 || sheet.headerValues[0] !== 'Hari') {
            await sheet.setHeaderRow(['Hari', 'Waktu', 'Deskripsi', 'Nominal']);
        }

        const rows = await sheet.getRows();
        let targetBlockTotalRow = -1;
        let isTodayBlock = false;

        // Cari baris "Total" terakhir
        for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i]._rawData[0] === 'Total') {
                targetBlockTotalRow = i;
                // Cek apakah blok di atas Total ini adalah hari ini
                // Kita cari ke atas sampai nemu baris yang ada isi di kolom "Hari" selain "Total"
                for (let j = i; j >= 0; j--) {
                    const cellHari = rows[j]._rawData[0];
                    if (cellHari && cellHari !== 'Total') {
                        if (cellHari === hariIndo) isTodayBlock = true;
                        break;
                    }
                }
                break;
            }
        }

        if (targetBlockTotalRow !== -1 && isTodayBlock) {
            // JIKA SUDAH ADA BLOK HARI INI: Sisipkan baris baru di ATAS baris Total
            // Index baris di API: Header(1) + rows[targetBlockTotalRow] index.
            // Baris Total yang ketemu ada di sheet row number: targetBlockTotalRow + 2
            const totalRowIndexInSheet = targetBlockTotalRow + 2; 

            // Sisipkan baris
            await sheet.insertDimension('ROWS', { 
                startIndex: totalRowIndexInSheet - 1, 
                endIndex: totalRowIndexInSheet 
            });

            // Isi baris yang baru disisipkan (Indeks cell 0-based)
            await sheet.loadCells({
                startRowIndex: totalRowIndexInSheet - 1,
                endRowIndex: totalRowIndexInSheet + 1, // Muat baris baru & baris total
                startColumnIndex: 0,
                endColumnIndex: 4
            });

            const newRow = sheet.getCell(totalRowIndexInSheet - 1, 0);
            sheet.getCell(totalRowIndexInSheet - 1, 1).value = waktuIndo;
            sheet.getCell(totalRowIndexInSheet - 1, 2).value = deskripsi;
            sheet.getCell(totalRowIndexInSheet - 1, 3).value = Number(nominal);

            // Update Total (Baris di bawahnya)
            const totalCell = sheet.getCell(totalRowIndexInSheet, 3);
            const currentTotal = parseFloat(totalCell.value || 0);
            const newTotal = currentTotal + Number(nominal);
            totalCell.value = newTotal;

            await sheet.saveUpdatedCells();
            return { success: true, total: newTotal };

        } else {
            // JIKA BELUM ADA BLOK HARI INI: Buat blok baru di paling bawah
            const startAppendAt = rows.length + 2; // +1 untuk header, +1 untuk baris berikutnya

            // Tambah Spasi Kosong jika bukan blok pertama
            const rowsToLoad = rows.length > 0 ? 3 : 2;
            const startRowLoad = rows.length + 1;

            await sheet.loadCells({
                startRowIndex: startRowLoad,
                endRowIndex: startRowLoad + rowsToLoad,
                startColumnIndex: 0,
                endColumnIndex: 4
            });

            let currentRow = startRowLoad;

            // Baris Kosong Pemisah
            if (rows.length > 0) {
                currentRow++;
            }

            // Baris Data Pertama
            sheet.getCell(currentRow, 0).value = hariIndo;
            sheet.getCell(currentRow, 1).value = waktuIndo;
            sheet.getCell(currentRow, 2).value = deskripsi;
            sheet.getCell(currentRow, 3).value = Number(nominal);

            // Baris Total
            currentRow++;
            sheet.getCell(currentRow, 0).value = 'Total';
            sheet.getCell(currentRow, 3).value = Number(nominal);

            await sheet.saveUpdatedCells();
            return { success: true, total: nominal };
        }
    } catch (error) {
        console.error('❌ [Layout Error]:', error);
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
        
        const dateObj = new Date();
        const hariIndo = dateObj.toLocaleString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });

        // Temukan blok hari ini
        let inTodayBlock = false;
        const todayItems = [];

        for (const row of rows) {
            const hariCell = row._rawData[0];
            if (hariCell === hariIndo) inTodayBlock = true;
            else if (hariCell && hariCell !== hariIndo) inTodayBlock = false;

            if (inTodayBlock && row._rawData[0] !== 'Total') {
                todayItems.push({
                    timestamp: row._rawData[1],
                    description: row._rawData[2],
                    amount: row._rawData[3],
                    originalRow: row
                });
            }
        }
        return todayItems;
    } catch (error) {
        return [];
    }
}

