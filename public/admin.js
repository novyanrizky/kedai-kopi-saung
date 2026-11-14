/* Kedai Kopi Saung — halaman dapur (admin) */
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const rupiah = (n) => Number(n).toLocaleString('id-ID');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtTime = (iso) => new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)).replace(':', '.');
  const fmtDay = (iso) => new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short' }).format(new Date(iso));
  const CAT = { kopi: 'Kopi', 'non-kopi': 'Non-kopi', makanan: 'Makanan' };
  const STATUS = { baru: 'Baru', diseduh: 'Diseduh', siap: 'Siap', selesai: 'Selesai', batal: 'Batal' };
  const NEXT = { baru: ['diseduh', 'Mulai seduh'], diseduh: ['siap', 'Tandai siap'], siap: ['selesai', 'Selesai'] };

  const session = {
    get() { try { return sessionStorage.getItem('saung:key') || ''; } catch { return ''; } },
    set(v) { try { sessionStorage.setItem('saung:key', v); } catch { /* abaikan */ } },
    clear() { try { sessionStorage.removeItem('saung:key'); } catch { /* abaikan */ } },
  };
  let key = session.get();

  async function api(path, opts = {}) {
    const res = await fetch(`/api/admin${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', 'x-admin-key': key, ...(opts.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { logout(); throw new Error(data.error || 'Sesi berakhir'); }
    if (!res.ok) throw new Error(data.error || `Gagal (${res.status})`);
    return data;
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2200);
  }

  /* ---------- Login ---------- */
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    key = $('#pw').value;
    const err = $('#loginError');
    err.textContent = '';
    try {
      await api('/summary');
      session.set(key);
      start();
    } catch (ex) { err.textContent = ex.message; }
  });
  function logout() {
    session.clear(); key = '';
    clearInterval(poll);
    $('#app').hidden = true; $('#login').hidden = false;
  }
  $('#logout').onclick = logout;

  /* ---------- Navigasi tab ---------- */
  let view = 'orders';
  $('#aTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    view = b.dataset.view;
    $$('#aTabs [data-view]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== view; });
    refresh();
  });

  /* ---------- Pesanan ---------- */
  let filter = 'aktif';
  const seen = new Set();
  let firstLoad = true;
  $('#filters').addEventListener('click', (e) => {
    const c = e.target.closest('[data-filter]');
    if (!c) return;
    filter = c.dataset.filter;
    $$('#filters .chip').forEach((x) => x.classList.toggle('on', x === c));
    loadOrders();
  });

  async function loadOrders() {
    const orders = await api(`/orders?filter=${filter}`);
    const board = $('#board');
    if (!orders.length) {
      board.innerHTML = `<div class="board-empty">${filter === 'aktif' ? 'Belum ada pesanan aktif. Dapur sedang tenang.' : 'Tidak ada pesanan.'}</div>`;
      return;
    }
    board.innerHTML = orders.map((o) => {
      const fresh = !firstLoad && !seen.has(o.id) && o.status === 'baru';
      seen.add(o.id);
      const next = NEXT[o.status];
      return `<article class="ticket ${fresh ? 'fresh' : ''}" data-id="${o.id}">
        <div class="t-top"><span class="t-code">#${esc(o.code)}</span><span class="t-status s-${o.status}">${STATUS[o.status]}</span></div>
        <div class="t-who">${esc(o.customer)}</div>
        <div class="t-meta">${fmtDay(o.created_at)} · ${fmtTime(o.created_at)} WIB · ${o.order_type === 'takeaway' ? 'Bawa pulang' : 'Meja ' + (esc(o.table_no) || '-')}</div>
        <ul class="t-items">${o.items.map((i) => `<li><span>${i.qty}× ${esc(i.name)}</span><span>${rupiah(i.qty * i.price)}</span></li>`).join('')}</ul>
        ${o.note ? `<p class="t-note">“${esc(o.note)}”</p>` : ''}
        <div class="t-total"><span>Total</span><span>Rp ${rupiah(o.total)}</span></div>
        ${next ? `<div class="t-actions">
          <button class="btn btn-ink" type="button" data-status="${next[0]}">${next[1]}</button>
          <button class="btn btn-line" type="button" data-status="batal">Batal</button>
        </div>` : ''}
      </article>`;
    }).join('');
    firstLoad = false;
  }

  $('#board').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    const id = b.closest('.ticket').dataset.id;
    b.disabled = true;
    try {
      await api(`/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ status: b.dataset.status }) });
      toast(`Status diubah: ${STATUS[b.dataset.status]}`);
      refresh();
    } catch (ex) { toast(ex.message); b.disabled = false; }
  });

  async function loadBadge() {
    try {
      const s = await api('/summary');
      const active = (s.byStatus.baru || 0);
      const badge = $('#badge');
      badge.hidden = !active; badge.textContent = active;
      document.title = active ? `(${active}) Dapur — Saung` : 'Dapur — Saung';
      return s;
    } catch { return null; }
  }

  /* ---------- Menu ---------- */
  async function loadMenu() {
    const menu = await api('/menu');
    $('#menuTable').innerHTML = menu.map((m) => `
      <div class="m-row ${m.available ? '' : 'off'}" data-id="${m.id}">
        <img src="${esc(m.image || '/img/hero.webp')}" alt="" loading="lazy">
        <div class="m-info"><div class="m-name">${esc(m.name)}</div><div class="m-cat">${CAT[m.category] || esc(m.category)}${m.tag ? ' · ' + esc(m.tag) : ''}</div></div>
        <label class="m-price"><span>Rp</span><input type="number" min="0" step="500" value="${m.price}" data-field="price" aria-label="Harga ${esc(m.name)}"></label>
        <label class="switch"><input type="checkbox" data-field="available" ${m.available ? 'checked' : ''}><i></i><span>${m.available ? 'Tersedia' : 'Habis'}</span></label>
        <span class="m-spacer"></span>
        <button class="del-btn m-del" type="button" data-del>Hapus</button>
      </div>`).join('');
  }

  async function patchMenu(id, body) {
    return api(`/menu/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  }

  $('#menuTable').addEventListener('change', async (e) => {
    const row = e.target.closest('.m-row');
    if (!row) return;
    const id = row.dataset.id;
    try {
      if (e.target.dataset.field === 'available') {
        const on = e.target.checked;
        await patchMenu(id, { available: on });
        row.classList.toggle('off', !on);
        e.target.parentElement.querySelector('span').textContent = on ? 'Tersedia' : 'Habis';
        toast(on ? 'Menu tersedia lagi' : 'Menu ditandai habis');
      } else if (e.target.dataset.field === 'price') {
        await patchMenu(id, { price: Number(e.target.value) });
        const box = e.target.parentElement;
        box.classList.add('saved'); setTimeout(() => box.classList.remove('saved'), 1200);
        toast(`Harga disimpan: Rp ${rupiah(e.target.value)}`);
      }
    } catch (ex) { toast(ex.message); loadMenu(); }
  });
  $('#menuTable').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset.field === 'price') e.target.blur();
  });
  $('#menuTable').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    if (!b.classList.contains('sure')) {
      b.classList.add('sure'); b.textContent = 'Yakin?';
      setTimeout(() => { b.classList.remove('sure'); b.textContent = 'Hapus'; }, 3000);
      return;
    }
    try {
      await api(`/menu/${b.closest('.m-row').dataset.id}`, { method: 'DELETE' });
      toast('Menu dihapus');
      loadMenu();
    } catch (ex) { toast(ex.message); }
  });

  $('#addForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = Object.fromEntries(new FormData(f));
    body.price = Number(body.price);
    const err = $('#addError');
    err.textContent = '';
    try {
      await api('/menu', { method: 'POST', body: JSON.stringify(body) });
      f.reset();
      toast('Menu baru ditambahkan');
      loadMenu();
    } catch (ex) { err.textContent = ex.message; }
  });

  /* ---------- Ringkasan ---------- */
  async function loadSummary(pre) {
    const s = pre || await api('/summary');
    $('#sumDate').textContent = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
    const avg = s.today.orders ? Math.round(s.today.revenue / s.today.orders) : 0;
    $('#stats').innerHTML = `
      <div class="stat dark"><small>Pendapatan hari ini</small><b><span>Rp</span>${rupiah(s.today.revenue)}</b></div>
      <div class="stat"><small>Pesanan hari ini</small><b>${s.today.orders}</b></div>
      <div class="stat"><small>Rata-rata per pesanan</small><b><span>Rp</span>${rupiah(avg)}</b></div>
      <div class="stat"><small>Total sepanjang waktu</small><b><span>Rp</span>${rupiah(s.allTime.revenue)}</b></div>`;
    const max = Math.max(1, ...s.top.map((t) => t.qty));
    $('#topList').innerHTML = s.top.length
      ? s.top.map((t) => `<li><span>${esc(t.name)}</span><span class="bar"><span data-w="${(t.qty / max) * 100}"></span></span><span class="mono">${t.qty}× · Rp ${rupiah(t.revenue)}</span></li>`).join('')
      : '<li class="mono">Belum ada data penjualan.</li>';
    requestAnimationFrame(() => $$('#topList .bar span').forEach((b) => { b.style.width = `${b.dataset.w}%`; }));
  }

  /* ---------- Pembaruan otomatis ---------- */
  let poll = null;
  async function refresh() {
    try {
      const s = await loadBadge();
      if (view === 'orders') await loadOrders();
      else if (view === 'menu') await loadMenu();
      else await loadSummary(s);
      $('#live').classList.remove('off');
    } catch {
      $('#live').classList.add('off');
    }
  }
  function start() {
    $('#login').hidden = true;
    $('#app').hidden = false;
    refresh();
    clearInterval(poll);
    poll = setInterval(() => { if (view !== 'menu') refresh(); }, 5000);
  }

  if (key) {
    api('/summary').then(start).catch(() => logout());
  }
})();
