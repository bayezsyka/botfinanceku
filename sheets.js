import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import dotenv from 'dotenv';

dotenv.config();

// ============================================================================
// AUTH & CONFIG
// ============================================================================
const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, serviceAccountAuth);

// Cache sheet info agar tidak loadInfo berulang kali
let _sheetReady = false;
async function ensureSheetReady() {
    if (!_sheetReady) {
        await doc.loadInfo();
        _sheetReady = true;
    }
    return doc.sheetsByIndex[0];
}

// ============================================================================
// HELPER: Tanggal & Waktu WIB
// ============================================================================
function getWIBDate() {
    const now = new Date();
    // Format hari: "Sabtu, 21 Mar 2026"
    const hariIndo = now.toLocaleString('id-ID', { 
        timeZone: 'Asia/Jakarta', 
        weekday: 'long', 
        day: 'numeric', 
        month: 'short', 
        year: 'numeric' 
    });
    // Format waktu: "02.30"
    const waktuIndo = now.toLocaleString('id-ID', { 
        timeZone: 'Asia/Jakarta', 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: false 
    }).replace(/:/g, '.');

    return { hariIndo, waktuIndo };
}

// Format rupiah: 15000 -> "15.000"
function formatRupiah(num) {
    return Number(num).toLocaleString('id-ID');
}

// ============================================================================
// HEADER SETUP
// ============================================================================
const HEADERS = ['Hari', 'Waktu', 'Deskripsi', 'Nominal', 'Tipe'];

async function ensureHeaders(sheet) {
    try {
        await sheet.loadHeaderRow();
        if (!sheet.headerValues || sheet.headerValues.length === 0 || sheet.headerValues[0] !== 'Hari') {
            await sheet.setHeaderRow(HEADERS);
        }
        // Upgrade header lama (4 kolom) ke 5 kolom jika perlu
        if (sheet.headerValues.length < 5 || sheet.headerValues[4] !== 'Tipe') {
            await sheet.setHeaderRow(HEADERS);
        }
    } catch {
        await sheet.setHeaderRow(HEADERS);
    }
}

// ============================================================================
// CARI BLOK HARI INI
// ============================================================================
function findTodayBlock(rows, hariIndo) {
    let totalRowIndex = -1;
    let blockStartIndex = -1;
    let isTodayBlock = false;

    // Scan dari bawah ke atas, cari blok terakhir yang punya Total
    for (let i = rows.length - 1; i >= 0; i--) {
        const cellHari = rows[i]._rawData[0];
        if (cellHari === 'Total') {
            totalRowIndex = i;
            // Mundur lagi untuk cari label hari
            for (let j = i - 1; j >= 0; j--) {
                const rowHari = rows[j]._rawData[0];
                if (rowHari && rowHari !== 'Total' && rowHari !== '') {
                    blockStartIndex = j;
                    if (rowHari === hariIndo) isTodayBlock = true;
                    break;
                }
            }
            break;
        }
    }

    return { totalRowIndex, blockStartIndex, isTodayBlock };
}

