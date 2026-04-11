import nodeHtmlToImage from 'node-html-to-image';
import QuickChart from 'quickchart-js';

// ============================================================================
// FORMATTING HELPER
// ============================================================================
function formatRupiah(num) {
    const abs = Math.abs(Number(num));
    const formatted = abs.toLocaleString('id-ID');
    return Number(num) < 0 ? `-Rp${formatted}` : `Rp${formatted}`;
}

// ============================================================================
// 1. RANGKUMAN FOTO (Daily Snapshot)
// ============================================================================
export async function generateRangkumanFoto(dataRangkuman) {
    try {
        if (!dataRangkuman || !dataRangkuman.items || dataRangkuman.items.length === 0) {
            return null; // Tidak ada data
        }

        const dateObj = new Date();
        const dateStr = dateObj.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

        let rowsHtml = '';
        dataRangkuman.items.forEach(item => {
            const isMasuk = item.tipe === 'masuk';
            const colorClass = isMasuk ? 'text-green' : 'text-red';
            const icon = isMasuk ? '💰' : '💸';
            
            rowsHtml += `
                <tr>
                    <td>${item.waktu}</td>
                    <td>${item.desc}</td>
                    <td>${icon}</td>
                    <td class="${colorClass}">${formatRupiah(item.amount)}</td>
                </tr>
            `;
        });

        const html = `
            <html>
                <head>
                    <style>
                        body {
                            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                            background-color: #f3f4f6;
                            padding: 20px;
                            width: 600px;
                        }
                        .container {
                            background-color: #ffffff;
                            border-radius: 12px;
                            padding: 24px;
                            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
                        }
                        .header {
                            text-align: center;
                            margin-bottom: 24px;
                            border-bottom: 2px solid #f3f4f6;
                            padding-bottom: 16px;
                        }
                        h1 {
                            margin: 0;
                            color: #1f2937;
                            font-size: 24px;
                        }
                        .date {
                            color: #6b7280;
                            font-size: 14px;
                            margin-top: 4px;
                        }
                        table {
                            width: 100%;
                            border-collapse: collapse;
                            margin-bottom: 24px;
                        }
                        th {
                            background-color: #f9fafb;
                            color: #374151;
                            font-weight: 600;
                            text-align: left;
                            padding: 12px;
                            border-bottom: 2px solid #e5e7eb;
                        }
                        td {
                            padding: 12px;
                            border-bottom: 1px solid #e5e7eb;
                            color: #4b5563;
                        }
                        .text-green { color: #10b981; font-weight: 600; }
                        .text-red { color: #ef4444; font-weight: 600; }
                        .summary {
                            background-color: #f8fafc;
                            border-radius: 8px;
                            padding: 16px;
                        }
                        .summary-row {
                            display: flex;
                            justify-content: space-between;
                            margin-bottom: 8px;
                            font-size: 15px;
                        }
                        .summary-total {
                            display: flex;
                            justify-content: space-between;
                            margin-top: 12px;
                            padding-top: 12px;
                            border-top: 2px dashed #cbd5e1;
                            font-size: 18px;
                            font-weight: bold;
                            color: #0f172a;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>📊 Rangkuman Transaksi</h1>
                            <div class="date">${dateStr}</div>
                        </div>
                        
                        <table>
                            <thead>
                                <tr>
                                    <th>Waktu</th>
                                    <th>Deskripsi</th>
                                    <th>Tipe</th>
                                    <th>Nominal</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rowsHtml}
                            </tbody>
                        </table>

                        <div class="summary">
                            <div class="summary-row">
                                <span style="color:#64748b">Total Pemasukan</span>
                                <span class="text-green">${formatRupiah(dataRangkuman.totalMasuk)}</span>
                            </div>
                            <div class="summary-row">
                                <span style="color:#64748b">Total Pengeluaran</span>
                                <span class="text-red">${formatRupiah(dataRangkuman.totalKeluar)}</span>
                            </div>
                            <div class="summary-total">
                                <span>SALDO HARI INI</span>
                                <span style="color: ${dataRangkuman.saldo >= 0 ? '#10b981' : '#ef4444'}">${formatRupiah(dataRangkuman.saldo)}</span>
                            </div>
                        </div>
                    </div>
                </body>
            </html>
        `;

        const imageBuffer = await nodeHtmlToImage({
            html: html,
            quality: 100,
            type: 'jpeg',
            puppeteerArgs: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
        });

        return imageBuffer;
    } catch (error) {
        console.error('❌ [generateRangkumanFoto Error]:', error);
        return null;
    }
}

// ============================================================================
// 2. GRAFIK (Weekly Dynamic Chart)
// ============================================================================
export async function generateGrafikMingguIni(dataMinggu) {
    try {
        if (!dataMinggu || dataMinggu.length === 0) return null;

        // dataMinggu expected: Array of { date: 'Senin', balance: 50000 }
        const labels = dataMinggu.map(d => d.date);
        const balances = dataMinggu.map(d => d.balance);

        const chart = new QuickChart();
        chart.setWidth(600)
        chart.setHeight(400)
        chart.setVersion('2');

        chart.setConfig({
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Saldo Harian (Rp)',
                    data: balances,
                    borderColor: 'rgba(54, 162, 235, 1)', // Blue primary line
                    backgroundColor: 'rgba(54, 162, 235, 0.1)',
                    borderWidth: 3,
                    fill: false,
                    pointBackgroundColor: balances.map(b => b >= 0 ? '#10b981' : '#ef4444'),
                    pointRadius: 6,
                    pointHoverRadius: 8
                }]
            },
            options: {
                title: {
                    display: true,
                    text: 'Grafik Saldo Minggu Ini',
                    fontSize: 20,
                    fontFamily: 'sans-serif',
                    padding: 20
                },
                legend: { display: false },
                scales: {
                    yAxes: [{
                        ticks: {
                            callback: (val) => {
                                return val >= 1000 || val <= -1000 
                                    ? (val / 1000) + 'k' 
                                    : val;
                            }
                        }
                    }]
                },
                annotation: {
                    annotations: [{
                        type: 'line',
                        mode: 'horizontal',
                        scaleID: 'y-axis-0',
                        value: 0,
                        borderColor: '#ef4444',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        label: {
                            enabled: true,
                            content: 'Garis Nol (Rp 0)'
                        }
                    }]
                }
            }
        });

        // Get Image Buffer directly
        const buffer = await chart.toBinary();
        return buffer;

    } catch (error) {
        console.error('❌ [generateGrafikMingguIni Error]:', error);
        return null;
    }
}
