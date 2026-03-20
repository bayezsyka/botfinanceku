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
 * Fungsi untuk mencatat pengeluaran dengan format Grouping per Hari + Merging & Coloring.
 */
export async function catatPengeluaran(tanggalFull, deskripsi, nominal) {
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];

        // Format Tanggal & Waktu
        const dateObj = new Date();
        const hariIndo = dateObj.toLocaleString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
        const waktuIndo = dateObj.toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).replace(/:/g, '.');

        // Pastikan header sesuai
        await sheet.loadHeaderRow().catch(() => {});
        if (!sheet.headerValues || sheet.headerValues.length === 0 || sheet.headerValues[0] !== 'Hari') {
            await sheet.setHeaderRow(['Hari', 'Waktu', 'Deskripsi', 'Nominal']);
        }

        const rows = await sheet.getRows();
        let totalRowIndex = -1;
        let blockStartIndex = -1; // Row Index (0-based di array rows)
        let isTodayBlock = false;

        // Cari blok hari ini
        for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i]._rawData[0] === 'Total') {
                totalRowIndex = i;
                // Cari awal blok (baris yang punya isi di kolom Hari selain "Total")
                for (let j = i; j >= 0; j--) {
                    const rowHari = rows[j]._rawData[0];
                    if (rowHari && rowHari !== 'Total') {
                        blockStartIndex = j;
                        if (rowHari === hariIndo) isTodayBlock = true;
                        break;
                    }
                }
                break;
            }
        }

        if (totalRowIndex !== -1 && isTodayBlock) {
            // JIKA SUDAH ADA BLOK HARI INI
            const totalRowSheetIdx = totalRowIndex + 2; // Baris di sheet (1-based + header)
            
            // 1. Sisipkan baris di atas Total
            await sheet.insertDimension('ROWS', { 
                startIndex: totalRowSheetIdx - 1, 
                endIndex: totalRowSheetIdx 
            });

            // 2. Isi data & Update Total
            await sheet.loadCells({
                startRowIndex: totalRowSheetIdx - 1,
                endRowIndex: totalRowSheetIdx + 1,
                startColumnIndex: 0,
                endColumnIndex: 4
            });

            // Baris baru (Tanpa teks Hari agar bisa di-merge vertical nanti)
            sheet.getCell(totalRowSheetIdx - 1, 1).value = waktuIndo;
            sheet.getCell(totalRowSheetIdx - 1, 2).value = deskripsi;
            sheet.getCell(totalRowSheetIdx - 1, 3).value = Number(nominal);

            // Update Nominal Total
            const totalCell = sheet.getCell(totalRowSheetIdx, 3);
            const currentTotal = parseFloat(totalCell.value || 0);
            const newTotal = currentTotal + Number(nominal);
            totalCell.value = newTotal;

            await sheet.saveUpdatedCells();

            // 3. RE-MERGE Hari (Vertical)
            // Range: Dari blockStartIndex sampai baris sebelum Total
            // Index Sheet: (blockStartIndex + 2) s/d (totalRowSheetIdx)
            await sheet.mergeCells({
                startRowIndex: blockStartIndex + 1, // +1 (header)
                endRowIndex: totalRowSheetIdx,      // Sampai baris baru yang disisipkan
                startColumnIndex: 0,
                endColumnIndex: 1
            });

            return { success: true, total: newTotal };

        } else {
            // JIKA BLOK BARU
            const startLoadIdx = rows.length + 1; // Index 0-based di library cells (Indeks baris berikutnya)
            const spacerOffset = (rows.length > 0) ? 1 : 0;
            const dataRowIdx = startLoadIdx + spacerOffset;
            const totalRowIdx = dataRowIdx + 1;

            await sheet.loadCells({
                startRowIndex: startLoadIdx,
                endRowIndex: totalRowIdx + 1,
                startColumnIndex: 0,
                endColumnIndex: 4
            });

            // Baris Data
            const cellHari = sheet.getCell(dataRowIdx, 0);
            cellHari.value = hariIndo;
            cellHari.userEnteredFormat = { verticalAlignment: 'MIDDLE', horizontalAlignment: 'CENTER' };
            
            sheet.getCell(dataRowIdx, 1).value = waktuIndo;
            sheet.getCell(dataRowIdx, 2).value = deskripsi;
            sheet.getCell(dataRowIdx, 3).value = Number(nominal);

            // Baris Total
            const cellTotalDesc = sheet.getCell(totalRowIdx, 0);
            cellTotalDesc.value = 'Total';
            
            const cellTotalVal = sheet.getCell(totalRowIdx, 3);
            cellTotalVal.value = Number(nominal);

            // Warna Background Abu-abu Muda & Bold untuk Baris Total
            for (let c = 0; c < 4; c++) {
                sheet.getCell(totalRowIdx, c).userEnteredFormat = {
                    backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 },
                    textFormat: { bold: true }
                };
            }

            await sheet.saveUpdatedCells();

            // Merge Horizontal untuk kata "Total" (Col A s/d C)
            await sheet.mergeCells({
                startRowIndex: totalRowIdx,
                endRowIndex: totalRowIdx + 1,
                startColumnIndex: 0,
                endColumnIndex: 3
            });

            return { success: true, total: nominal };
        }
    } catch (error) {
        console.error('❌ [Merge/Color Error]:', error);
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

