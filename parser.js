/**
 * Mengurai (parse) teks pesan pengeluaran ke dalam bentuk objek.
 * Mendukung pembacaan angka di bagian akhir beserta akhiran 'k' atau 'rb' sebagai penanda ribuan.
 * 
 * @param {string} text - Kalimat pesan yang akan diparse
 * @returns {{ description: string, amount: number } | null}
 */
export function parseExpenseMessage(text) {
    if (!text || typeof text !== 'string') return null;

    // Membersihkan spasi di awal dan akhir kalimat
    text = text.trim();

    /**
     * Penjelasan Regex:
     * ^(.+?)     : Group 1 (Deskripsi) - Menangkap karakter apapun secara non-greedy minimal 1 char
     * \s+        : Harus ada minimal 1 spasi pemisah antara deskripsi dengan angka
     * ([\d.,]+)  : Group 2 (Angka) - Menangkap digit angka, termasuk jika user iseng pakai titik/koma
     * \s*        : Boleh ada spasi opsional sebelum suffix (bila diketik "200 rb" atau "20 k")
     * (k|rb)?    : Group 3 (Suffix Ribuan) - Menangkap huruf 'k' atau 'rb' (opsional)
     * $          : Harus berada di akhir string
     * /i         : Case-insensitive (mendukung HURUF BESAR K atau RB)
     */
    const match = text.match(/^(.+?)\s+([\d.,]+)\s*(k|rb)?$/i);

    if (!match) return null;

    const rawDescription = match[1].trim();
    
    // Hilangkan titik dan koma dari angka (misal user ketik 20.000 atau 20,000 menjadi 20000)
    const rawNumberStr = match[2].replace(/[,.]/g, ''); 
    const suffix = match[3] ? match[3].toLowerCase() : '';

    // Pastikan deskripsi tidak kosong setelah ditrim ulang
    if (!rawDescription) return null;

    let amount = Number(rawNumberStr);

    // Pastikan angka valid dan tidak NaN
    if (isNaN(amount)) return null;

    // Aturan konversi dari akhiran 'k' / 'rb' ke ribuan asli (dikalikan 1000)
    if (suffix === 'k' || suffix === 'rb') {
        amount *= 1000;
    }

    return {
        description: rawDescription,
        amount: amount
    };
}
