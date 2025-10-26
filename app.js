/* Local-first Trading Journal (IndexedDB) */

// ---------- Tiny IndexedDB helper ----------
const DB_NAME = 'journal-db';
const STORE_NAME = 'trades';
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('date', 'date');
        store.createIndex('symbol', 'symbol');
      }
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

function idbGet(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbAdd(trade) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add(trade).onsuccess = (e) => resolve(e.target.result);
    tx.onerror = () => reject(tx.error);
  });
}

function idbPut(trade) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(trade).onsuccess = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbDelete(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id).onsuccess = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbAll() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------- Helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function formatPnL(t) { return (t.sell_price - t.buy_price) * t.qty; }
function rate(t) { if (!t.buy_price) return 0; return ((t.sell_price / t.buy_price) - 1) * 100; }

function fmtDateNoYear(s){ if(!s) return ''; return s.slice(5); } // YYYY-MM-DD -> MM-DD
function fmtNumber(n){
  try { return Number(n).toLocaleString('ko-KR'); } catch { return String(n); }
}
function fmtPrice(n){
  const v = Number(n||0);
  const hasFraction = Math.abs(v - Math.trunc(v)) > 1e-6;
  return hasFraction ? v.toLocaleString('ko-KR', {minimumFractionDigits:2, maximumFractionDigits:2}) : v.toLocaleString('ko-KR');
}

function clearForm() {
  const form = $('#tradeForm');
  form.reset();
  form.id.value = '';
  document.querySelectorAll('input[name="tags[]"]').forEach(ch => ch.checked = false);
  $('#deleteTrade').classList.add('hidden');
}

function fillForm(t) {
  const form = $('#tradeForm');
  form.id.value = t.id || '';
  form.date.value = t.date || '';
  form.symbol.value = t.symbol || '';
  form.qty.value = t.qty ?? '';
  form.buy_price.value = t.buy_price ?? '';
  form.sell_price.value = t.sell_price ?? '';
  form.comment.value = t.comment || '';
  document.querySelectorAll('input[name="tags[]"]').forEach(ch => { ch.checked = false; });
  if (t.tags) {
    const set = new Set(String(t.tags).split(',').map(s=>s.trim()).filter(Boolean));
    document.querySelectorAll('input[name="tags[]"]').forEach(ch => { if (set.has(ch.value)) ch.checked = true; });
  }
  $('#deleteTrade').classList.toggle('hidden', !t.id);
}

