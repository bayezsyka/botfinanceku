import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import crypto from 'crypto';
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

/** Centralized Error Handler */
async function handleSheetsError(fnName, error) {
    console.error(`❌ [Sheets Error in ${fnName}]:`, error.message || error);
    return null;
}

export async function ensureSheetReady() {
    try {
        if (!_sheetReady) {
            await doc.loadInfo();
            _sheetReady = true;
        }
        return doc.sheetsByIndex[0];
    } catch (error) {
        return handleSheetsError('ensureSheetReady', error);
    }
}

// ============================================================================
// HEADER SETUP (Added ID Column)
// ============================================================================
const HEADERS = ['Hari', 'Waktu', 'Deskripsi', 'Nominal', 'Tipe', 'ID'];

async function ensureHeaders(sheet) {
    try {
        await sheet.loadHeaderRow();
        if (!sheet.headerValues || sheet.headerValues.length < 6 || sheet.headerValues[5] !== 'ID') {
            await sheet.setHeaderRow(HEADERS);
        }
    } catch {
        await sheet.setHeaderRow(HEADERS);
    }
}

// ============================================================================
// HELPERS
// ============================================================================
function getWIBDate() {
    const now = new Date();
    const hariIndo = now.toLocaleString('id-ID', { 
        timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' 
    });
    const waktuIndo = now.toLocaleString('id-ID', { 
        timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false 
    }).replace(/:/g, '.');
    return { hariIndo, waktuIndo };
}

/** Dynamic Lookup: Cari baris berdasarkan UUID */
async function findRowByUUID(sheet, uuid) {
    if (!uuid) return null;
    const rows = await sheet.getRows();
    return rows.find(r => r._rawData[5] === uuid);
}

