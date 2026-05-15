/* ============================================================
 * PEA Bill App - คิดค่าใบบริการแก้ไฟ
 * ใช้ราคามาตรฐานวัสดุ ปี 2569 ครั้งที่ 3
 * ============================================================ */

const STORAGE_KEYS = {
  CART:        'pea_cart_v1',
  HISTORY:     'pea_history_v1',
  SCRIPT_URL:  'pea_script_url',
  API_KEY:     'pea_api_key',
  MULTIPLIER:  'pea_multiplier',
  ITEMS_CACHE: 'pea_items_cache_v1',
  LAST_FILTER: 'pea_last_filter'
};

const state = {
  items: [],
  filtered: [],
  cart: [],
  history: [],
  filter: 'ทั้งหมด',
  searchQuery: '',
  multiplier: 1.495
};

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

/* ============================================================
 * Utilities
 * ============================================================ */
function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '-';
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function money(n) { return '฿' + fmt(n); }

function showToast(msg, ms = 2000) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove('show'), ms);
}

function openModal(id) { $('#' + id).classList.add('show'); }
function closeModal(id) { $('#' + id).classList.remove('show'); }
window.closeModal = closeModal; // expose for inline handlers

/* ============================================================
 * Data loading
 * ============================================================ */
async function loadItems() {
  // Try cache first (works offline + faster startup)
  const cached = localStorage.getItem(STORAGE_KEYS.ITEMS_CACHE);
  if (cached) {
    try {
      state.items = JSON.parse(cached);
      applyMultiplierToItems();
      console.log('Loaded', state.items.length, 'items from cache');
    } catch (e) { console.warn('Cache parse failed', e); }
  }

  // Then fetch fresh copy
  try {
    const res = await fetch('items.json', { cache: 'no-cache' });
    if (res.ok) {
      const data = await res.json();
      state.items = data;
      localStorage.setItem(STORAGE_KEYS.ITEMS_CACHE, JSON.stringify(data));
      applyMultiplierToItems();
      console.log('Loaded', data.length, 'items from network');
    }
  } catch (e) {
    console.warn('Network fetch failed; using cache', e);
  }

  buildFilterChips();
  renderItems();
  updateDataInfo();
}

function applyMultiplierToItems() {
  // For items where user_price was empty/derived, recompute with current multiplier
  state.items.forEach(it => {
    if (it.std_price && (it.category !== 'หมวด 1 (สาย/อุปกรณ์ไฟฟ้า)' || !it.user_price_explicit)) {
      // Sheet 1 has explicit user_price; only override others
      if (it.category !== 'หมวด 1 (สาย/อุปกรณ์ไฟฟ้า)') {
        it.user_price = it.std_price * state.multiplier;
        it.pre_tax = it.std_price * (state.multiplier / 1.15);
      }
    }
  });
}

/* ============================================================
 * Filter chips (categories)
 * ============================================================ */
function buildFilterChips() {
  const wrap = $('#filterChips');
  const cats = ['ทั้งหมด', 'ใช้บ่อย', ...new Set(state.items.map(i => i.category))];
  wrap.innerHTML = '';
  cats.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'chip' + (c === state.filter ? ' active' : '');
    btn.textContent = c;
    btn.onclick = () => {
      state.filter = c;
      localStorage.setItem(STORAGE_KEYS.LAST_FILTER, c);
      buildFilterChips();
      renderItems();
    };
    wrap.appendChild(btn);
  });
}

/* ============================================================
 * Item list rendering
 * ============================================================ */
