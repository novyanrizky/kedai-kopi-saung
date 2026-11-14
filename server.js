'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Pool } = require('pg');
const seed = require('./seed');
const pkg = require('./package.json');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DEPLOYED_AT = new Date().toISOString();
const STATUSES = ['baru', 'diseduh', 'siap', 'selesai', 'batal'];
const CATEGORIES = ['kopi', 'non-kopi', 'makanan'];
const CODE_CHARS = 'ACDEFGHJKMNPQRTUVWXY3479';

// ---------- Database ----------
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
pool.on('error', (err) => console.error('[db] koneksi idle error:', err.message));
let dbReady = false;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS menu (
  id          SERIAL PRIMARY KEY,
  slug        TEXT UNIQUE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  price       INTEGER NOT NULL CHECK (price >= 0),
  description TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  image       TEXT NOT NULL DEFAULT '',
  tag         TEXT NOT NULL DEFAULT '',
  available   BOOLEAN NOT NULL DEFAULT TRUE,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS orders (
  id          SERIAL PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,
  customer    TEXT NOT NULL,
  order_type  TEXT NOT NULL DEFAULT 'dine-in',
  table_no    TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  total       INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'baru',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS order_items (
  id        SERIAL PRIMARY KEY,
  order_id  INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_id   INTEGER REFERENCES menu(id) ON DELETE SET NULL,
  name      TEXT NOT NULL,
  category  TEXT NOT NULL DEFAULT '',
  price     INTEGER NOT NULL,
  qty       INTEGER NOT NULL CHECK (qty > 0)
);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders (created_at DESC);
`;

async function initDb() {
  if (!process.env.DATABASE_URL) {
    console.error('[db] DATABASE_URL belum diatur. Isi di Environment Variables Coolify.');
  }
  for (let attempt = 1; ; attempt++) {
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(SCHEMA);
        const { rows } = await client.query('SELECT count(*)::int AS n FROM menu');
        if (rows[0].n === 0) {
          for (const m of seed) {
            await client.query(
              `INSERT INTO menu (slug, name, category, price, description, notes, image, tag, sort)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [m.slug, m.name, m.category, m.price, m.description, m.notes, m.image, m.tag, m.sort]
            );
          }
          console.log(`[db] ${seed.length} menu awal dimasukkan.`);
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
      dbReady = true;
      console.log('[db] Terhubung ke PostgreSQL, tabel siap.');
      return;
    } catch (err) {
      console.error(`[db] Percobaan ${attempt} gagal: ${err.message}. Mencoba lagi dalam 3 detik...`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

// Awal hari ini menurut WIB, untuk statistik harian.
const TODAY_WIB = `(date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta')`;

// ---------- Helpers ----------
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' https: data:; style-src 'self' https://fonts.googleapis.com; " +
      "font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'self'",
  });
  next();
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function requireDb(req, res, next) {
  if (!dbReady) return res.status(503).json({ error: 'Database belum siap, coba lagi sebentar.' });
  next();
}

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'ADMIN_PASSWORD belum diatur di server.' });
  const given = req.get('x-admin-key') || '';
  if (!crypto.timingSafeEqual(hash(given), hash(ADMIN_PASSWORD))) {
    return res.status(401).json({ error: 'Password admin salah.' });
  }
  next();
}

// Batas sederhana: maksimal 30 pesanan per 10 menit per alamat IP.
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const list = (hits.get(req.ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (list.length >= 30) return res.status(429).json({ error: 'Terlalu banyak pesanan. Coba lagi nanti.' });
  list.push(now);
  hits.set(req.ip, list);
  next();
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const toInt = (v) => (Number.isInteger(Number(v)) ? Number(v) : NaN);

function makeCode() {
  let c = '';
  for (let i = 0; i < 5; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  return c;
}

async function loadOrder(where, params) {
  const { rows } = await pool.query(
    `SELECT o.*, COALESCE(json_agg(json_build_object('name', i.name, 'qty', i.qty, 'price', i.price)
              ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
       FROM orders o LEFT JOIN order_items i ON i.order_id = o.id
      WHERE ${where} GROUP BY o.id ORDER BY o.created_at DESC LIMIT 100`,
    params
  );
  return rows;
}

// ---------- API publik ----------
app.get('/health', (req, res) => res.json({ status: 'ok', db: dbReady ? 'connected' : 'connecting' }));

app.get('/api/info', (req, res) => {
  res.json({ name: 'Kedai Kopi Saung', version: pkg.version, deployedAt: DEPLOYED_AT, node: process.version });
});

app.get('/api/menu', requireDb, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, category, price, description, notes, image, tag, available
       FROM menu ORDER BY sort, id`
  );
  res.set('Cache-Control', 'no-store').json(rows);
}));

app.get('/api/pulse', requireDb, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM orders WHERE created_at >= ${TODAY_WIB} AND status <> 'batal') AS orders,
       (SELECT COALESCE(sum(i.qty), 0)::int FROM order_items i JOIN orders o ON o.id = i.order_id
         WHERE o.created_at >= ${TODAY_WIB} AND o.status <> 'batal' AND i.category = 'kopi') AS cups`
  );
  res.set('Cache-Control', 'no-store').json(rows[0]);
}));