function findTodayBlock(rows, hariIndo) {
    let totalRowIndex = -1;
    let blockStartIndex = -1;
    let isTodayBlock = false;

    for (let i = rows.length - 1; i >= 0; i--) {
        const cellHari = rows[i]._rawData[0];
        if (cellHari === 'Total') {
            totalRowIndex = i;
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
// CORE OPERATIONS
// ============================================================================
export async function catatTransaksi(deskripsi, nominal, tipe = 'pengeluaran') {
    try {
        const sheet = await ensureSheetReady();
        if (!sheet) throw new Error('Sheet not accessible');
        await ensureHeaders(sheet);

        const { hariIndo, waktuIndo } = getWIBDate();
        const uuid = crypto.randomUUID();
        const rows = await sheet.getRows();
        const { totalRowIndex, blockStartIndex, isTodayBlock } = findTodayBlock(rows, hariIndo);

        if (totalRowIndex !== -1 && isTodayBlock) {
            const totalRowSheetIdx = totalRowIndex + 2;
            await sheet.insertDimension('ROWS', { startIndex: totalRowSheetIdx - 1, endIndex: totalRowSheetIdx });
            
            await sheet.loadCells({
                startRowIndex: totalRowSheetIdx - 1,
                endRowIndex: totalRowSheetIdx + 1,
                startColumnIndex: 0, endColumnIndex: 6
            });

            sheet.getCell(totalRowSheetIdx - 1, 1).value = waktuIndo;
            sheet.getCell(totalRowSheetIdx - 1, 2).value = deskripsi;
            sheet.getCell(totalRowSheetIdx - 1, 3).value = Number(nominal);
            sheet.getCell(totalRowSheetIdx - 1, 4).value = tipe === 'pemasukan' ? '💰 Masuk' : '💸 Keluar';
            sheet.getCell(totalRowSheetIdx - 1, 5).value = uuid;

            const totalCell = sheet.getCell(totalRowSheetIdx, 3);
            const currentTotal = parseFloat(totalCell.value || 0);
            const delta = tipe === 'pemasukan' ? Number(nominal) : -Number(nominal);
            const newTotal = currentTotal + delta;
            totalCell.value = newTotal;

            await sheet.saveUpdatedCells();
            return { success: true, total: newTotal };
        } else {
            // BLOK BARU
            const dataRowIdx = rows.length + (rows.length > 0 ? 2 : 1);
            const totalRowIdx = dataRowIdx + 1;

            await sheet.loadCells({
                startRowIndex: dataRowIdx, endRowIndex: totalRowIdx + 1,
                startColumnIndex: 0, endColumnIndex: 6
            });

            sheet.getCell(dataRowIdx, 0).value = hariIndo;
            sheet.getCell(dataRowIdx, 1).value = waktuIndo;
            sheet.getCell(dataRowIdx, 2).value = deskripsi;
            sheet.getCell(dataRowIdx, 3).value = Number(nominal);
            sheet.getCell(dataRowIdx, 4).value = tipe === 'pemasukan' ? '💰 Masuk' : '💸 Keluar';
            sheet.getCell(dataRowIdx, 5).value = uuid;

            sheet.getCell(totalRowIdx, 0).value = 'Total';
            const cellTotalVal = sheet.getCell(totalRowIdx, 3);
            cellTotalVal.value = tipe === 'pemasukan' ? Number(nominal) : -Number(nominal);

            await sheet.saveUpdatedCells();
            return { success: true, total: cellTotalVal.value };
        }
    } catch (error) {
        await handleSheetsError('catatTransaksi', error);
        return { success: false, total: 0 };
    }
}

export async function getTodayData() {
    try {
        const sheet = await ensureSheetReady();
        if (!sheet) return [];
        const rows = await sheet.getRows();
        const { hariIndo } = getWIBDate();
        let inTodayBlock = false;
        const todayItems = [];

        for (let i = 0; i < rows.length; i++) {
            const hariCell = rows[i]._rawData[0];
            if (hariCell === hariIndo) inTodayBlock = true;
            else if (hariCell && hariCell !== 'Total' && hariCell !== hariIndo) inTodayBlock = false;
            
            if (hariCell === 'Total') { if (inTodayBlock) break; continue; }

            if (inTodayBlock) {
                const desc = rows[i]._rawData[2] || '';
                const uuid = rows[i]._rawData[5] || '';
                if (desc && !desc.includes('[DELETED]')) {
                    todayItems.push({
                        waktu: rows[i]._rawData[1] || '',
                        description: desc,
                        amount: rows[i]._rawData[3] || '0',
                        tipe: rows[i]._rawData[4] || '💸 Keluar',
                        uuid: uuid
                    });
                }
            }
        }
        return todayItems;
    } catch (error) {
        await handleSheetsError('getTodayData', error);
        return [];
    }
}

export async function hapusItems(itemsToDelete) {
    try {
        const sheet = await ensureSheetReady();
        if (!sheet) throw new Error('Sheet not accessible');
        const deletedNames = [];

        for (const item of itemsToDelete) {
            const row = await findRowByUUID(sheet, item.uuid);
            if (row) {
                const currentDesc = row._rawData[2];
                const currentAmount = parseFloat(row._rawData[3] || 0);
                const currentTipe = row._rawData[4] || '';

                // Soft Delete (Opsi A)
                row._rawData[2] = `[DELETED] ${currentDesc}`;
                row._rawData[3] = 0;
                await row.save();

                // Sync Total
                const rows = await sheet.getRows();
                for (let i = row.rowNumber - 1; i < rows.length; i++) {
                    if (rows[i]._rawData[0] === 'Total') {
                        const currentTotal = parseFloat(rows[i]._rawData[3] || 0);
                        const delta = currentTipe.includes('Masuk') ? -currentAmount : currentAmount;
                        rows[i]._rawData[3] = currentTotal + delta;
                        await rows[i].save();
                        break;
                    }
                }
                deletedNames.push(currentDesc);
            }
        }
        invalidateCache();
        return { success: true, deletedNames };
    } catch (error) {
        await handleSheetsError('hapusItems', error);
        return { success: false, deletedNames: [] };
    }
}

export async function resetSemuaData() {
    try {
        const sheet = await ensureSheetReady();
        if (!sheet) throw new Error('Sheet not accessible');
        
        await doc._makeBatchUpdateRequest([{
            unmergeCells: { range: { sheetId: sheet.sheetId, startRowIndex: 0, startColumnIndex: 0 } }
        }]);

        await sheet.clearRows();
        await sheet.resize({ rowCount: 100, columnCount: HEADERS.length });
        await ensureHeaders(sheet);
        
        invalidateCache();
        return true;
    } catch (error) {
        await handleSheetsError('resetSemuaData', error);
        return false;
    }
}

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
            if (hariCell === 'Total' || !desc || desc.includes('[DELETED]')) continue;
            if (currentDay.includes(bulanTahunNow)) {
                if (tipe.includes('Masuk')) totalMasuk += amt; else totalKeluar += amt;
            }
        }
        return { bulan: bulanTahunNow, totalMasuk, totalKeluar, saldo: totalMasuk - totalKeluar, jumlahHari: hariCount };
    } catch (e) { return null; }
}

export function invalidateCache() { _sheetReady = false; }
export async function cleanupAllStaleBlocks() { return true; } // Placeholder for compatibility