function fileToDataURL(file) {
  return new Promise((resolve) => {
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

// ---------- List render ----------
let chart;
async function renderList() {
  const q = $('#searchInput').value.trim().toLowerCase();
  const sortKey = $('#sortSelect').value;

  const data = await idbAll();
  let rows = data.filter(t => {
    const tagStr = (t.tags || '').toLowerCase();
    const sym = (t.symbol || '').toLowerCase();
    return !q || tagStr.includes(q) || sym.includes(q);
  });

  rows.sort((a,b)=>{
    if (sortKey === 'date_desc') return (b.date||'').localeCompare(a.date||'');
    if (sortKey === 'date_asc') return (a.date||'').localeCompare(b.date||'');
    if (sortKey === 'pnl_desc') return formatPnL(b) - formatPnL(a);
    if (sortKey === 'pnl_asc') return formatPnL(a) - formatPnL(b);
    return 0;
  });

  const table = [`<table class="min-w-full text-sm"><thead class="text-slate-500"><tr>
    <th class="py-2 pr-3 nowrap">날짜</th>
    <th class="py-2 pr-3 nowrap">수익률</th>
    <th class="py-2 pr-3 nowrap">손익</th>
    <th class="py-2 pr-3 nowrap">종목</th>
    <th class="py-2 pr-3 nowrap">수량</th>
    <th class="py-2 pr-3 nowrap">매수가</th>
    <th class="py-2 pr-3 nowrap">매도가</th>
    <th class="py-2 pr-3 nowrap">Tags</th>
  </tr></thead><tbody>`];

  for (const t of rows) {
    const pnl = formatPnL(t);
    const r = rate(t);
    table.push(`<tr class="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" data-id="${t.id}">
      <td class="py-1 pr-3 nowrap">${fmtDateNoYear(t.date)}</td>
      <td class="py-1 pr-3 nowrap">${r>=0?`<span class="pnl-pos">${r.toFixed(2)}%</span>`:`<span class="pnl-neg">${r.toFixed(2)}%</span>`}</td>
      <td class="py-1 pr-3 nowrap">${pnl>=0?`<span class="pnl-pos">${fmtNumber(Math.round(pnl))}</span>`:`<span class="pnl-neg">${fmtNumber(Math.round(pnl))}</span>`}</td>
      <td class="py-1 pr-3 nowrap">${t.symbol||''}</td>
      <td class="py-1 pr-3 nowrap">${fmtNumber(t.qty||0)}</td>
      <td class="py-1 pr-3 nowrap">${fmtPrice(t.buy_price)}</td>
      <td class="py-1 pr-3 nowrap">${fmtPrice(t.sell_price)}</td>
      <td class="py-1 pr-3 nowrap">${t.tags||''}</td>
    </tr>`);
  }
  table.push(`</tbody></table>`);
  $('#listContainer').innerHTML = table.join('');

  // Row click -> detail
  $('#listContainer').querySelectorAll('tr[data-id]').forEach(tr=>{
    tr.addEventListener('click', async ()=>{
      const id = Number(tr.getAttribute('data-id'));
      const rec = await idbGet(id);
      if (rec) openDetail(rec);
    });
  });

  // Chart: daily sum trend
  const byDate = {};
  for (const t of data) {
    if (!t.date) continue;
    byDate[t.date] = (byDate[t.date] || 0) + formatPnL(t);
  }
  const days = Object.keys(byDate).sort();
  const labels = days.map(fmtDateNoYear);
  const values = days.map(d => byDate[d]);

  if (chart) chart.destroy();
  const ctx = document.getElementById('pnlChart');
  chart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: '일별 손익 합계', data: values }] },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

// ---------- Detail Modal ----------
function openDetail(t){
  const pnl = formatPnL(t);
  const r = rate(t);
  const buyAmount = (Number(t.buy_price||0) * Number(t.qty||0));
  const html = `
    <div class="space-y-2">
      <div class="text-slate-500 text-sm">날짜</div>
      <div class="font-medium">${t.date||''}</div>
      <div class="text-slate-500 text-sm">종목명</div>
      <div class="font-medium">${t.symbol||''}</div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <div class="text-slate-500 text-sm">수익률</div>
          <div class="font-semibold">${r>=0?`<span class="pnl-pos">${r.toFixed(2)}%</span>`:`<span class="pnl-neg">${r.toFixed(2)}%</span>`}</div>
        </div>
        <div>
          <div class="text-slate-500 text-sm">수익금</div>
          <div class="font-semibold">${pnl>=0?`<span class="pnl-pos">${fmtNumber(Math.round(pnl))}</span>`:`<span class="pnl-neg">${fmtNumber(Math.round(pnl))}</span>`}</div>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <div class="text-slate-500 text-sm">매수금액</div>
          <div class="font-medium">${fmtNumber(Math.round(buyAmount))}</div>
        </div>
        <div>
          <div class="text-slate-500 text-sm">Tags</div>
          <div class="font-medium">${t.tags||''}</div>
        </div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
        ${t.image1?`<img id="img1" src="${t.image1}" class="rounded-xl shadow max-h-[60vh] w-full object-contain cursor-zoom-in">`:''}
        ${t.image2?`<img id="img2" src="${t.image2}" class="rounded-xl shadow max-h-[60vh] w-full object-contain cursor-zoom-in">`:''}
      </div>
    </div>
  `;
  $('#detailContent').innerHTML = html;
  $('#detailModal').classList.remove('hidden');
  $('#detailModal').classList.add('flex');

  function setupFS(id){
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', async ()=>{
      if (el.requestFullscreen) el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      // close fullscreen by back button or ESC (default browser behavior)
    });
  }
  setupFS('img1'); setupFS('img2');
}

function closeDetail(){
  $('#detailModal').classList.add('hidden');
  $('#detailModal').classList.remove('flex');
}
document.addEventListener('click', (e)=>{
  if (e.target && e.target.id === 'detailClose') closeDetail();
});
document.getElementById('detailModal').addEventListener('click', (e)=>{
  if (e.target.id === 'detailModal') closeDetail();
});

// ---------- Calendar ----------
let calendar;

function recomputeCalendarEvents(all) {
  const sums = {};
  all.forEach(t => {
    if (!t.date) return;
    sums[t.date] = (sums[t.date] || 0) + formatPnL(t);
  });

  const events = [];
  const dates = Object.keys(sums).sort();
  for (const d of dates) {
    const val = sums[d] || 0;
    events.push({
      title: String(Math.round(val)),
      start: d,
      allDay: true,
      color: val >= 0 ? '#dc2626' : '#2563eb',
      extendedProps: { kind: 'daily', dateStr: d }
    });
  }

  if (dates.length) {
    const min = new Date(dates[0]);
    const max = new Date(dates[dates.length - 1]);
    for (let cur = new Date(min); cur <= max; cur.setDate(cur.getDate()+7)) {
      const weekStart = new Date(cur);
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay()+6)%7)); // Monday
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate()+6);

      const keyStart = weekStart.toISOString().slice(0,10);
      const keyEnd = weekEnd.toISOString().slice(0,10);

      let sum = 0;
      for (const d of Object.keys(sums)) {
        if (d >= keyStart && d <= keyEnd) sum += sums[d];
      }
      const saturday = new Date(weekStart);
      saturday.setDate(saturday.getDate()+5);
      events.push({
        title: `주간 ${Math.round(sum)}`,
        start: saturday.toISOString().slice(0,10),
        allDay: true,
        color: '#111827',
        extendedProps: { kind: 'weekly', weekStart: keyStart }
      });
    }
  }
  return events;
}