app.post('/api/orders', requireDb, rateLimit, wrap(async (req, res) => {
  const b = req.body || {};
  const customer = str(b.customer, 40);
  const orderType = b.orderType === 'takeaway' ? 'takeaway' : 'dine-in';
  const tableNo = orderType === 'dine-in' ? str(b.tableNo, 10) : '';
  const note = str(b.note, 140);
  if (customer.length < 2) throw new HttpError(400, 'Nama pemesan minimal 2 huruf.');
  if (!Array.isArray(b.items) || b.items.length === 0) throw new HttpError(400, 'Pesanan masih kosong.');
  if (b.items.length > 20) throw new HttpError(400, 'Maksimal 20 jenis menu per pesanan.');

  const qtyById = new Map();
  for (const it of b.items) {
    const id = toInt(it && it.id);
    const qty = toInt(it && it.qty);
    if (!(id > 0) || !(qty >= 1 && qty <= 20)) throw new HttpError(400, 'Jumlah menu tidak valid (1–20).');
    qtyById.set(id, (qtyById.get(id) || 0) + qty);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Harga selalu diambil dari database, bukan dari browser.
    const { rows: menu } = await client.query(
      'SELECT id, name, category, price, available FROM menu WHERE id = ANY($1::int[])',
      [[...qtyById.keys()]]
    );
    if (menu.length !== qtyById.size) throw new HttpError(409, 'Ada menu yang sudah tidak tersedia. Muat ulang halaman.');
    const soldOut = menu.find((m) => !m.available);
    if (soldOut) throw new HttpError(409, `${soldOut.name} sedang habis.`);

    const total = menu.reduce((sum, m) => sum + m.price * qtyById.get(m.id), 0);
    let order;
    for (let tries = 0; !order && tries < 5; tries++) {
      const r = await client.query(
        `INSERT INTO orders (code, customer, order_type, table_no, note, total)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (code) DO NOTHING
         RETURNING id, code, customer, order_type, table_no, note, total, status, created_at`,
        [makeCode(), customer, orderType, tableNo, note, total]
      );
      order = r.rows[0];
    }
    if (!order) throw new Error('Gagal membuat kode pesanan unik.');

    for (const m of menu) {
      await client.query(
        'INSERT INTO order_items (order_id, menu_id, name, category, price, qty) VALUES ($1,$2,$3,$4,$5,$6)',
        [order.id, m.id, m.name, m.category, m.price, qtyById.get(m.id)]
      );
    }
    await client.query('COMMIT');
    order.items = menu.map((m) => ({ name: m.name, qty: qtyById.get(m.id), price: m.price }));
    delete order.id;
    console.log(`[order] #${order.code} ${customer} Rp${total}`);
    res.status(201).json(order);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}));

app.get('/api/orders/:code', requireDb, wrap(async (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) throw new HttpError(400, 'Kode pesanan terdiri dari 5 karakter.');
  const [order] = await loadOrder('o.code = $1', [code]);
  if (!order) throw new HttpError(404, 'Pesanan tidak ditemukan.');
  const { id, ...pub } = order;
  res.set('Cache-Control', 'no-store').json(pub);
}));

// ---------- API admin ----------
const admin = express.Router();
admin.use(requireAdmin, requireDb);

admin.get('/summary', wrap(async (req, res) => {
  const { rows: [s] } = await pool.query(
    `SELECT count(*)::int AS orders, COALESCE(sum(total), 0)::int AS revenue
       FROM orders WHERE created_at >= ${TODAY_WIB} AND status <> 'batal'`
  );
  const { rows: [all] } = await pool.query(
    `SELECT count(*)::int AS orders, COALESCE(sum(total), 0)::int AS revenue FROM orders WHERE status <> 'batal'`
  );
  const { rows: top } = await pool.query(
    `SELECT i.name, sum(i.qty)::int AS qty, sum(i.qty * i.price)::int AS revenue
       FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE o.status <> 'batal' GROUP BY i.name ORDER BY qty DESC, i.name LIMIT 6`
  );
  const { rows: byStatus } = await pool.query(
    `SELECT status, count(*)::int AS n FROM orders WHERE created_at >= ${TODAY_WIB} GROUP BY status`
  );
  res.json({ today: s, allTime: all, top, byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])) });
}));