function renderItems() {
  const list = $('#itemList');
  const q = state.searchQuery.trim().toLowerCase();

  let items = state.items;
  if (state.filter === 'ใช้บ่อย') {
    items = items.filter(i => i.frequent);
  } else if (state.filter !== 'ทั้งหมด') {
    items = items.filter(i => i.category === state.filter);
  }
  if (q) {
    items = items.filter(i =>
      (i.name || '').toLowerCase().includes(q) ||
      (i.code || '').toLowerCase().includes(q)
    );
  }

  state.filtered = items;
  $('#resultStat').textContent = `แสดง ${items.length} จาก ${state.items.length} รายการ`;

  // Performance: limit to 200 if no search query, else show all
  const cap = q ? items.length : 200;
  const display = items.slice(0, cap);

  list.innerHTML = '';
  if (display.length === 0) {
    list.innerHTML = '<div class="empty"><span class="emoji">🔎</span>ไม่พบรายการที่ค้นหา</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  display.forEach(it => {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <div class="info">
        <span class="badge-cat">${it.category}${it.frequent ? ' ⭐' : ''}</span>
        <div class="name">${escapeHtml(it.name)}</div>
        <div class="meta">รหัส ${it.code} • หน่วย ${it.unit}</div>
        <div class="price-row">
          <span class="price">${money(it.user_price)}</span>
          <span class="unit">/${it.unit} (มาตรฐาน ${money(it.std_price)})</span>
        </div>
      </div>
      <button class="add-btn" title="เพิ่มลงใบบริการ">+</button>
    `;
    card.querySelector('.add-btn').onclick = () => addToCart(it);
    frag.appendChild(card);
  });
  list.appendChild(frag);

  if (cap < items.length) {
    const more = document.createElement('div');
    more.className = 'empty';
    more.style.padding = '20px';
    more.innerHTML = `แสดง ${cap}/${items.length} รายการ — ใช้ค้นหาเพื่อหารายการที่ต้องการ`;
    list.appendChild(more);
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ============================================================
 * Cart
 * ============================================================ */
function addToCart(item) {
  const existing = state.cart.find(c => c.code === item.code);
  if (existing) {
    existing.qty += 1;
  } else {
    state.cart.push({
      code: item.code,
      name: item.name,
      unit: item.unit,
      user_price: item.user_price,
      pre_tax: item.pre_tax,
      std_price: item.std_price,
      category: item.category,
      qty: 1
    });
  }
  saveCart();
  renderCart();
  showToast(`✓ เพิ่ม ${item.name.slice(0, 30)}...`);
}

function saveCart() {
  localStorage.setItem(STORAGE_KEYS.CART, JSON.stringify(state.cart));
  updateCartBadge();
}

function loadCart() {
  try {
    state.cart = JSON.parse(localStorage.getItem(STORAGE_KEYS.CART) || '[]');
  } catch (e) { state.cart = []; }
  updateCartBadge();
}

function updateCartBadge() {
  const badge = $('#cartBadge');
  const count = state.cart.reduce((sum, c) => sum + c.qty, 0);
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

function renderCart() {
  const list = $('#cartList');
  const empty = $('#cartEmpty');
  const actions = $('#cartActions');

  if (state.cart.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    actions.style.display = 'none';
    $('#cartTotal').textContent = '฿0.00';
    $('#cartPreTax').textContent = '฿0.00';
    $('#cartCount').textContent = '0 รายการ';
    return;
  }
  empty.style.display = 'none';
  actions.style.display = 'flex';

  let total = 0, preTax = 0;

  list.innerHTML = '';
  state.cart.forEach((c, idx) => {
    const lineTotal = (c.user_price || 0) * c.qty;
    const linePreTax = (c.pre_tax || 0) * c.qty;
    total += lineTotal;
    preTax += linePreTax;

    const card = document.createElement('div');
    card.className = 'cart-item';
    card.innerHTML = `
      <div class="top">
        <div class="name">${escapeHtml(c.name)}<div style="font-size:11px;color:var(--muted);font-weight:400;margin-top:2px;">รหัส ${c.code}</div></div>
        <button class="remove" data-idx="${idx}" title="ลบ">✕</button>
      </div>
      <div class="qty-row">
        <div class="qty-control">
          <button class="qty-btn" data-act="dec" data-idx="${idx}">−</button>
          <input class="qty-input" type="number" min="0" step="0.01" value="${c.qty}" data-idx="${idx}" />
          <button class="qty-btn" data-act="inc" data-idx="${idx}">+</button>
          <span style="font-size:12px;color:var(--muted);margin-left:4px;">${c.unit}</span>
        </div>
        <div style="text-align:right;">
          <div class="line-total">${money(lineTotal)}</div>
          <div class="price-each">${money(c.user_price)}/${c.unit}</div>
        </div>
      </div>
    `;
    list.appendChild(card);
  });

  $('#cartTotal').textContent = money(total);
  $('#cartPreTax').textContent = money(preTax);
  $('#cartCount').textContent = `${state.cart.length} รายการ (รวม ${state.cart.reduce((s,c)=>s+c.qty,0)} หน่วย)`;

  // Wire up qty controls
  list.querySelectorAll('.qty-btn').forEach(btn => {
    btn.onclick = () => {
      const idx = +btn.dataset.idx;
      if (btn.dataset.act === 'inc') state.cart[idx].qty += 1;
      else state.cart[idx].qty = Math.max(0, state.cart[idx].qty - 1);
      if (state.cart[idx].qty === 0) state.cart.splice(idx, 1);
      saveCart(); renderCart();
    };
  });
  list.querySelectorAll('.qty-input').forEach(inp => {
    inp.onchange = () => {
      const idx = +inp.dataset.idx;
      const v = parseFloat(inp.value);
      if (isNaN(v) || v < 0) { renderCart(); return; }
      state.cart[idx].qty = v;
      if (v === 0) state.cart.splice(idx, 1);
      saveCart(); renderCart();
    };
  });
  list.querySelectorAll('.remove').forEach(btn => {
    btn.onclick = () => {
      state.cart.splice(+btn.dataset.idx, 1);
      saveCart(); renderCart();
    };
  });
}

/* ============================================================
 * History (saved bills)
 * ============================================================ */
function loadHistory() {
  try { state.history = JSON.parse(localStorage.getItem(STORAGE_KEYS.HISTORY) || '[]'); }
  catch (e) { state.history = []; }
}

function saveHistory() {
  localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(state.history));
}

function renderHistory() {
  const list = $('#historyList');
  const empty = $('#historyEmpty');

  if (state.history.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  list.innerHTML = '';

  // newest first
  [...state.history].reverse().forEach(h => {
    const c = document.createElement('div');
    c.className = 'history-card';
    const dt = new Date(h.created_at);
    c.innerHTML = `
      <div class="row1">
        <span class="date">${dt.toLocaleDateString('th-TH')} ${dt.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})}</span>
        <span class="total">${money(h.total)}</span>
      </div>
      <div class="customer">${escapeHtml(h.customer || '(ไม่ระบุชื่อ)')}</div>
      <div class="items-count">${h.items.length} รายการ${h.synced ? ' • ☁ sync แล้ว' : ' • ⏳ ยังไม่ sync'}</div>
    `;
    c.onclick = () => showBillDetail(h);
    list.appendChild(c);
  });
}

function showBillDetail(h) {
  const modal = $('#modalBillDetailContent');
  const dt = new Date(h.created_at);
  modal.innerHTML = `
    <h2>🧾 ใบบริการ</h2>
    <div style="font-size:13px; color: var(--muted); margin-bottom: 8px;">
      วันที่: ${dt.toLocaleString('th-TH')}<br>
      ลูกค้า: ${escapeHtml(h.customer || '-')}<br>
      ${h.location ? 'สถานที่: ' + escapeHtml(h.location) + '<br>' : ''}
      ${h.note ? 'หมายเหตุ: ' + escapeHtml(h.note) : ''}
    </div>
    <div style="border-top: 1px dashed #ccc; padding-top: 8px;">
      ${h.items.map(it => `
        <div style="display:flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f0f0f0; font-size: 13px;">
          <div style="flex:1; padding-right:8px;">
            <div>${escapeHtml(it.name)}</div>
            <div style="color: var(--muted); font-size: 11px;">${it.qty} ${it.unit} × ${money(it.user_price)}</div>
          </div>
          <div style="font-weight: 600;">${money(it.user_price * it.qty)}</div>
        </div>
      `).join('')}
    </div>
    <div style="display:flex; justify-content: space-between; margin-top: 10px; font-weight: 700; color: var(--green-dark); font-size: 16px;">
      <span>รวมทั้งสิ้น</span><span>${money(h.total)}</span>
    </div>
    <div class="cart-actions" style="margin-top: 16px;">
      <button class="btn btn-secondary" onclick="closeModal('modalBillDetail')">ปิด</button>
      <button class="btn btn-secondary" id="btnExportBill">📤 แชร์/ส่งออก</button>
      <button class="btn btn-danger" id="btnDeleteBill">🗑 ลบ</button>
    </div>
  `;
  modal.querySelector('#btnExportBill').onclick = () => exportBill(h);
  modal.querySelector('#btnDeleteBill').onclick = () => {
    if (confirm('ยืนยันลบใบบริการนี้?')) {
      state.history = state.history.filter(x => x.id !== h.id);
      saveHistory();
      renderHistory();
      closeModal('modalBillDetail');
      showToast('ลบแล้ว');
    }
  };
  openModal('modalBillDetail');
}

function exportBill(h) {
  const dt = new Date(h.created_at);
  let text = `ใบบริการ\n`;
  text += `วันที่: ${dt.toLocaleString('th-TH')}\n`;
  text += `ลูกค้า: ${h.customer || '-'}\n`;
  if (h.location) text += `สถานที่: ${h.location}\n`;
  text += `\n--- รายการอุปกรณ์ ---\n`;
  h.items.forEach(it => {
    text += `${it.name}\n`;
    text += `  ${it.qty} ${it.unit} × ${fmt(it.user_price)} = ${fmt(it.user_price * it.qty)} บาท\n`;
  });
  text += `\nรวมทั้งสิ้น: ${fmt(h.total)} บาท\n`;
  if (h.note) text += `\nหมายเหตุ: ${h.note}\n`;

  if (navigator.share) {
    navigator.share({ title: 'ใบบริการ', text }).catch(() => {});
  } else {
    navigator.clipboard.writeText(text).then(() => showToast('คัดลอกไปยัง clipboard แล้ว'));
  }
}

/* ============================================================
 * Save bill (from cart)
 * ============================================================ */
function openSaveBillModal() {
  if (state.cart.length === 0) { showToast('ยังไม่มีรายการในใบบริการ'); return; }
  $('#billCustomer').value = '';
  $('#billLocation').value = '';
  $('#billNote').value = '';
  openModal('modalSaveBill');
}

async function confirmSaveBill() {
  const customer = $('#billCustomer').value.trim();
  const location = $('#billLocation').value.trim();
  const note = $('#billNote').value.trim();

  const total = state.cart.reduce((s, c) => s + (c.user_price || 0) * c.qty, 0);
  const bill = {
    id: 'bill_' + Date.now(),
    created_at: new Date().toISOString(),
    customer, location, note,
    items: JSON.parse(JSON.stringify(state.cart)),
    total,
    synced: false
  };
  state.history.push(bill);
  saveHistory();

  // try to sync
  syncBillToSheet(bill).catch(e => console.warn('sync failed', e));

  // clear cart
  state.cart = [];
  saveCart();
  renderCart();
  renderHistory();
  closeModal('modalSaveBill');
  showToast('✓ บันทึกใบบริการแล้ว');
  switchTab('history');
}

/* ============================================================
 * Google Apps Script sync
 * ============================================================ */
async function syncBillToSheet(bill) {
  const url = localStorage.getItem(STORAGE_KEYS.SCRIPT_URL);
  const apiKey = localStorage.getItem(STORAGE_KEYS.API_KEY) || '';
  if (!url) return; // not configured

  try {
    const res = await fetch(url, {
      method: 'POST',
      // Apps Script doPost needs simple Content-Type to skip CORS preflight
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'saveBill', apiKey, bill })
    });
    const data = await res.json();
    if (data.ok) {
      bill.synced = true;
      saveHistory();
      renderHistory();
    } else {
      console.warn('sync rejected', data);
    }
  } catch (e) {
    console.warn('sync error', e);
  }
}

async function syncAllUnsyncedBills() {
  const url = localStorage.getItem(STORAGE_KEYS.SCRIPT_URL);
  if (!url) { showToast('ยังไม่ได้ตั้งค่า Apps Script URL'); return; }
  const unsynced = state.history.filter(b => !b.synced);
  if (unsynced.length === 0) { showToast('ทุกรายการ sync แล้ว'); return; }
  showToast(`กำลัง sync ${unsynced.length} รายการ...`);
  let ok = 0;
  for (const b of unsynced) {
    try { await syncBillToSheet(b); if (b.synced) ok++; } catch {}
  }
  showToast(`Sync สำเร็จ ${ok}/${unsynced.length} รายการ`);
}

async function testConnection() {
  const url = $('#settingsScriptUrl').value.trim();
  const apiKey = $('#settingsApiKey').value.trim();
  if (!url) { showToast('กรอก URL ก่อน'); return; }
  showToast('กำลังทดสอบ...');
  try {
    const res = await fetch(url + '?action=ping&apiKey=' + encodeURIComponent(apiKey));
    const data = await res.json();
    if (data.ok) showToast('✓ เชื่อมต่อสำเร็จ: ' + (data.message || 'OK'));
    else showToast('✗ ผิดพลาด: ' + (data.error || 'unknown'));
  } catch (e) {
    showToast('✗ เชื่อมต่อไม่ได้: ' + e.message);
  }
}

/* ============================================================
 * Settings
 * ============================================================ */
function openSettings() {
  $('#settingsScriptUrl').value = localStorage.getItem(STORAGE_KEYS.SCRIPT_URL) || '';
  $('#settingsApiKey').value = localStorage.getItem(STORAGE_KEYS.API_KEY) || '';
  $('#settingsMultiplier').value = state.multiplier;
  updateDataInfo();
  openModal('modalSettings');
}

function updateDataInfo() {
  $('#dataInfo').textContent =
    `รายการอุปกรณ์: ${state.items.length} • ประวัติ: ${state.history.length} ใบบริการ • ยังไม่ sync: ${state.history.filter(b => !b.synced).length}`;
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEYS.SCRIPT_URL, $('#settingsScriptUrl').value.trim());
  localStorage.setItem(STORAGE_KEYS.API_KEY, $('#settingsApiKey').value.trim());
  showToast('บันทึกแล้ว');
}

function saveMultiplier() {
  const v = parseFloat($('#settingsMultiplier').value);
  if (isNaN(v) || v <= 0) { showToast('ตัวเลขไม่ถูกต้อง'); return; }
  state.multiplier = v;
  localStorage.setItem(STORAGE_KEYS.MULTIPLIER, String(v));
  applyMultiplierToItems();
  renderItems();
  showToast('อัปเดตตัวคูณแล้ว: ' + v);
}

/* ============================================================
 * Tabs / Navigation
 * ============================================================ */
function switchTab(name) {
  $$('.page').forEach(p => p.classList.remove('active'));
  $('#page-' + name).classList.add('active');
  $$('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.page === name));
  if (name === 'cart') renderCart();
  if (name === 'history') renderHistory();
  window.scrollTo(0, 0);
}

/* ============================================================
 * Init
 * ============================================================ */
async function init() {
  // restore settings
  const m = localStorage.getItem(STORAGE_KEYS.MULTIPLIER);
  if (m) state.multiplier = parseFloat(m) || 1.495;
  state.filter = localStorage.getItem(STORAGE_KEYS.LAST_FILTER) || 'ทั้งหมด';

  loadCart();
  loadHistory();
  await loadItems();

  // Wire up search
  $('#searchInput').addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    $('#clearSearch').style.display = e.target.value ? 'block' : 'none';
    renderItems();
  });
  $('#clearSearch').onclick = () => {
    $('#searchInput').value = '';
    state.searchQuery = '';
    $('#clearSearch').style.display = 'none';
    renderItems();
  };

  // Tabs
  $$('nav.tabs button').forEach(b => {
    b.onclick = () => switchTab(b.dataset.page);
  });

  // Cart actions
  $('#btnSaveBill').onclick = openSaveBillModal;
  $('#btnConfirmSaveBill').onclick = confirmSaveBill;
  $('#btnClearCart').onclick = () => {
    if (state.cart.length && confirm('ล้างรายการทั้งหมด?')) {
      state.cart = []; saveCart(); renderCart();
    }
  };

  // Settings
  $('#btnSettings').onclick = openSettings;
  $('#btnSaveSettings').onclick = saveSettings;
  $('#btnTestConnection').onclick = testConnection;
  $('#btnSaveMultiplier').onclick = saveMultiplier;
  $('#btnReloadData').onclick = () => {
    localStorage.removeItem(STORAGE_KEYS.ITEMS_CACHE);
    loadItems().then(() => showToast('โหลดราคาใหม่แล้ว'));
  };
  $('#btnClearHistory').onclick = () => {
    if (confirm('ล้างประวัติทั้งหมด? (ไม่สามารถย้อนกลับได้)')) {
      state.history = []; saveHistory(); renderHistory(); showToast('ล้างแล้ว');
    }
  };
  $('#btnSyncHistory').onclick = syncAllUnsyncedBills;

  // Click outside modal closes it
  $$('.modal-backdrop').forEach(m => {
    m.onclick = (e) => { if (e.target === m) m.classList.remove('show'); };
  });

  renderCart();
  renderHistory();
}

document.addEventListener('DOMContentLoaded', init);
