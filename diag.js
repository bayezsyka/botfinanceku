import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import dotenv from 'dotenv';
dotenv.config();

const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, serviceAccountAuth);

async function diagnostic() {
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    console.log(`Sheet: ${sheet.title}`);
    console.log(`Rows: ${sheet.rowCount}, Cols: ${sheet.columnCount}`);
    
    const rows = await sheet.getRows();
    console.log(`Found ${rows.length} rows via getRows()`);
    rows.forEach((r, i) => {
        console.log(`Row ${i}:`, r._rawData);
    });

    // Cek Headers
    await sheet.loadHeaderRow();
    console.log('Headers found:', sheet.headerValues);
}
diagnostic();
