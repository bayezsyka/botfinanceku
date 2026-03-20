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

let _sheetReady = false;
export async function ensureSheetReady() {
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
    const hariIndo = now.toLocaleString('id-ID', { 
        timeZone: 'Asia/Jakarta', 
        weekday: 'long', 
        day: 'numeric', 
        month: 'short', 
        year: 'numeric' 
    });
    const waktuIndo = now.toLocaleString('id-ID', { 
        timeZone: 'Asia/Jakarta', 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: false 
    }).replace(/:/g, '.');

    return { hariIndo, waktuIndo };
}

function formatRupiah(num) {
    const abs = Math.abs(Number(num));
    const formatted = abs.toLocaleString('id-ID');
    return Number(num) < 0 ? `-Rp${formatted}` : `Rp${formatted}`;
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

    // Cari baris "Total" terakhir
    for (let i = rows.length - 1; i >= 0; i--) {
        const cellHari = rows[i]._rawData[0];
        if (cellHari === 'Total') {
            totalRowIndex = i;
            // Cari label hari ke atas
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
            // SISIPKAN DI ATAS TOTAL
            const totalRowSheetIdx = totalRowIndex + 2;
            await sheet.insertDimension('ROWS', {
                startIndex: totalRowSheetIdx - 1,
                endIndex: totalRowSheetIdx
            });

            await sheet.loadCells({
                startRowIndex: totalRowSheetIdx - 1,
                endRowIndex: totalRowSheetIdx + 1,
                startColumnIndex: 0,
                endColumnIndex: 5
            });

            sheet.getCell(totalRowSheetIdx - 1, 1).value = waktuIndo;
            sheet.getCell(totalRowSheetIdx - 1, 2).value = deskripsi;
            sheet.getCell(totalRowSheetIdx - 1, 3).value = Number(nominal);
            sheet.getCell(totalRowSheetIdx - 1, 4).value = tipe === 'pemasukan' ? '💰 Masuk' : '💸 Keluar';

            // Update Total
            const totalCell = sheet.getCell(totalRowSheetIdx, 3);
            const currentTotal = parseFloat(totalCell.value || 0);
            const delta = tipe === 'pemasukan' ? Number(nominal) : -Number(nominal);
            const newTotal = currentTotal + delta;
            totalCell.value = newTotal;

            await sheet.saveUpdatedCells();

            // Re-merge
            try {
                await doc._makeBatchUpdateRequest([{
                    mergeCells: {
                        range: {
                            sheetId: sheet.sheetId,
                            startRowIndex: blockStartIndex + 1,
                            endRowIndex: totalRowSheetIdx,
                            startColumnIndex: 0,
                            endColumnIndex: 1
                        },
                        mergeType: 'MERGE_ALL'
                    }
                }]);
            } catch (mergeErr) {}

            return { success: true, total: newTotal };

        } else {
            // BLOK BARU
            const startLoadIdx = rows.length + 1;
            const hasRows = rows.length > 0;
            const spacerOffset = hasRows ? 1 : 0;
            const dataRowIdx = startLoadIdx + spacerOffset;
            const totalRowIdx = dataRowIdx + 1;

            await sheet.loadCells({
                startRowIndex: startLoadIdx,
                endRowIndex: totalRowIdx + 1,
                startColumnIndex: 0,
                endColumnIndex: 5
            });

            // Day label + first item
            const cellHari = sheet.getCell(dataRowIdx, 0);
            cellHari.value = hariIndo;
            cellHari.verticalAlignment = 'MIDDLE';
            cellHari.horizontalAlignment = 'CENTER';
            cellHari.textFormat = { bold: true };

            sheet.getCell(dataRowIdx, 1).value = waktuIndo;
            sheet.getCell(dataRowIdx, 2).value = deskripsi;
            sheet.getCell(dataRowIdx, 3).value = Number(nominal);
            sheet.getCell(dataRowIdx, 4).value = tipe === 'pemasukan' ? '💰 Masuk' : '💸 Keluar';

            // Total row
            const cellTotalDesc = sheet.getCell(totalRowIdx, 0);
            cellTotalDesc.value = 'Total';
            const cellTotalVal = sheet.getCell(totalRowIdx, 3);
            cellTotalVal.value = tipe === 'pemasukan' ? Number(nominal) : -Number(nominal);

            // Styling
            for (let c = 0; c < 5; c++) {
                const cell = sheet.getCell(totalRowIdx, c);
                cell.backgroundColor = { red: 0.93, green: 0.93, blue: 0.93 };
                cell.textFormat = { bold: true };
            }

            await sheet.saveUpdatedCells();

            // Merge Total
            try {
                await doc._makeBatchUpdateRequest([{
                    mergeCells: {
                        range: {
                            sheetId: sheet.sheetId,
                            startRowIndex: totalRowIdx,
                            endRowIndex: totalRowIdx + 1,
                            startColumnIndex: 0,
                            endColumnIndex: 3
                        },
                        mergeType: 'MERGE_ALL'
                    }
                }]);
            } catch (mergeErr) {}

            return { success: true, total: cellTotalVal.value };
        }
    } catch (error) {
        console.error('❌ [catatTransaksi Error]:', error.message || error);
        return { success: false, total: 0 };
    }
}

export async function catatPengeluaran(tanggalFull, deskripsi, nominal) {
    return catatTransaksi(deskripsi, nominal, 'pengeluaran');
}

export async function catatPemasukan(deskripsi, nominal) {
    return catatTransaksi(deskripsi, nominal, 'pemasukan');
}