async function initCalendar() {
  const el = document.getElementById('calendar');
  calendar = new FullCalendar.Calendar(el, {
    initialView: 'dayGridMonth',
    height: 'auto',
    locale: 'ko',
    dateClick: async (info) => { renderCalendarList(info.dateStr); },
    eventClick: async (info) => {
      const ep = info.event.extendedProps || {};
      if (ep.kind === 'daily' && ep.dateStr) renderCalendarList(ep.dateStr);
      else if (ep.kind === 'weekly' && ep.weekStart) renderWeekList(ep.weekStart);
    }
  });
  calendar.render();
  await refreshCalendar();
}

async function refreshCalendar() {
  const all = await idbAll();
  const events = recomputeCalendarEvents(all);
  calendar.removeAllEvents();
  calendar.addEventSource(events);
}

async function renderCalendarList(dateStr) {
  const all = await idbAll();
  const rows = all.filter(t => t.date === dateStr).sort((a,b)=> (a.created_at||'').localeCompare(b.created_at||''));
  const total = rows.reduce((acc, t)=> acc + formatPnL(t), 0);
  const out = [`<div class="card"><h3 class="font-semibold">${dateStr} 매매 (합계: ${total>=0?`<span class='pnl-pos'>${fmtNumber(Math.round(total))}</span>`:`<span class='pnl-neg'>${fmtNumber(Math.round(total))}</span>`})</h3>`,
               `<table class="min-w-full text-sm mt-2"><thead class="text-slate-500"><tr><th class="py-1 pr-3 nowrap">종목</th><th class="py-1 pr-3 nowrap">수익률</th><th class="py-1 pr-3 nowrap">손익</th><th class="py-1 pr-3 nowrap">수량</th><th class="py-1 pr-3 nowrap">매수가</th><th class="py-1 pr-3 nowrap">매도가</th></tr></thead><tbody>`];
  for (const t of rows) {
    const pnl = formatPnL(t), r = rate(t);
    out.push(`<tr class="border-t border-slate-100"><td class="py-1 pr-3 nowrap">${t.symbol}</td>
      <td class="py-1 pr-3 nowrap">${r>=0?`<span class="pnl-pos">${r.toFixed(2)}%</span>`:`<span class="pnl-neg">${r.toFixed(2)}%</span>`}</td>
      <td class="py-1 pr-3 nowrap">${pnl>=0?`<span class="pnl-pos">${fmtNumber(Math.round(pnl))}</span>`:`<span class="pnl-neg">${fmtNumber(Math.round(pnl))}</span>`}</td>
      <td class="py-1 pr-3 nowrap">${fmtNumber(t.qty)}</td>
      <td class="py-1 pr-3 nowrap">${fmtPrice(t.buy_price)}</td>
      <td class="py-1 pr-3 nowrap">${fmtPrice(t.sell_price)}</td></tr>`);
  }
  out.push(`</tbody></table></div>`);
  document.getElementById('calendarList').innerHTML = out.join('');
}

async function renderWeekList(weekStart) {
  const ws = new Date(weekStart);
  const we = new Date(ws); we.setDate(we.getDate()+6);
  const sKey = ws.toISOString().slice(0,10);
  const eKey = we.toISOString().slice(0,10);
  const all = await idbAll();
  const rows = all.filter(t => t.date >= sKey && t.date <= eKey)
                  .sort((a,b)=> (a.date||'').localeCompare(b.date||''));
  const total = rows.reduce((acc, t)=> acc + formatPnL(t), 0);
  const out = [`<div class="card"><h3 class="font-semibold">${sKey} ~ ${eKey} 주간 매매 (합계: ${total>=0?`<span class='pnl-pos'>${fmtNumber(Math.round(total))}</span>`:`<span class='pnl-neg'>${fmtNumber(Math.round(total))}</span>`})</h3>`,
               `<table class="min-w-full text-sm mt-2"><thead class="text-slate-500"><tr><th class="py-1 pr-3 nowrap">날짜</th><th class="py-1 pr-3 nowrap">종목</th><th class="py-1 pr-3 nowrap">수익률</th><th class="py-1 pr-3 nowrap">손익</th><th class="py-1 pr-3 nowrap">수량</th><th class="py-1 pr-3 nowrap">매수가</th><th class="py-1 pr-3 nowrap">매도가</th></tr></thead><tbody>`];
  for (const t of rows) {
    const pnl = formatPnL(t), r = rate(t);
    out.push(`<tr class="border-t border-slate-100"><td class="py-1 pr-3 nowrap">${fmtDateNoYear(t.date)}</td>
      <td class="py-1 pr-3 nowrap">${t.symbol}</td>
      <td class="py-1 pr-3 nowrap">${r>=0?`<span class="pnl-pos">${r.toFixed(2)}%</span>`:`<span class="pnl-neg">${r.toFixed(2)}%</span>`}</td>
      <td class="py-1 pr-3 nowrap">${pnl>=0?`<span class="pnl-pos">${fmtNumber(Math.round(pnl))}</span>`:`<span class="pnl-neg">${fmtNumber(Math.round(pnl))}</span>`}</td>
      <td class="py-1 pr-3 nowrap">${fmtNumber(t.qty)}</td>
      <td class="py-1 pr-3 nowrap">${fmtPrice(t.buy_price)}</td>
      <td class="py-1 pr-3 nowrap">${fmtPrice(t.sell_price)}</td></tr>`);
  }
  out.push(`</tbody></table></div>`);
  document.getElementById('calendarList').innerHTML = out.join('');
}