// ============================================================================
// CATAT PENGELUARAN / PEMASUKAN
// ============================================================================
export async function catatTransaksi(deskripsi, nominal, tipe = 'pengeluaran') {
    try {
        const sheet = await ensureSheetReady();
        await ensureHeaders(sheet);

        const { hariIndo, waktuIndo } = getWIBDate();
        const rows = await sheet.getRows();
        const { totalRowIndex, blockStartIndex, isTodayBlock } = findTodayBlock(rows, hariIndo);

        if (totalRowIndex !== -1 && isTodayBlock) {
            // ============================================================
            // HARI INI SUDAH ADA BLOK — Sisipkan baris di atas Total
            // ============================================================
            const totalRowSheetIdx = totalRowIndex + 2; // +1 header, +1 karena 0-based

            // 1. Sisipkan baris kosong di atas Total
            await sheet.insertDimension('ROWS', {
                startIndex: totalRowSheetIdx - 1,
                endIndex: totalRowSheetIdx
            });

            // 2. Muat cell area baris baru + Total
            await sheet.loadCells({
                startRowIndex: totalRowSheetIdx - 1,
                endRowIndex: totalRowSheetIdx + 1,
                startColumnIndex: 0,
                endColumnIndex: 5
            });

            // 3. Isi baris baru
            sheet.getCell(totalRowSheetIdx - 1, 1).value = waktuIndo;
            sheet.getCell(totalRowSheetIdx - 1, 2).value = deskripsi;
            sheet.getCell(totalRowSheetIdx - 1, 3).value = Number(nominal);
            sheet.getCell(totalRowSheetIdx - 1, 4).value = tipe === 'pemasukan' ? '💰 Masuk' : '💸 Keluar';

            // 4. Update Nominal Total
            const totalCell = sheet.getCell(totalRowSheetIdx, 3);
            const currentTotal = parseFloat(totalCell.value || 0);
            const delta = tipe === 'pemasukan' ? Number(nominal) : -Number(nominal);
            const newTotal = currentTotal + delta;
            totalCell.value = newTotal;

            await sheet.saveUpdatedCells();

            // 5. Re-merge kolom Hari (vertical)
            try {
                await sheet.mergeCells({
                    startRowIndex: blockStartIndex + 1,
                    endRowIndex: totalRowSheetIdx,
                    startColumnIndex: 0,
                    endColumnIndex: 1,
                }, 'MERGE_ALL');
            } catch (mergeErr) {
                console.warn('⚠️ Merge hari gagal (mungkin overlap):', mergeErr.message);
            }

            return { success: true, total: newTotal };

        } else {
            // ============================================================
            // BLOK BARU UNTUK HARI INI
            // ============================================================
            const startLoadIdx = rows.length + 1;
            const spacerOffset = (rows.length > 0) ? 1 : 0;
            const dataRowIdx = startLoadIdx + spacerOffset;
            const totalRowIdx = dataRowIdx + 1;

            await sheet.loadCells({
                startRowIndex: startLoadIdx,
                endRowIndex: totalRowIdx + 1,
                startColumnIndex: 0,
                endColumnIndex: 5
            });

            // Baris Data
            const cellHari = sheet.getCell(dataRowIdx, 0);
            cellHari.value = hariIndo;
            cellHari.verticalAlignment = 'MIDDLE';
            cellHari.horizontalAlignment = 'CENTER';
            cellHari.textFormat = { bold: true };

            sheet.getCell(dataRowIdx, 1).value = waktuIndo;
            sheet.getCell(dataRowIdx, 2).value = deskripsi;
            sheet.getCell(dataRowIdx, 3).value = Number(nominal);
            sheet.getCell(dataRowIdx, 4).value = tipe === 'pemasukan' ? '💰 Masuk' : '💸 Keluar';

            // Baris Total
            const cellTotalDesc = sheet.getCell(totalRowIdx, 0);
            cellTotalDesc.value = 'Total';

            const initialTotal = tipe === 'pemasukan' ? Number(nominal) : -Number(nominal);
            const cellTotalVal = sheet.getCell(totalRowIdx, 3);
            cellTotalVal.value = initialTotal;

            // Styling Total row
            for (let c = 0; c < 5; c++) {
                const cell = sheet.getCell(totalRowIdx, c);
                cell.backgroundColor = { red: 0.93, green: 0.93, blue: 0.93 };
                cell.textFormat = { bold: true };
            }

            await sheet.saveUpdatedCells();

            // Merge horizontal "Total" (Col A-C)
            try {
                await sheet.mergeCells({
                    startRowIndex: totalRowIdx,
                    endRowIndex: totalRowIdx + 1,
                    startColumnIndex: 0,
                    endColumnIndex: 3,
                }, 'MERGE_ALL');
            } catch (mergeErr) {
                console.warn('⚠️ Merge total gagal:', mergeErr.message);
            }

            return { success: true, total: initialTotal };
        }
    } catch (error) {
        console.error('❌ [catatTransaksi Error]:', error.message || error);
        return { success: false, total: 0 };
    }
}

// Wrapper sederhana
export async function catatPengeluaran(tanggalFull, deskripsi, nominal) {
    return catatTransaksi(deskripsi, nominal, 'pengeluaran');
}

export async function catatPemasukan(deskripsi, nominal) {
    return catatTransaksi(deskripsi, nominal, 'pemasukan');
}

