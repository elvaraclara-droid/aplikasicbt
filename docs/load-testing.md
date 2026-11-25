# Pengujian Performa & Kapasitas (Target 500 Siswa) — CBT SMART EXAM

## Alat Pengujian Tersedia
Proyek menyediakan skrip load test bertahap di `scripts/load-test.mjs` serta orkestrator uji beban bertahap di `scripts/run-staged-load-test.mjs`:

```bash
# Tahap 1–4 probe konektivitas & lifecycle ujian
node scripts/load-test.mjs --users=50 --target=https://staging.domain.sch.id --mode=full-exam
node scripts/load-test.mjs --users=100 --target=https://staging.domain.sch.id --mode=full-exam
node scripts/load-test.mjs --users=250 --target=https://staging.domain.sch.id --mode=full-exam
node scripts/load-test.mjs --users=500 --target=https://staging.domain.sch.id --mode=full-exam
```

## Hasil Pengujian Teramati (Server Produksi Lokal `next start` → Live Supabase `ap-southeast-1`)

### A. Probe Konkurensi `/api/health` + Kueri PostgreSQL Live
| Jumlah Permintaan Serentak | Total Permintaan | Gagal | Throughput | p50 | p95 | p99 |
|---|---|---|---|---|---|---|
| 50 | 50 | 0 (0.00%) | 38.77 req/s | 1112.2 ms | 1198.2 ms | 1203.8 ms |
| 100 | 100 | 0 (0.00%) | 35.60 req/s | 2528.0 ms | 2647.3 ms | 2653.4 ms |
| 250 | 250 | 0 (0.00%) | 47.70 req/s | 4766.3 ms | 5047.6 ms | 5126.3 ms |
| 500 | 500 | 0 (0.00%) | 49.14 req/s | 8813.3 ms | 9803.0 ms | 9873.2 ms |

### B. Alur Ujian Lengkap (`full-exam`: Login 3-Komponen → Start → Soal → 5 Autosave → Heartbeat)
| Virtual Users (Burst Tanpa Jeda) | Total Permintaan | Gagal | Throughput | p50 | p95 | p99 | Catatan Observasi |
|---|---|---|---|---|---|---|---|
| 25 VU | 225 | 0 (0.00%) | 9.31 req/s | 1791.1 ms | 8879.3 ms | 9127.0 ms | Seluruh alur ujian lulus 100% |
| 50 VU (burst serentak 0 ms) | 178 | 34 (19.10%) | 7.86 req/s | 2148.9 ms | 5558.9 ms | 5700.1 ms | Seluruh 34 kegagalan berasal dari `auth_logs` `429 over_request_rate_limit` pada Supabase Auth tier saat ini; 16 sesi yang lolos menyelesaikan seluruh autosave & heartbeat 100% tanpa galat |

## Temuan Bottleneck & Rencana Kapasitas 500 Siswa Nyata
- **Bottleneck Terverifikasi:** Batas burst endpoint Supabase Auth (`/auth/v1/token` → `over_request_rate_limit` HTTP 429) saat menerima puluhan login serentak dalam <1 detik dari satu server Next.js. Penanganan aplikasi telah diperbaiki agar HTTP 429 mengembalikan pesan antrean padat tanpa mengurangi jatah percobaan password siswa.
- **Kejujuran Pengujian:** Uji alur ujian penuh 100, 250, dan 500 VU **belum tercapai tanpa limitasi** pada paket Supabase saat ini dan URL staging Vercel masih terlindungi Vercel Authentication + belum memasang `SUPABASE_SERVICE_ROLE_KEY`. Untuk pelaksanaan riil 500 peserta bersamaan, naikkan limit rate auth & koneksi PgBouncer pada paket Supabase produksi, terapkan login bertahap per sesi/ruang, lalu ulangi `scripts/load-test.mjs` 50 → 100 → 250 → 500 VU di lingkungan staging.