// ---------- Tab logic ----------
function switchTab(name) {
  $$('.card').forEach(sec=>sec.classList.add('hidden'));
  $('#tab-' + name).classList.remove('hidden');
  $$('.tab-btn').forEach(btn=>btn.classList.remove('tab-active'));
  document.querySelector(`[data-tab="${name}"]`).classList.add('tab-active');
  if (name === 'calendar') refreshCalendar();
  if (name === 'list') renderList();
}

// ---------- Export/Import ----------
async function exportJSON() {
  const data = await idbAll();
  const blob = new Blob([JSON.stringify({version:1, trades:data}, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'trades_export.json'; a.click();
  URL.revokeObjectURL(url);
}

async function importJSON(file) {
  const text = await file.text();
  const obj = JSON.parse(text);
  if (!obj || !Array.isArray(obj.trades)) return;
  for (const t of obj.trades) {
    delete t.id; // prevent id collision
    await idbAdd(t);
  }
  await renderList();
  await refreshCalendar();
  alert('가져오기 완료');
}

// ---------- Install (PWA prompt) ----------
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.getElementById('installBtn');
  btn.classList.remove('hidden');
  btn.onclick = async ()=>{
    btn.classList.add('hidden');
    deferredPrompt.prompt();
    deferredPrompt = null;
  };
});

// ---------- Init ----------
(async function init() {
  await openDB();

  // Tabs
  $$('.tab-btn').forEach(btn=>btn.addEventListener('click', ()=>switchTab(btn.dataset.tab)));
  switchTab('list');

  // List controls
  $('#searchInput').addEventListener('input', renderList);
  $('#sortSelect').addEventListener('change', renderList);
  $('#exportBtn').addEventListener('click', exportJSON);
  $('#importInput').addEventListener('change', (e)=>{
    if (e.target.files && e.target.files[0]) importJSON(e.target.files[0]);
  });

  // Form submit
  $('#tradeForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const f = e.target;

    // Read previous record if editing (to keep images when no new file is chosen)
    let prev = null;
    const editId = f.id.value ? Number(f.id.value) : null;
    if (editId) prev = await idbGet(editId);

    const newImg1 = await fileToDataURL(f.image1.files[0]);
    const newImg2 = await fileToDataURL(f.image2.files[0]);
    const img1 = newImg1 || (prev ? prev.image1 : null);
    const img2 = newImg2 || (prev ? prev.image2 : null);

    const tags = Array.from(document.querySelectorAll('input[name="tags[]"]:checked')).map(x=>x.value).join(',');

    const payload = {
      id: editId || undefined,
      date: f.date.value,
      symbol: f.symbol.value.trim(),
      qty: Number(f.qty.value||0),
      buy_price: Number(f.buy_price.value||0),
      sell_price: Number(f.sell_price.value||0),
      tags,
      comment: f.comment.value,
      image1: img1,
      image2: img2,
      created_at: prev ? prev.created_at : new Date().toISOString()
    };
    if (payload.id) {
      await idbPut(payload);
      alert('수정 완료');
    } else {
      await idbAdd(payload);
      alert('저장 완료');
    }
    clearForm();
    await renderList();
    await refreshCalendar();
    switchTab('list');
  });

  $('#resetForm').addEventListener('click', clearForm);

  $('#deleteTrade').addEventListener('click', async ()=>{
    const id = Number($('#tradeForm').id.value);
    if (id && confirm('이 거래를 삭제할까요?')) {
      await idbDelete(id);
      clearForm();
      await renderList();
      await refreshCalendar();
      switchTab('list');
    }
  });

  // Calendar
  await initCalendar();
})();