// ============================================================================
// GET DATA HARI INI (untuk fitur hapus & rangkuman)
// ============================================================================
export async function getTodayData() {
    try {
        const sheet = await ensureSheetReady();
        await ensureHeaders(sheet);
        const rows = await sheet.getRows();
        const { hariIndo } = getWIBDate();

        let inTodayBlock = false;
        const todayItems = [];

        for (let i = 0; i < rows.length; i++) {
            const hariCell = rows[i]._rawData[0];

            // Deteksi awal blok hari ini
            if (hariCell === hariIndo) {
                inTodayBlock = true;
            } else if (hariCell && hariCell !== '' && hariCell !== hariIndo && hariCell !== 'Total') {
                // Beda hari -> keluar dari blok
                inTodayBlock = false;
            }

            // Skip baris Total
            if (hariCell === 'Total') {
                if (inTodayBlock) break; // Sudah selesai blok hari ini
                continue;
            }

            if (inTodayBlock) {
                const waktu = rows[i]._rawData[1] || '';
                const desc = rows[i]._rawData[2] || '';
                const amt = rows[i]._rawData[3] || '0';
                const tipe = rows[i]._rawData[4] || '💸 Keluar';

                if (desc) {
                    todayItems.push({
                        waktu,
                        description: desc,
                        amount: amt,
                        tipe,
                        rowIndex: i, // Index di array rows (0-based)
                        sheetRowIndex: i + 2, // Baris di sheet (1-based + header)
                    });
                }
            }
        }
        return todayItems;
    } catch (error) {
        console.error('❌ [getTodayData Error]:', error.message || error);
        return [];
    }
}

// ============================================================================
// HAPUS ITEM — Menggunakan batchUpdate deleteRange (lebih reliable)
// ============================================================================
export async function hapusItems(itemsToDelete) {
    try {
        // Reload setiap kali agar indeks terkini
        _sheetReady = false;
        const sheet = await ensureSheetReady();
        await ensureHeaders(sheet);
        const rows = await sheet.getRows();
        const { hariIndo } = getWIBDate();

        // Kumpulkan sheet row indices yang perlu dihapus
        const sheetRowIndices = itemsToDelete.map(item => item.sheetRowIndex);

        // SANGAT PENTING: Urutkan dari bawah ke atas agar tidak menggeser indeks
        sheetRowIndices.sort((a, b) => b - a);

        const deletedNames = itemsToDelete.map(item => item.description);

        // Hapus satu per satu dari bawah ke atas
        for (const sheetIdx of sheetRowIndices) {
            await sheet.spreadsheet.batchUpdate({
                requests: [{
                    deleteDimension: {
                        range: {
                            sheetId: sheet.sheetId,
                            dimension: 'ROWS',
                            startIndex: sheetIdx - 1, // API uses 0-based
                            endIndex: sheetIdx
                        }
                    }
                }]
            });
        }

        // Sekarang recalculate total hari ini
        // Perlu reload lagi setelah delete
        _sheetReady = false;
        const sheet2 = await ensureSheetReady();
        const rows2 = await sheet2.getRows();
        const { totalRowIndex, blockStartIndex, isTodayBlock } = findTodayBlock(rows2, hariIndo);

        if (totalRowIndex !== -1 && isTodayBlock) {
            // Hitung ulang total
            let newTotal = 0;
            for (let i = blockStartIndex; i < totalRowIndex; i++) {
                const amt = parseFloat(rows2[i]._rawData[3] || 0);
                const tipe = rows2[i]._rawData[4] || '💸 Keluar';
                if (tipe.includes('Masuk')) {
                    newTotal += amt;
                } else {
                    newTotal -= amt;
                }
            }

            // Update total cell
            const totalSheetIdx = totalRowIndex + 2;
            await sheet2.loadCells({
                startRowIndex: totalSheetIdx - 1,
                endRowIndex: totalSheetIdx,
                startColumnIndex: 3,
                endColumnIndex: 4
            });
            const totalCell = sheet2.getCell(totalSheetIdx - 1, 3);
            totalCell.value = newTotal;
            await sheet2.saveUpdatedCells();

            // Cek apakah blok masih punya item data (selain Total)
            const dataRowCount = totalRowIndex - blockStartIndex;
            if (dataRowCount <= 0) {
                // Blok sudah kosong, hapus Total row juga
                await sheet2.spreadsheet.batchUpdate({
                    requests: [{
                        deleteDimension: {
                            range: {
                                sheetId: sheet2.sheetId,
                                dimension: 'ROWS',
                                startIndex: totalSheetIdx - 1,
                                endIndex: totalSheetIdx
                            }
                        }
                    }]
                });
            } else {
                // Re-merge kolom Hari (vertical) jika masih ada data
                try {
                    // Unmerge dulu supaya tidak error overlap
                    await sheet2.spreadsheet.batchUpdate({
                        requests: [{
                            unmergeCells: {
                                range: {
                                    sheetId: sheet2.sheetId,
                                    startRowIndex: blockStartIndex + 1,
                                    endRowIndex: totalSheetIdx,
                                    startColumnIndex: 0,
                                    endColumnIndex: 1
                                }
                            }
                        }]
                    });
                } catch { /* ignore if nothing to unmerge */ }

                if (dataRowCount > 1) {
                    try {
                        await sheet2.mergeCells({
                            startRowIndex: blockStartIndex + 1,
                            endRowIndex: totalSheetIdx - 1,
                            startColumnIndex: 0,
                            endColumnIndex: 1,
                        }, 'MERGE_ALL');
                    } catch { /* ignore merge errors */ }
                }
            }
        }

        return { success: true, deletedNames };
    } catch (error) {
        console.error('❌ [hapusItems Error]:', error.message || error);
        return { success: false, deletedNames: [] };
    }
}

