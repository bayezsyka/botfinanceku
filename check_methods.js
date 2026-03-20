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

async function check() {
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    console.log('Doc properties:', Object.keys(doc).filter(k => k.includes('Batch')));
    console.log('Sheet properties:', Object.keys(sheet).filter(k => k.includes('Batch')));
    console.log('Doc prototype:', Object.getOwnPropertyNames(Object.getPrototypeOf(doc)).filter(k => k.includes('Batch') || k.includes('update')));
    console.log('Sheet prototype:', Object.getOwnPropertyNames(Object.getPrototypeOf(sheet)).filter(k => k.includes('Batch') || k.includes('update')));
}
check();
