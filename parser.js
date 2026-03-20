/**
 * Mengurai (parse) teks pesan transaksi ke dalam bentuk objek.
 * 
 * Mendukung:
 * - Pengeluaran: "kopi 15k", "makan siang 25000", "bensin 50rb"
 * - Pemasukan:   "+gaji 5000000", "+freelance 2.5k", "masuk gaji 5jt"
 * - Suffix angka: k/rb (ribuan), jt (jutaan)
 * 
 * @param {string} text - Kalimat pesan yang akan diparse
 * @returns {{ description: string, amount: number, tipe: 'pengeluaran' | 'pemasukan' } | null}
 */
export function parseExpenseMessage(text) {
    if (!text || typeof text !== 'string') return null;

    text = text.trim();

    // Deteksi apakah ini pemasukan
    let tipe = 'pengeluaran';
    let cleanText = text;

    // Pattern pemasukan: dimulai dengan "+" atau kata "masuk"
    if (cleanText.startsWith('+')) {
        tipe = 'pemasukan';
        cleanText = cleanText.slice(1).trim();
    } else if (/^masuk\s+/i.test(cleanText)) {
        tipe = 'pemasukan';
        cleanText = cleanText.replace(/^masuk\s+/i, '').trim();
    }

    /**
     * Regex utama:
     * ^(.+?)     : Group 1 (Deskripsi) - non-greedy, minimal 1 char
     * \s+        : Minimal 1 spasi pemisah
     * ([\d.,]+)  : Group 2 (Angka) - digit + titik/koma
     * \s*        : Spasi opsional sebelum suffix
     * (k|rb|jt)? : Group 3 (Suffix) - k/rb = ribuan, jt = jutaan
     * $          : Akhir string
     * /i         : Case-insensitive
     */
    const match = cleanText.match(/^(.+?)\s+([\d.,]+)\s*(k|rb|jt)?$/i);

    if (!match) return null;

    const rawDescription = match[1].trim();
    const rawNumberStr = match[2].replace(/[,.]/g, '');
    const suffix = match[3] ? match[3].toLowerCase() : '';

    if (!rawDescription) return null;

    let amount = Number(rawNumberStr);
    if (isNaN(amount) || amount <= 0) return null;

    // Konversi suffix
    if (suffix === 'k' || suffix === 'rb') {
        amount *= 1000;
    } else if (suffix === 'jt') {
        amount *= 1000000;
    }

    return {
        description: rawDescription,
        amount: amount,
        tipe: tipe
    };
}