// ============================================================================
// RANGKUMAN HARI INI
// ============================================================================
export async function getRangkumanHariIni() {
    const items = await getTodayData();
    if (items.length === 0) return null;

    let totalMasuk = 0;
    let totalKeluar = 0;
    const details = [];

    items.forEach(item => {
        const amt = parseFloat(item.amount || 0);
        const isMasuk = (item.tipe || '').includes('Masuk');
        if (isMasuk) {
            totalMasuk += amt;
        } else {
            totalKeluar += amt;
        }
        details.push({
            waktu: item.waktu,
            desc: item.description,
            amount: amt,
            tipe: isMasuk ? 'masuk' : 'keluar',
        });
    });

    return {
        items: details,
        totalMasuk,
        totalKeluar,
        saldo: totalMasuk - totalKeluar,
    };
}

// ============================================================================
// RANGKUMAN BULAN INI
// ============================================================================
export async function getRangkumanBulanIni() {
    try {
        const sheet = await ensureSheetReady();
        await ensureHeaders(sheet);
        const rows = await sheet.getRows();

        // Dapatkan bulan+tahun sekarang dalam format Indonesia
        const now = new Date();
        const bulanTahunNow = now.toLocaleString('id-ID', { 
            timeZone: 'Asia/Jakarta', 
            month: 'short', 
            year: 'numeric' 
        }); // e.g. "Mar 2026"

        let totalMasuk = 0;
        let totalKeluar = 0;
        let hariCount = 0;
        let currentDay = '';

        for (const row of rows) {
            const hariCell = row._rawData[0] || '';
            const desc = row._rawData[2] || '';
            const amt = parseFloat(row._rawData[3] || 0);
            const tipe = row._rawData[4] || '💸 Keluar';

            // Deteksi header hari yang mengandung bulan+tahun ini
            if (hariCell && hariCell !== 'Total' && hariCell !== '' && hariCell.includes(bulanTahunNow)) {
                currentDay = hariCell;
                hariCount++;
            }

            // Skip Total rows dan baris kosong
            if (hariCell === 'Total' || !desc) continue;

            // Hanya hitung jika dalam bulan ini
            if (currentDay.includes(bulanTahunNow)) {
                if (tipe.includes('Masuk')) {
                    totalMasuk += amt;
                } else {
                    totalKeluar += amt;
                }
            }
        }

        return {
            bulan: bulanTahunNow,
            totalMasuk,
            totalKeluar,
            saldo: totalMasuk - totalKeluar,
            jumlahHari: hariCount,
        };
    } catch (error) {
        console.error('❌ [getRangkumanBulanIni Error]:', error.message || error);
        return null;
    }
}

// ============================================================================
// INVALIDATE CACHE (dipanggil setelah operasi tulis)
// ============================================================================
export function invalidateCache() {
    _sheetReady = false;
}