admin.get('/orders', wrap(async (req, res) => {
  const filter = String(req.query.filter || 'aktif');
  const map = {
    aktif: [`o.status IN ('baru','diseduh','siap')`, []],
    selesai: [`o.status = 'selesai'`, []],
    batal: [`o.status = 'batal'`, []],
    semua: ['TRUE', []],
  };
  const [where, params] = map[filter] || map.aktif;
  res.set('Cache-Control', 'no-store').json(await loadOrder(where, params));
}));

admin.patch('/orders/:id', wrap(async (req, res) => {
  const status = String((req.body || {}).status || '');
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Status tidak dikenal.');
  const { rowCount } = await pool.query(
    'UPDATE orders SET status = $1, updated_at = now() WHERE id = $2', [status, toInt(req.params.id)]
  );
  if (!rowCount) throw new HttpError(404, 'Pesanan tidak ditemukan.');
  res.json({ ok: true });
}));

admin.get('/menu', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM menu ORDER BY sort, id');
  res.json(rows);
}));

function readMenuBody(b, partial) {
  const out = {};
  if (!partial || 'name' in b) { out.name = str(b.name, 60); if (out.name.length < 2) throw new HttpError(400, 'Nama menu minimal 2 huruf.'); }
  if (!partial || 'category' in b) { out.category = String(b.category); if (!CATEGORIES.includes(out.category)) throw new HttpError(400, 'Kategori tidak valid.'); }
  if (!partial || 'price' in b) { out.price = toInt(b.price); if (!(out.price >= 0 && out.price <= 1000000)) throw new HttpError(400, 'Harga tidak valid.'); }
  if (!partial || 'description' in b) out.description = str(b.description, 300);
  if (!partial || 'notes' in b) out.notes = str(b.notes, 80);
  if (!partial || 'tag' in b) out.tag = str(b.tag, 20);
  if (!partial || 'image' in b) {
    out.image = str(b.image, 500);
    if (out.image && !/^(\/img\/|https:\/\/)/.test(out.image)) throw new HttpError(400, 'URL foto harus diawali https:// atau /img/.');
  }
  if ('available' in b) out.available = Boolean(b.available);
  return out;
}

admin.post('/menu', wrap(async (req, res) => {
  const m = readMenuBody(req.body || {}, false);
  const { rows } = await pool.query(
    `INSERT INTO menu (name, category, price, description, notes, image, tag, available, sort)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,(SELECT COALESCE(max(sort), 0) + 10 FROM menu)) RETURNING *`,
    [m.name, m.category, m.price, m.description, m.notes, m.image, m.tag, m.available !== false]
  );
  res.status(201).json(rows[0]);
}));

admin.patch('/menu/:id', wrap(async (req, res) => {
  const m = readMenuBody(req.body || {}, true);
  const keys = Object.keys(m);
  if (!keys.length) throw new HttpError(400, 'Tidak ada perubahan.');
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const { rows } = await pool.query(
    `UPDATE menu SET ${sets} WHERE id = $${keys.length + 1} RETURNING *`, [...keys.map((k) => m[k]), toInt(req.params.id)]
  );
  if (!rows[0]) throw new HttpError(404, 'Menu tidak ditemukan.');
  res.json(rows[0]);
}));

admin.delete('/menu/:id', wrap(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM menu WHERE id = $1', [toInt(req.params.id)]);
  if (!rowCount) throw new HttpError(404, 'Menu tidak ditemukan.');
  res.json({ ok: true });
}));

app.use('/api/admin', admin);
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));

// ---------- Halaman web ----------
app.use('/img', express.static(path.join(__dirname, 'public/img'), { maxAge: '7d', immutable: true }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '5m' }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Format data tidak valid.' });
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ error: status >= 500 ? 'Terjadi kesalahan di server.' : err.message });
});

const server = app.listen(PORT, () => {
  console.log(`Kedai Kopi Saung v${pkg.version} berjalan di port ${PORT}`);
  if (!ADMIN_PASSWORD) console.warn('[admin] ADMIN_PASSWORD belum diatur, halaman admin dinonaktifkan.');
  initDb();
});

function shutdown(sig) {
  console.log(`${sig} diterima, menutup server...`);
  server.close(() => pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
kode rusak (