// ============================================================================
// GET DATA HARI INI
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

            if (hariCell === hariIndo) inTodayBlock = true;
            else if (hariCell && hariCell !== '' && hariCell !== hariIndo && hariCell !== 'Total') inTodayBlock = false;

            if (hariCell === 'Total') {
                if (inTodayBlock) break;
                continue;
            }

            if (inTodayBlock) {
                const desc = rows[i]._rawData[2] || '';
                const amt = rows[i]._rawData[3] || '0';
                const tipe = rows[i]._rawData[4] || '💸 Keluar';

                if (desc) {
                    todayItems.push({
                        waktu: rows[i]._rawData[1] || '',
                        description: desc,
                        amount: amt,
                        tipe,
                        sheetRowIndex: i + 2,
                    });
                }
            }
        }
        return todayItems;
    } catch (error) {
        return [];
    }
}

// ============================================================================
// HAPUS ITEM
// ============================================================================
export async function hapusItems(itemsToDelete) {
    try {
        _sheetReady = false;
        const sheet = await ensureSheetReady();
        await ensureHeaders(sheet);
        const { hariIndo } = getWIBDate();

        // Sort Bottom-to-Top
        const sheetRowIndices = [...new Set(itemsToDelete.map(item => item.sheetRowIndex))];
        sheetRowIndices.sort((a, b) => b - a);

        const deletedNames = itemsToDelete.map(item => item.description);

        for (const idx of sheetRowIndices) {
            await doc._makeBatchUpdateRequest([{
                deleteDimension: {
                    range: {
                        sheetId: sheet.sheetId,
                        dimension: 'ROWS',
                        startIndex: idx - 1,
                        endIndex: idx
                    }
                }
            }]);
        }

        // Cleanup empty blocks
        await cleanupAllStaleBlocks(sheet);

        return { success: true, deletedNames };
    } catch (error) {
        console.error('❌ [hapusItems Error]:', error.message || error);
        return { success: false, deletedNames: [] };
    }
}

// ============================================================================
// CLEANUP STALE BLOCKS
// ============================================================================
export async function cleanupAllStaleBlocks(sheet) {
    const rows = await sheet.getRows();
    const requests = [];

    for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i]._rawData[0] === 'Total') {
            const totalIndex = i;
            let foundData = false;
            let blockStart = -1;

            for (let j = i - 1; j >= 0; j--) {
                const head = rows[j]._rawData[0];
                const desc = rows[j]._rawData[2];
                
                // Break if we hit a different block's end
                if (head === 'Total') break;

                if (head && head !== 'Total') {
                    blockStart = j;
                    if (desc) foundData = true;
                    // Dont break yet, check if THIS specific row has data
                } else if (desc) {
                    foundData = true;
                }
            }

            if (!foundData) {
                // Delete Total row
                requests.push({
                    deleteDimension: {
                        range: {
                            sheetId: sheet.sheetId,
                            dimension: 'ROWS',
                            startIndex: totalIndex + 1,
                            endIndex: totalIndex + 2
                        }
                    }
                });
                
                // Delete Day Label row if exists
                if (blockStart !== -1) {
                    requests.push({
                        deleteDimension: {
                            range: {
                                sheetId: sheet.sheetId,
                                dimension: 'ROWS',
                                startIndex: blockStart + 1,
                                endIndex: blockStart + 2
                            }
                        }
                    });
                }

                // Delete spacers around it (if empty)
                if (totalIndex > 0 && !rows[totalIndex - 1]._rawData[0] && !rows[totalIndex - 1]._rawData[2] && totalIndex - 1 !== blockStart) {
                     requests.push({
                        deleteDimension: {
                            range: {
                                sheetId: sheet.sheetId,
                                dimension: 'ROWS',
                                startIndex: totalIndex,
                                endIndex: totalIndex + 1
                            }
                        }
                    });
                }
            }
        }
    }

    if (requests.length > 0) {
        // Execute back to front to avoid index shift
        requests.sort((a, b) => b.deleteDimension.range.startIndex - a.deleteDimension.range.startIndex);
        await doc._makeBatchUpdateRequest(requests);
    }
}

// ============================================================================
// RANGKUMAN
// ============================================================================
export async function getRangkumanHariIni() {
    const items = await getTodayData();
    if (items.length === 0) return null;

    let totalMasuk = 0;
    let totalKeluar = 0;
    const details = items.map(item => {
        const amt = parseFloat(item.amount || 0);
        const isMasuk = item.tipe.includes('Masuk');
        if (isMasuk) totalMasuk += amt; else totalKeluar += amt;
        return { waktu: item.waktu, desc: item.description, amount: amt, tipe: isMasuk ? 'masuk' : 'keluar' };
    });

    return { items: details, totalMasuk, totalKeluar, saldo: totalMasuk - totalKeluar };
}

export async function getRangkumanBulanIni() {
    try {
        const sheet = await ensureSheetReady();
        const rows = await sheet.getRows();
        const now = new Date();
        const bulanTahunNow = now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', month: 'short', year: 'numeric' });

        let totalMasuk = 0; let totalKeluar = 0; let hariCount = 0; let currentDay = '';
        for (const row of rows) {
            const hariCell = row._rawData[0] || '';
            const desc = row._rawData[2] || '';
            const amt = parseFloat(row._rawData[3] || 0);
            const tipe = row._rawData[4] || '💸 Keluar';

            if (hariCell && hariCell !== 'Total' && hariCell.includes(bulanTahunNow)) { currentDay = hariCell; hariCount++; }
            if (hariCell === 'Total' || !desc) continue;
            if (currentDay.includes(bulanTahunNow)) {
                if (tipe.includes('Masuk')) totalMasuk += amt; else totalKeluar += amt;
            }
        }
        return { bulan: bulanTahunNow, totalMasuk, totalKeluar, saldo: totalMasuk - totalKeluar, jumlahHari: hariCount };
    } catch (e) { return null; }
}

export function invalidateCache() { _sheetReady = false; }
