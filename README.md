# Kedai Kopi Saung

Sistem pemesanan online untuk UMKM kuliner (studi kasus warung kopi), dijalankan di atas **Self-Hosted PaaS Coolify**.
Proyek Akhir PaaS — XII SIJA, SMKN 1 Cimahi.

## Fitur

- **Halaman pelanggan** (`/`): katalog menu dengan foto, filter kategori, keranjang, kirim pesanan, struk digital, dan lacak status pesanan.
- **Halaman dapur / admin** (`/admin`): kelola pesanan (baru → diseduh → siap → selesai), ubah harga, tandai menu habis, tambah/hapus menu, ringkasan penjualan.
- Data tersimpan di **PostgreSQL**. Tabel dibuat otomatis saat aplikasi pertama kali berjalan.

## Teknologi

| Bagian | Teknologi |
|---|---|
| Backend | Node.js 22 + Express |
| Database | PostgreSQL |
| Frontend | HTML, CSS, JavaScript (tanpa framework) |
| Container | Docker (multi-stage, `node:22-alpine`) |
| PaaS | Coolify (reverse proxy Traefik, HTTPS) |
| CI/CD | GitHub + GitHub Actions → webhook deploy Coolify |

## Variabel lingkungan

| Nama | Wajib | Keterangan |
|---|---|---|
| `DATABASE_URL` | Ya | URL koneksi PostgreSQL, contoh `postgres://user:pass@host:5432/postgres` |
| `ADMIN_PASSWORD` | Ya | Password untuk masuk ke `/admin` |
| `PORT` | Tidak | Port aplikasi, bawaan `3000` |

## Endpoint API

| Metode | Path | Fungsi |
|---|---|---|
| GET | `/health` | Cek kesehatan aplikasi dan koneksi database |
| GET | `/api/info` | Versi aplikasi dan waktu deploy |
| GET | `/api/menu` | Daftar menu |
| POST | `/api/orders` | Membuat pesanan |
| GET | `/api/orders/:kode` | Status pesanan |
| GET | `/api/pulse` | Jumlah kopi yang diseduh hari ini |
| * | `/api/admin/*` | Kelola pesanan dan menu (header `x-admin-key`) |

## Menjalankan secara lokal

```bash
npm install
DATABASE_URL=postgres://user:pass@localhost:5432/postgres ADMIN_PASSWORD=rahasia npm start
```

Buka `http://localhost:3000`.

## Struktur folder

```
kedai-kopi-saung/
├── server.js          # server Express + API + koneksi PostgreSQL
├── seed.js            # data menu awal
├── package.json
├── Dockerfile         # resep image Docker untuk Coolify
└── public/            # halaman web
    ├── index.html, style.css, app.js     # halaman pelanggan
    ├── admin.html, admin.css, admin.js   # halaman dapur
    └── img/                              # foto menu
```

Foto: Unsplash.
