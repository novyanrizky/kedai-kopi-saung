/* Kedai Kopi Saung — interaksi halaman pelanggan */
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

  const rupiah = (n) => Number(n).toLocaleString('id-ID');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CAT_LABEL = { kopi: 'Kopi', 'non-kopi': 'Non-kopi', makanan: 'Makanan' };
  const ICON_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  const ICON_MINUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>';

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* mode privat */ } },
  };

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Gagal (${res.status})`);
    return data;
  }

  const wibParts = (d = new Date()) => {
    const p = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
    return { h: Number(p.find((x) => x.type === 'hour').value), m: Number(p.find((x) => x.type === 'minute').value) };
  };
  const fmtTime = (iso) => new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)).replace(':', '.');
  const fmtDate = (iso) => new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

  /* ---------------- State ---------------- */
  const state = {
    menu: [],
    cat: 'semua',
    cart: new Map(Object.entries(store.get('saung:cart', {})).map(([k, v]) => [Number(k), v])),
    orderType: 'dine-in',
    form: { customer: store.get('saung:name', ''), tableNo: '', note: '' },
  };
  const saveCart = () => store.set('saung:cart', Object.fromEntries(state.cart));
  const cartCount = () => [...state.cart.values()].reduce((a, b) => a + b, 0);
  const cartItems = () => [...state.cart].map(([id, qty]) => ({ m: state.menu.find((x) => x.id === id), qty })).filter((x) => x.m);
  const cartTotal = () => cartItems().reduce((s, x) => s + x.m.price * x.qty, 0);

  /* ---------------- Toast ---------------- */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 2200);
  }

  /* ---------------- Jam buka ---------------- */
  function updateOpen() {
    const { h, m } = wibParts();
    const mins = h * 60 + m;
    const open = mins >= 7 * 60 && mins < 22 * 60;
    const pill = $('#openPill');
    pill.classList.toggle('open', open);
    pill.lastElementChild.textContent = open ? 'Buka · tutup 22.00' : 'Tutup · buka 07.00';
    pill.title = open ? 'Kedai sedang buka' : 'Kedai sedang tutup, pesanan tetap bisa dikirim';
  }

  /* ---------------- Menu ---------------- */
  const list = $('#menuList');

  function qtyControl(item) {
    if (!item.available) return '<span class="sold-label">Habis</span>';
    const q = state.cart.get(item.id) || 0;
    return `<div class="qty ${q ? 'has' : ''}" data-id="${item.id}">
      <button class="qty-add" type="button" data-act="inc" aria-label="Tambah ${esc(item.name)}">${ICON_PLUS}</button>
      <div class="qty-stepper">
        <button class="qty-step" type="button" data-act="dec" aria-label="Kurangi ${esc(item.name)}">${ICON_MINUS}</button>
        <span class="qty-num" aria-live="polite">${q}</span>
        <button class="qty-step" type="button" data-act="inc" aria-label="Tambah ${esc(item.name)}">${ICON_PLUS}</button>
      </div>
    </div>`;
  }

  function renderMenu() {
    if (!state.menu.length) {
      list.innerHTML = '<li class="menu-state">Belum ada menu.</li>';
      return;
    }
    list.innerHTML = state.menu.map((m) => `
      <li class="item ${m.available ? '' : 'sold'}" data-id="${m.id}" data-cat="${esc(m.category)}" tabindex="0" aria-label="${esc(m.name)}, Rp ${rupiah(m.price)}">
        <span class="item-no"></span>
        <img class="item-thumb" src="${esc(m.image || '/img/hero.webp')}" alt="" loading="lazy" width="72" height="72">
        <div class="item-main">
          <h3 class="item-name">${esc(m.name)}${m.tag ? ` <span class="tag">${esc(m.tag)}</span>` : ''}</h3>
          <p class="item-desc">${esc(m.description)}</p>
        </div>
        <span class="item-price"><small>Rp</small>${rupiah(m.price)}</span>
        ${qtyControl(m)}
      </li>`).join('');
    applyFilter(false);
  }

  function applyFilter(animate = true) {
    let n = 0;
    $$('.item', list).forEach((row) => {
      const show = state.cat === 'semua' || row.dataset.cat === state.cat;
      row.classList.toggle('is-hidden', !show);
      row.classList.remove('enter');
      if (show) {
        n++;
        row.querySelector('.item-no').textContent = String(n).padStart(2, '0');
        row.style.setProperty('--i', n);
        if (animate && !reduceMotion) { void row.offsetWidth; row.classList.add('enter'); }
      }
    });
    $('#menuCount').textContent = `(${String(n).padStart(2, '0')})`;
  }

  function refreshQty(id) {
    const item = state.menu.find((m) => m.id === id);
    if (!item) return;
    $$(`.qty[data-id="${id}"]`).forEach((el) => {
      const q = state.cart.get(id) || 0;
      el.classList.toggle('has', q > 0);
      const num = el.querySelector('.qty-num');
      if (num.textContent !== String(q)) {
        num.textContent = q;
        num.classList.remove('tick'); void num.offsetWidth; num.classList.add('tick');
      }
    });
  }

  function changeQty(id, delta) {
    const item = state.menu.find((m) => m.id === id);
    if (!item || !item.available) return;
    const q = Math.max(0, Math.min(20, (state.cart.get(id) || 0) + delta));
    if (q) state.cart.set(id, q); else state.cart.delete(id);
    saveCart();
    refreshQty(id);
    updateBag(delta > 0);
    if (delta > 0 && q === 1) toast(`${item.name} masuk pesanan`);
    if (drawer.classList.contains('on') && view === 'cart') renderDrawer();
  }

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (btn) {
      e.stopPropagation();
      const id = Number(btn.closest('.qty').dataset.id);
      changeQty(id, btn.dataset.act === 'inc' ? 1 : -1);
      return;
    }
    const row = e.target.closest('.item');
    if (row) openDetail(Number(row.dataset.id));
  });
  list.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('item')) openDetail(Number(e.target.dataset.id));
  });

  async function loadMenu() {
    try {
      state.menu = await api('/api/menu');
      // buang item keranjang yang sudah tidak ada
      for (const id of state.cart.keys()) {
        const m = state.menu.find((x) => x.id === id);
        if (!m || !m.available) state.cart.delete(id);
      }
      saveCart();
      renderMenu();
      updateBag(false);
    } catch (err) {
      list.innerHTML = `<li class="menu-state">${esc(err.message)}<br><button class="btn btn-line" type="button" id="retryMenu">Coba lagi</button></li>`;
      $('#retryMenu').onclick = () => { list.innerHTML = '<li class="menu-state">Memuat menu…</li>'; loadMenu(); };
    }
  }

  /* Tab kategori dengan penanda yang bergeser */
  const tabs = $('#tabs');
  const ink = $('#tabInk');
  function moveInk() {
    const active = $('[aria-selected="true"]', tabs);
    ink.style.width = `${active.offsetWidth}px`;
    ink.style.transform = `translateX(${active.offsetLeft}px)`;
  }
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-cat]');
    if (!b || b.dataset.cat === state.cat) return;
    $$('button', tabs).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    state.cat = b.dataset.cat;
    moveInk();
    applyFilter(true);
  });
  addEventListener('resize', moveInk);

  /* Foto mengikuti kursor (hanya perangkat dengan mouse) */
  if (finePointer && !reduceMotion) {
    const box = $('#cursorPhoto');
    const img = box.querySelector('img');
    let tx = 0, ty = 0, x = 0, y = 0, vx = 0, current = null, raf = null;
    const loop = () => {
      const nx = x + (tx - x) * 0.14;
      vx = nx - x; x = nx;
      y += (ty - y) * 0.14;
      const rot = Math.max(-12, Math.min(12, vx * 0.6));
      box.style.transform = `translate3d(${x + 36}px, ${y - 150}px, 0) rotate(${rot}deg) scale(${box.classList.contains('on') ? 1 : 0.7})`;
      raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.3 || box.classList.contains('on') ? requestAnimationFrame(loop) : null;
    };
    list.addEventListener('pointermove', (e) => {
      tx = e.clientX; ty = e.clientY;
      if (!raf) { if (!current) { x = tx; y = ty; } raf = requestAnimationFrame(loop); }
      const row = e.target.closest('.item');
      if (row && row.dataset.id !== current) {
        current = row.dataset.id;
        const m = state.menu.find((i) => String(i.id) === current);
        if (m && m.image) {
          img.src = m.image;
          box.classList.remove('swap'); void box.offsetWidth; box.classList.add('swap');
          box.classList.add('on');
          list.classList.add('dim');
        }
      }
    });
    list.addEventListener('pointerleave', () => {
      box.classList.remove('on'); list.classList.remove('dim'); current = null;
    });
  }

  /* ---------------- Detail menu ---------------- */
  const detail = $('#detail');
  let detailId = null;
  function renderDetailAct() {
    const m = state.menu.find((x) => x.id === detailId);
    if (m) $('#dAct').innerHTML = qtyControl(m);
  }
  function openDetail(id) {
    const m = state.menu.find((x) => x.id === id);
    if (!m) return;
    detailId = id;
    $('#dImg').src = m.image || '/img/hero.webp';
    $('#dImg').alt = m.name;
    $('#dCat').textContent = `${CAT_LABEL[m.category] || m.category}${m.tag ? ' · ' + m.tag : ''}`;
    $('#dName').textContent = m.name;
    $('#dDesc').textContent = m.description;
    $('#dNotes').textContent = m.notes || '—';
    $('#dNotes').hidden = !m.notes;
    $('#dPrice').textContent = `Rp ${rupiah(m.price)}`;
    renderDetailAct();
    detail.showModal();
  }
  $('#dAct').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    changeQty(detailId, btn.dataset.act === 'inc' ? 1 : -1);
    renderDetailAct();
  });
  $('#detailClose').onclick = () => detail.close();
  detail.addEventListener('click', (e) => { if (e.target === detail) detail.close(); });

  /* ---------------- Panel pesanan ---------------- */
  const drawer = $('#drawer');
  const scrim = $('#scrim');
  const body = $('#drawerBody');
  let view = 'cart';
  let lastFocus = null;

  function updateBag(bump) {
    const n = cartCount();
    $('#bagCount').textContent = n;
    if (bump) {
      const b = $('#bagBtn');
      b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
    }
  }

  function openDrawer(v = 'cart') {
    view = v;
    renderDrawer();
    lastFocus = document.activeElement;
    drawer.inert = false;
    drawer.setAttribute('aria-hidden', 'false');
    drawer.classList.add('on');
    scrim.classList.add('on');
    document.documentElement.style.overflow = 'hidden';
    setTimeout(() => $('#drawerClose').focus(), 50);
  }
  function closeDrawer() {
    drawer.classList.remove('on');
    scrim.classList.remove('on');
    drawer.setAttribute('aria-hidden', 'true');
    drawer.inert = true;
    document.documentElement.style.overflow = '';
    if (lastFocus) lastFocus.focus({ preventScroll: true });
  }
  $('#bagBtn').onclick = () => openDrawer('cart');
  $('#drawerClose').onclick = closeDrawer;
  scrim.onclick = closeDrawer;
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawer.classList.contains('on')) closeDrawer(); });

  const EMPTY = `
    <div class="empty">
      <svg class="empty-cup" viewBox="0 0 84 84" aria-hidden="true">
        <path class="steam" d="M32 22c-3-4 3-6 0-11"/><path class="steam" d="M42 22c-3-4 3-6 0-11"/><path class="steam" d="M52 22c-3-4 3-6 0-11"/>
        <path d="M20 32h44v16a20 20 0 0 1-20 20h-4a20 20 0 0 1-20-20z"/><path d="M64 38h4a7 7 0 0 1 0 14h-5"/><path d="M14 74h56"/>
      </svg>
      <h3>Belum ada pesanan</h3>
      <p>Pilih dulu menu favoritmu, kami seduhkan begitu pesananmu masuk.</p>
      <a class="btn btn-ink" href="#menu" data-close>Lihat menu</a>
    </div>`;

  function renderDrawer() {
    if (view === 'printed') return;
    const items = cartItems();
    if (!items.length) { body.innerHTML = EMPTY; return; }
    const total = cartTotal();
    body.innerHTML = `
      <div class="receipt">
        <div class="r-title"><b>saung.</b><small>Struk sementara</small></div>
        <hr class="r-rule">
        ${items.map(({ m, qty }) => `
          <div class="r-line">
            <span class="r-name">${esc(m.name)}</span>
            <span class="r-amt">${rupiah(m.price * qty)}</span>
            <span class="r-sub">
              <span class="mini-step" data-id="${m.id}">
                <button type="button" data-act="dec" aria-label="Kurangi ${esc(m.name)}">−</button>
                <span>${qty}</span>
                <button type="button" data-act="inc" aria-label="Tambah ${esc(m.name)}">+</button>
              </span>
              × ${rupiah(m.price)}
            </span>
          </div>`).join('')}
        <hr class="r-rule">
        <div class="r-total"><span>Total</span><span>Rp ${rupiah(total)}</span></div>
      </div>

      <form class="form" id="orderForm" novalidate>
        <div class="field">
          <label for="fName">Nama pemesan</label>
          <input id="fName" name="customer" maxlength="40" required autocomplete="given-name" placeholder="Nama untuk dipanggil" value="${esc(state.form.customer)}">
        </div>
        <div class="field">
          <label id="segLabel">Disajikan</label>
          <div class="seg ${state.orderType === 'takeaway' ? 'right' : ''}" role="group" aria-labelledby="segLabel">
            <button type="button" data-type="dine-in" aria-pressed="${state.orderType === 'dine-in'}">Makan di sini</button>
            <button type="button" data-type="takeaway" aria-pressed="${state.orderType === 'takeaway'}">Bawa pulang</button>
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="fNote">Catatan</label>
            <input id="fNote" name="note" maxlength="140" placeholder="Kurangi gula, tanpa es…" value="${esc(state.form.note)}">
          </div>
          <div class="field" ${state.orderType === 'takeaway' ? 'hidden' : ''} id="tableField">
            <label for="fTable">Meja</label>
            <input id="fTable" name="tableNo" maxlength="10" inputmode="numeric" placeholder="No." value="${esc(state.form.tableNo)}">
          </div>
        </div>
        <p class="form-error" id="formError" role="alert"></p>
        <button class="btn btn-ink submit" type="submit"><span>Kirim pesanan</span><span class="mono">Rp ${rupiah(total)}</span></button>
      </form>`;
  }

  body.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { closeDrawer(); return; }
    const step = e.target.closest('.mini-step [data-act]');
    if (step) {
      changeQty(Number(step.closest('.mini-step').dataset.id), step.dataset.act === 'inc' ? 1 : -1);
      return;
    }
    const seg = e.target.closest('.seg [data-type]');
    if (seg) {
      state.orderType = seg.dataset.type;
      const wrap = seg.parentElement;
      wrap.classList.toggle('right', state.orderType === 'takeaway');
      $$('button', wrap).forEach((b) => b.setAttribute('aria-pressed', String(b === seg)));
      $('#tableField').hidden = state.orderType === 'takeaway';
      return;
    }
    const trackBtn = e.target.closest('[data-track]');
    if (trackBtn) {
      closeDrawer();
      view = 'cart';
      $('#trackCode').value = trackBtn.dataset.track;
      track(trackBtn.dataset.track);
      document.getElementById('lacak').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    }
    if (e.target.closest('[data-new]')) { view = 'cart'; renderDrawer(); }
  });
  body.addEventListener('input', (e) => {
    if (e.target.name in state.form) state.form[e.target.name] = e.target.value;
  });

  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#formError');
    const btn = e.target.querySelector('.submit');
    const customer = state.form.customer.trim();
    if (customer.length < 2) { err.textContent = 'Isi nama pemesan dulu, minimal 2 huruf.'; $('#fName').focus(); return; }
    err.textContent = '';
    btn.classList.add('loading');
    btn.firstElementChild.textContent = 'Mengirim…';
    try {
      const order = await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          customer,
          orderType: state.orderType,
          tableNo: state.form.tableNo,
          note: state.form.note,
          items: [...state.cart].map(([id, qty]) => ({ id, qty })),
        }),
      });
      store.set('saung:name', customer);
      const recent = store.get('saung:orders', []).filter((c) => c !== order.code);
      store.set('saung:orders', [order.code, ...recent].slice(0, 5));
      state.cart.clear(); saveCart();
      state.form.note = ''; state.form.tableNo = '';
      state.menu.forEach((m) => refreshQty(m.id));
      updateBag(false);
      renderRecent();
      loadPulse();
      showPrinted(order);
    } catch (ex) {
      err.textContent = ex.message;
      btn.classList.remove('loading');
      btn.firstElementChild.textContent = 'Kirim pesanan';
      if (/habis|tersedia/i.test(ex.message)) loadMenu();
    }
  });

  function showPrinted(o) {
    view = 'printed';
    body.innerHTML = `
      <div class="printer">
        <div class="printer-clip">
          <div class="receipt">
            <div class="r-title"><b>saung.</b><small>Kedai Kopi · Cimahi</small></div>
            <hr class="r-rule">
            <div class="r-total"><span>${esc(o.customer)}</span><span>${o.order_type === 'takeaway' ? 'Bawa pulang' : 'Meja ' + (esc(o.table_no) || '-')}</span></div>
            <div class="r-sub">${fmtDate(o.created_at)} · ${fmtTime(o.created_at)} WIB</div>
            <hr class="r-rule">
            ${o.items.map((i) => `<div class="r-line"><span>${i.qty}× ${esc(i.name)}</span><span class="r-amt">${rupiah(i.qty * i.price)}</span></div>`).join('')}
            <hr class="r-rule">
            <div class="r-total big"><span>Total</span><span>Rp ${rupiah(o.total)}</span></div>
            ${o.note ? `<div class="r-sub">Catatan: ${esc(o.note)}</div>` : ''}
            <hr class="r-rule">
            <div class="code-big"><small>Kode pesanan</small><b>${esc(o.code)}</b></div>
            <div class="barcode" aria-hidden="true"></div>
            <div class="r-sub r-center">Bayar di kasir · terima kasih</div>
          </div>
        </div>
      </div>
      <div class="after-actions">
        <button class="btn btn-ink" type="button" data-track="${esc(o.code)}">Lacak pesanan ini</button>
        <button class="btn btn-line" type="button" data-close>Kembali ke menu</button>
      </div>`;
    toast(`Pesanan #${o.code} terkirim`);
  }

  /* ---------------- Lacak pesanan ---------------- */
  const STEP_DEF = [
    ['baru', 'Diterima', 'Pesanan masuk ke dapur'],
    ['diseduh', 'Diseduh', 'Barista sedang menyiapkan'],
    ['siap', 'Siap', 'Silakan ambil di bar'],
    ['selesai', 'Selesai', 'Selamat menikmati'],
  ];
  let trackTimer = null;
  let trackCodeNow = null;

  function renderTrack(o) {
    const box = $('#trackResult');
    const idx = STEP_DEF.findIndex(([s]) => s === o.status);
    const cancelled = o.status === 'batal';
    box.hidden = false;
    box.innerHTML = `
      <div class="tr-head">
        <h3>Pesanan <span>#${esc(o.code)}</span></h3>
        <div class="tr-meta">${esc(o.customer)} · ${fmtTime(o.created_at)} WIB · ${o.order_type === 'takeaway' ? 'Bawa pulang' : 'Meja ' + (esc(o.table_no) || '-')}</div>
      </div>
      ${cancelled ? '<p class="cancel-note">Pesanan ini dibatalkan. Silakan hubungi kasir.</p>' : ''}
      <ol class="steps ${cancelled ? 'cancelled' : ''}">
        ${STEP_DEF.map(([, label, sub], i) => `<li class="${!cancelled && i < idx ? 'done' : ''} ${!cancelled && i === idx ? 'now done' : ''}">${label}<small>${sub}</small></li>`).join('')}
      </ol>
      <ul class="tr-items">${o.items.map((i) => `<li><span>${i.qty}× ${esc(i.name)}</span><span>${rupiah(i.qty * i.price)}</span></li>`).join('')}</ul>
      <div class="tr-total"><span>Total</span><span>Rp ${rupiah(o.total)}</span></div>`;
    const steps = box.querySelector('.steps');
    requestAnimationFrame(() => steps.style.setProperty('--p', cancelled ? 0 : Math.max(0, idx) / (STEP_DEF.length - 1)));
  }

  async function track(code, silent = false) {
    code = String(code || '').trim().toUpperCase();
    clearTimeout(trackTimer);
    if (!/^[A-Z0-9]{5}$/.test(code)) {
      const box = $('#trackResult');
      box.hidden = false;
      box.innerHTML = '<p class="tr-error">Kode pesanan terdiri dari 5 karakter, lihat di struk kamu.</p>';
      return;
    }
    trackCodeNow = code;
    try {
      const o = await api(`/api/orders/${code}`);
      if (trackCodeNow !== code) return;
      renderTrack(o);
      if (!['selesai', 'batal'].includes(o.status)) trackTimer = setTimeout(() => track(code, true), 5000);
    } catch (err) {
      if (silent) { trackTimer = setTimeout(() => track(code, true), 8000); return; }
      const box = $('#trackResult');
      box.hidden = false;
      box.innerHTML = `<p class="tr-error">${esc(err.message)}</p>`;
    }
  }
  $('#trackForm').addEventListener('submit', (e) => { e.preventDefault(); track($('#trackCode').value); });
  $('#trackCode').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

  function renderRecent() {
    const codes = store.get('saung:orders', []);
    $('#recentOrders').innerHTML = codes.length
      ? `<span class="recent-label">Pesanan terakhir:</span>${codes.map((c) => `<button class="chip" type="button" data-code="${esc(c)}">${esc(c)}</button>`).join('')}`
      : '';
  }
  $('#recentOrders').addEventListener('click', (e) => {
    const c = e.target.closest('[data-code]');
    if (c) { $('#trackCode').value = c.dataset.code; track(c.dataset.code); }
  });

  /* ---------------- Statistik & info server ---------------- */
  function countTo(el, to) {
    const from = Number(el.textContent) || 0;
    if (reduceMotion || from === to) { el.textContent = to; return; }
    const t0 = performance.now(), dur = 1400;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  async function loadPulse() {
    try {
      const p = await api('/api/pulse');
      $('#pulse').hidden = false;
      countTo($('#cupCount'), p.cups);
    } catch { /* biarkan tersembunyi */ }
  }
  async function loadInfo() {
    try {
      const i = await api('/api/info');
      $('#deployInfo').innerHTML = `v${esc(i.version)} · Coolify<br>Dideploy ${fmtDate(i.deployedAt)}, ${fmtTime(i.deployedAt)} WIB`;
    } catch { /* abaikan */ }
  }

  /* ---------------- Efek scroll ---------------- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
  $$('.reveal').forEach((el) => io.observe(el));

  const topbar = $('#topbar');
  const heroImg = $('#heroArch img');
  let lastY = scrollY, ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = scrollY;
      topbar.classList.toggle('scrolled', y > 10);
      topbar.classList.toggle('hide', y > 500 && y > lastY && !drawer.classList.contains('on'));
      lastY = y;
      if (!reduceMotion && y < innerHeight * 1.2) heroImg.style.setProperty('--py', `${-y * 0.12}px`);
      ticking = false;
    });
  }, { passive: true });

  // Gandakan isi marquee agar berputar tanpa jeda
  const mq = $('#marquee');
  mq.innerHTML += mq.innerHTML;

  /* ---------------- Mulai ---------------- */
  updateOpen();
  setInterval(updateOpen, 60000);
  updateBag(false);
  renderRecent();
  loadMenu();
  loadPulse();
  loadInfo();
  setInterval(loadPulse, 30000);
  requestAnimationFrame(() => { moveInk(); document.body.classList.add('is-loaded'); });
  if (document.fonts) document.fonts.ready.then(moveInk);
})();
