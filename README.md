# Farros Finance WA Bot

Bot WhatsApp sederhana untuk mencatat pengeluaran pribadi dan mengirim laporan harian ke Ibu.

## Fitur
- Catat pengeluaran lewat WhatsApp.
- Simpan data ke Supabase (Postgres).
- Laporan harian otomatis ke nomor Ibu.
- Perintah rekap manual (`rekap hari ini`, `kirim rekap`).

## Instalasi

1. Clone project ini (atau salin kodenya).
2. Install dependency:
   ```bash
   npm install
   ```
3. Salin `.env.example` menjadi `.env` dan isi variabelnya:
   ```bash
   cp .env.example .env
   ```
4. Jalankan SQL di `supabase.sql` pada SQL Editor di dashboard Supabase Anda untuk membuat tabel `expenses`.

## Menjalankan Bot

### Mode Development
```bash
npm run dev
```

### Mode Production
1. Build project:
   ```bash
   npm run build
   ```
2. Jalankan:
   ```bash
   npm start
   ```

## Cara Penggunaan

1. Jalankan bot, scan QR Code yang muncul di terminal menggunakan WhatsApp khusus bot.
2. Kirim pesan dari nomor Owner (sesuai `.env`) ke bot dengan format:
   `[subjek] [nominal]`
   
   Contoh:
   - `makan 15k`
   - `bensin 50rb`
   - `belanja 1.5jt`

3. Perintah Tambahan (dari nomor Owner):
   - `rekap hari ini`: Melihat rincian pengeluaran hari ini.
   - `kirim rekap`: Mengirim rincian pengeluaran hari ini ke nomor Ibu secara manual.

## Keamanan
- Gunakan nomor WhatsApp khusus untuk bot untuk menghindari banned pada nomor pribadi.
- Jangan commit file `.env` ke public repository.
- Jangan sebar `SUPABASE_SERVICE_ROLE_KEY`.
- Bot hanya merespon perintah dari nomor Owner yang terdaftar.
