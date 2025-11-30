let lastOpenedDetail = null;
/* Trading Journal - v6.1 (detail '편집' button + edit flow)
 * + Calendar day note modal (📊), per-date memo/images, highlight, fullscreen images
 */

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

function idbGet(id) { return new Promise((resolve, reject) => {
  const tx = db.transaction(STORE_NAME, 'readonly');
  const req = tx.objectStore(STORE_NAME).get(id);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});}

function idbAdd(trade) { return new Promise((resolve, reject) => {
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).add(trade).onsuccess = (e) => resolve(e.target.result);
  tx.onerror = () => reject(tx.error);
});}

function idbPut(trade) { return new Promise((resolve, reject) => {
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(trade).onsuccess = () => resolve();
  tx.onerror = () => reject(tx.error);
});}

function idbDelete(id) { return new Promise((resolve, reject) => {
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(id).onsuccess = () => resolve();
  tx.onerror = () => reject(tx.error);
});}

function idbAll() { return new Promise((resolve, reject) => {
  const tx = db.transaction(STORE_NAME, 'readonly');
  const req = tx.objectStore(STORE_NAME).getAll();
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});}

// ---------- Helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function formatPnL(t) { return (Number(t.sell_price||0) - Number(t.buy_price||0)) * Number(t.qty||0); }
function rate(t) { if (!t.buy_price) return 0; return ((Number(t.sell_price||0) / Number(t.buy_price||0)) - 1) * 100; }

function fmtDateNoYear(s){ if(!s) return ''; return s.slice(5); } // YYYY-MM-DD -> MM-DD
function fmtNumber(n){ try { return Number(n).toLocaleString('ko-KR'); } catch { return String(n); } }
function fmtPrice(n){
  const v = Number(n||0);
  const hasFraction = Math.abs(v - Math.trunc(v)) > 1e-6;
  return hasFraction ? v.toLocaleString('ko-KR', {minimumFractionDigits:2, maximumFractionDigits:2}) : v.toLocaleString('ko-KR');
}
function fmtMan(n){
  const sign = n < 0 ? -1 : 1;
  const v = Math.floor(Math.abs(n) / 1000) / 10;
  if (v === 0) return '0';
  return (sign<0?'-':'') + (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)) + '만';
}
function monthKeyOf(dateStr){ if (!dateStr || dateStr.length < 7) return ''; return dateStr.slice(0,7); }
function monthLabel(key){ if (!key) return '전체'; const [y,m] = key.split('-'); return `${y}년 ${String(Number(m))}월`; }

// ---------- Zoom CSS fallback (detail modal 이미지용) ----------
function ensureZoomStyles(){
  if (document.getElementById('zoom-style')) return;
  const css = `.img-zoomed{position:fixed!important;inset:0!important;margin:0!important;background:rgba(0,0,0,.85)!important;object-fit:contain!important;max-width:100vw!important;max-height:100vh!important;width:100vw!important;height:100vh!important;z-index:9999!important;cursor:zoom-out!important}`;
  const s = document.createElement('style'); s.id = 'zoom-style'; s.textContent = css; document.head.appendChild(s);
}

async function tryFullscreen(el){
  try{
    if (document.fullscreenElement === el || document.webkitFullscreenElement === el) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      return true;
    } else {
      if (el.requestFullscreen) { await el.requestFullscreen(); return true; }
      else if (el.webkitRequestFullscreen) { el.webkitRequestFullscreen(); return true; }
    }
  }catch(e){ /* ignore */ }
  return false;
}

function toggleZoomFallback(el){
  ensureZoomStyles();
  if (el.classList.contains('img-zoomed')) el.classList.remove('img-zoomed');
  else { document.querySelectorAll('.img-zoomed').forEach(x=>x.classList.remove('img-zoomed')); el.classList.add('img-zoomed'); }
}

// ---------- Image Compression (HQ: 2000px, q=0.85) ----------
function readFileAsImage(file){
  return new Promise((resolve, reject)=>{
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = ()=>{ URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e)=>{ URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}
function canvasToDataURL(canvas, mime='image/jpeg', quality=0.85){
  try { return canvas.toDataURL(mime, quality); }
  catch { return canvas.toDataURL(); }
}
async function compressFileToDataURL(file, {maxSide=2000, quality=0.85} = {}){
  if (!file) return null;
  if (file.size && file.size < 200*1024) {
    return await new Promise((resolve)=>{ const r=new FileReader(); r.onload=()=>resolve(r.result); r.readAsDataURL(file); });
  }
  let img;
  try { img = await readFileAsImage(file); }
  catch {
    return await new Promise((resolve)=>{ const r=new FileReader(); r.onload=()=>resolve(r.result); r.readAsDataURL(file); });
  }
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const scale = Math.min(1, maxSide/Math.max(w,h));
  const outW = Math.max(1, Math.round(w*scale)), outH = Math.max(1, Math.round(h*scale));
  const canvas = document.createElement('canvas'); canvas.width=outW; canvas.height=outH;
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, outW, outH);
  return canvasToDataURL(canvas, 'image/jpeg', quality);
}

// ---------- Form helpers ----------
function clearForm() {
  const form = $('#tradeForm');
  form.reset();
  form.id.value = '';
  document.querySelectorAll('input[name="tags[]"]').forEach(ch => ch.checked = false);
  $('#deleteTrade').classList.add('hidden');
  form.querySelectorAll('input[type="file"]').forEach((inp)=>{
    const span = inp.closest('label')?.querySelector('span.btn-secondary');
    if (span) span.textContent = '파일 선택';
    setFormMode('create');
  });
}

// --- Toggle form mode: 'create' | 'edit' ---
function setFormMode(mode) {
  const saveBtn   = document.getElementById('saveBtn') || document.querySelector('.btn-save[type="submit"]');
  const cancelBtn = document.getElementById('cancelBtn') || document.getElementById('resetForm');
  const deleteBtn = document.getElementById('deleteTrade');
  if (!saveBtn || !cancelBtn || !deleteBtn) return;
  if (mode === 'edit') {
    saveBtn.textContent = '수정';
    cancelBtn.textContent = '취소';
    deleteBtn.classList.remove('hidden');
  } else {
    saveBtn.textContent = '저장';
    cancelBtn.textContent = '새로 입력';
    deleteBtn.classList.add('hidden');
  }
  const form = document.getElementById('tradeForm');
  if (form) form.dataset.mode = mode;
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
  [{key:'image1'},{key:'image2'}].forEach(({key})=>{
    const input = form.querySelector(`input[name="${key}"]`);
    const span = input?.closest('label')?.querySelector('span.btn-secondary');
    if (span) span.textContent = t[key] ? '이미지 저장됨' : '파일 선택';
  });
}

// ---------- Month dropdown ----------
async function populateMonthSelect() {
  const toolbar = $('#searchInput')?.parentElement || null;
  if (!toolbar) return;

  let monthSel = $('#monthSelect');
  if (!monthSel) {
    monthSel = document.createElement('select');
    monthSel.id = 'monthSelect';
    monthSel.className = 'input';
    monthSel.style.width = '7.5rem';
    toolbar.appendChild(monthSel);
    monthSel.addEventListener('change', renderList);
  }

  const data = await idbAll();
  const months = Array.from(new Set(data.map(t=>monthKeyOf(t.date)).filter(Boolean))).sort().reverse();
  const cur = monthSel.value || 'all';

  monthSel.innerHTML = '';
  const optAll = document.createElement('option');
  optAll.value = 'all'; optAll.textContent = '전체';
  monthSel.appendChild(optAll);
  months.forEach(key=>{
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = monthLabel(key);
    monthSel.appendChild(opt);
  });

  if ([...monthSel.options].some(o=>o.value===cur)) monthSel.value = cur;

  const search = $('#searchInput');
  const sort = $('#sortSelect');
  if (search) search.style.flex = '1 1 auto';
  if (sort) sort.style.width = '7.5rem';
}

// ---------- List render ----------
let chart;
async function renderList() {
  const q = $('#searchInput').value.trim().toLowerCase();
  const sortKey = $('#sortSelect').value;
  const monthKey = $('#monthSelect') ? $('#monthSelect').value : 'all';

  const data = await idbAll();
  let rows = data.filter(t => {
    const tagStr = (t.tags || '').toLowerCase();
    const sym = (t.symbol || '').toLowerCase();
    const okQuery = !q || tagStr.includes(q) || sym.includes(q);
    const okMonth = monthKey === 'all' || monthKeyOf(t.date) === monthKey;
    return okQuery && okMonth;
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
    <th class="py-2 pr-3 nowrap">종목</th>
    <th class="py-2 pr-3 nowrap text-right">수익률</th>
    <th class="py-2 pr-3 nowrap text-right">손익</th>
    <th class="py-2 pr-3 nowrap">태그</th>
  </tr></thead><tbody>`];

  for (const t of rows) {
    const pnl = formatPnL(t);
    const r = rate(t);
    table.push(`<tr class="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" data-id="${t.id}">
      <td class="py-1 pr-3 nowrap">${fmtDateNoYear(t.date)}</td>
      <td class="py-1 pr-3 nowrap">${t.symbol||''}</td>
      <td class="py-1 pr-3 nowrap text-right">${r>=0?`<span class="pnl-pos">${r.toFixed(2)}%</span>`:`<span class="pnl-neg">${r.toFixed(2)}%</span>`}</td>
      <td class="py-1 pr-3 nowrap text-right">${pnl>=0?`<span class="pnl-pos">${fmtNumber(Math.round(pnl))}</span>`:`<span class="pnl-neg">${fmtNumber(Math.round(pnl))}</span>`}</td>
      <td class="py-1 pr-3 nowrap">${t.tags||''}</td>
    </tr>`);
  }
  table.push(`</tbody></table>`);
  $('#listContainer').innerHTML = table.join('');

  $('#listContainer').querySelectorAll('tr[data-id]').forEach(tr=>{
    tr.addEventListener('click', async ()=>{
      const id = Number(tr.getAttribute('data-id'));
      const rec = await idbGet(id);
      if (rec) openDetail(rec);
    });
  });

  // Chart (overall data)
  const byDate = {};
  for (const t of data) if (t.date) byDate[t.date] = (byDate[t.date] || 0) + formatPnL(t);
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
  lastOpenedDetail = t;
  const pnl = formatPnL(t);
  const r = rate(t);
  const buyAmount = (Number(t.buy_price||0) * Number(t.qty||0));
  const html = `
    <div class="detail-grid">
      <div>
        <div class="text-slate-500 text-sm">날짜</div>
        <div class="font-medium">${t.date||''}</div>
      </div>
      <div>
        <div class="text-slate-500 text-sm">종목명</div>
        <div class="font-medium">${t.symbol||''}</div>
      </div>
      <div>
        <div class="text-slate-500 text-sm">수익률</div>
        <div class="font-semibold">${r>=0?`<span class="pnl-pos">${r.toFixed(2)}%</span>`:`<span class="pnl-neg">${r.toFixed(2)}%</span>`}</div>
      </div>
      <div>
        <div class="text-slate-500 text-sm">수익금</div>
        <div class="font-semibold">${pnl>=0?`<span class="pnl-pos">${fmtNumber(Math.round(pnl))}</span>`:`<span class="pnl-neg">${fmtNumber(Math.round(pnl))}</span>`}</div>
      </div>
      <div>
        <div class="text-slate-500 text-sm">매수금액</div>
        <div class="font-medium">${fmtNumber(Math.round(buyAmount))}</div>
      </div>
      <div>
        <div class="text-slate-500 text-sm">Tags</div>
        <div class="font-medium">${t.tags||''}</div>
      </div>
      <div style="grid-column: 1 / -1;">
        <div class="text-slate-500 text-sm">코멘트</div>
        <div class="mt-1 p-2 rounded border border-slate-200 bg-slate-50 whitespace-pre-wrap">${t.comment||''}</div>
      </div>
      <div class="detail-images" style="display:flex;gap:.75rem;">
        ${t.image1?`<img id="img1" src="${t.image1}" class="detail-img" style="width:50%;">`:''}
        ${t.image2?`<img id="img2" src="${t.image2}" class="detail-img" style="width:50%;">`:''}
      </div>
    </div>`;
  $('#detailContent').innerHTML = html;
  const modal = $('#detailModal');
  modal.classList.add('show');

  // Image zoom
  function attachZoomHandler(id){
    const el = document.getElementById(id);
    if (!el) return;
    el.style.cursor = 'zoom-in';
    el.addEventListener('click', async (ev)=>{
      ev.stopPropagation();
      const ok = await tryFullscreen(el);
      if (!ok) toggleZoomFallback(el);
    });
  }
  attachZoomHandler('img1'); attachZoomHandler('img2');

  // ---- '편집' button below '닫기' ----
  const closeBtn = document.getElementById('detailClose');
  const modalCard = closeBtn?.closest('.modal-card');
  if (modalCard) { modalCard.style.position = 'relative'; }
  let editBtn = document.getElementById('detailEdit');
  if (editBtn) editBtn.remove();
  editBtn = document.createElement('button');
  editBtn.id = 'detailEdit';
  editBtn.className = 'btn-secondary';
  editBtn.textContent = '편집';
  editBtn.style.position = 'absolute';
  editBtn.style.right = '.75rem';
  editBtn.style.top = '3rem';
  editBtn.setAttribute('type', 'button');
  closeBtn?.insertAdjacentElement('afterend', editBtn);

  editBtn.addEventListener('click', ()=>{
    modal.classList.remove('show');
    const formTabBtn = document.querySelector('[data-tab="form"]') || document.querySelector('[data-tab="input"]');
    formTabBtn?.click();
    fillForm(t);
    setFormMode('edit');
    const formEl = document.getElementById('tradeForm');
    formEl?.scrollIntoView({behavior:'smooth', block:'start'});
  });

  function closeDetail(){ modal.classList.remove('show'); }
  const closeBtnEl = document.getElementById('detailClose');
  if (closeBtnEl) {
    closeBtnEl.onclick = (e)=>{ e.preventDefault(); e.stopPropagation(); closeDetail(); };
  }
  modal.onclick = (e)=>{ if (e.target === modal) closeDetail(); };
}

// ---------- Calendar ----------
let calendar;

function recomputeCalendarEvents(all) {
  const sums = {};
  all.forEach(t => { if (t.date) sums[t.date] = (sums[t.date] || 0) + formatPnL(t); });

  const events = [];
  const dates = Object.keys(sums).sort();
  for (const d of dates) {
    const val = sums[d] || 0;
    events.push({
      title: fmtMan(Math.round(val)),
      start: d,
      allDay: true,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      textColor: val >= 0 ? '#dc2626' : '#2563eb',
      display: 'block',
      extendedProps: { kind: 'daily', dateStr: d }
    });
  }

  if (dates.length) {
    const min = new Date(dates[0]);
    const max = new Date(dates[dates.length - 1]);
    for (let cur = new Date(min); cur <= max; cur.setDate(cur.getDate()+7)) {
      const weekStart = new Date(cur);
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay()+6)%7));
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate()+6);

      const keyStart = weekStart.toISOString().slice(0,10);
      const keyEnd = weekEnd.toISOString().slice(0,10);

      let sum = 0;
      for (const d of Object.keys(sums)) if (d >= keyStart && d <= keyEnd) sum += sums[d];
      const saturday = new Date(weekStart); saturday.setDate(saturday.getDate()+5);
      events.push({
        title: fmtMan(Math.round(sum)),
        start: saturday.toISOString().slice(0,10),
        allDay: true,
        backgroundColor: sum >= 0 ? '#dc2626' : '#2563eb',
        borderColor: sum >= 0 ? '#dc2626' : '#2563eb',
        textColor: '#fff',
        display: 'block',
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
    dayCellDidMount: (arg)=>{
      const d = arg.date.getDay();
      if (d === 0) { arg.el.style.color = '#dc2626'; }
      if (d === 6) { arg.el.style.color = '#2563eb'; }
    },
    dateClick: async (info) => { 
      await renderCalendarList(info.dateStr); 
    },
    eventClick: async (info) => {
      const ep = info.event.extendedProps || {};
      if (ep.kind === 'daily' && ep.dateStr) {
        await renderCalendarList(ep.dateStr);
      } else if (ep.kind === 'weekly' && ep.weekStart) {
        await renderWeekList(ep.weekStart);
      }
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

// ---------- Day note modal & calendar selection ----------
let currentNoteDate = null;

// cache modal DOM (index.html에 이미 있음)
const noteModal = document.getElementById('noteModal');
const noteClose = document.getElementById('noteClose');
const noteTextEl = document.getElementById('noteText');
const noteDateLabelEl = document.getElementById('noteDateLabel');
const noteImg1Btn = document.getElementById('noteImg1Btn');
const noteImg2Btn = document.getElementById('noteImg2Btn');
const noteImg1Input = document.getElementById('noteImg1Input');
const noteImg2Input = document.getElementById('noteImg2Input');
const noteImg1Preview = document.getElementById('noteImg1Preview');
const noteImg2Preview = document.getElementById('noteImg2Preview');
const imgFullscreen = document.getElementById('imgFullscreen');
const imgFullscreenImg = document.getElementById('imgFullscreenImg');

function highlightCalendarDate(dateStr) {
  const cells = document.querySelectorAll('.fc-daygrid-day');
  cells.forEach(el => {
    if (dateStr && el.dataset.date === dateStr) el.classList.add('cal-selected-day');
    else el.classList.remove('cal-selected-day');
  });
}

function safeLocalGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeLocalSet(key, val) {
  try { localStorage.setItem(key, val); } catch {}
}

function loadNoteForDate(dateStr) {
  currentNoteDate = dateStr;
  if (noteDateLabelEl) {
    noteDateLabelEl.textContent = `${dateStr} 메모 및 이미지`;
  }
  if (noteTextEl) {
    noteTextEl.value = safeLocalGet('note:' + dateStr) || '';
  }
  if (noteImg1Preview) {
    const img1 = safeLocalGet('noteImg1:' + dateStr);
    if (img1) {
      noteImg1Preview.src = img1;
      noteImg1Preview.classList.remove('hidden');
    } else {
      noteImg1Preview.src = '';
      noteImg1Preview.classList.add('hidden');
    }
  }
  if (noteImg2Preview) {
    const img2 = safeLocalGet('noteImg2:' + dateStr);
    if (img2) {
      noteImg2Preview.src = img2;
      noteImg2Preview.classList.remove('hidden');
    } else {
      noteImg2Preview.src = '';
      noteImg2Preview.classList.add('hidden');
    }
  }
}

function openNoteModal(dateStr) {
  if (!noteModal) return;
  loadNoteForDate(dateStr);
  noteModal.classList.remove('hidden');
}

function closeNoteModal() {
  if (!noteModal) return;
  noteModal.classList.add('hidden');
}

function openFullscreenImage(src) {
  if (!imgFullscreen || !imgFullscreenImg || !src) return;
  imgFullscreenImg.src = src;
  imgFullscreen.classList.remove('hidden');
}

function setupNoteModalEvents() {
  if (!noteModal) return;

  if (noteClose) {
    noteClose.addEventListener('click', () => {
      closeNoteModal();
    });
  }

  if (noteImg1Btn && noteImg1Input) {
    noteImg1Btn.addEventListener('click', () => noteImg1Input.click());
  }
  if (noteImg2Btn && noteImg2Input) {
    noteImg2Btn.addEventListener('click', () => noteImg2Input.click());
  }

  if (noteTextEl) {
    noteTextEl.addEventListener('input', () => {
      if (!currentNoteDate) return;
      safeLocalSet('note:' + currentNoteDate, noteTextEl.value);
    });
  }

  if (noteImg1Input && noteImg1Preview) {
    noteImg1Input.addEventListener('change', async () => {
      const file = noteImg1Input.files && noteImg1Input.files[0];
      if (!file || !currentNoteDate) return;
      const dataUrl = await compressFileToDataURL(file, {maxSide:2000, quality:0.85});
      if (!dataUrl) return;
      noteImg1Preview.src = dataUrl;
      noteImg1Preview.classList.remove('hidden');
      safeLocalSet('noteImg1:' + currentNoteDate, dataUrl);
    });
    noteImg1Preview.addEventListener('click', () => {
      if (!noteImg1Preview.classList.contains('hidden')) openFullscreenImage(noteImg1Preview.src);
    });
  }

  if (noteImg2Input && noteImg2Preview) {
    noteImg2Input.addEventListener('change', async () => {
      const file = noteImg2Input.files && noteImg2Input.files[0];
      if (!file || !currentNoteDate) return;
      const dataUrl = await compressFileToDataURL(file, {maxSide:2000, quality:0.85});
      if (!dataUrl) return;
      noteImg2Preview.src = dataUrl;
      noteImg2Preview.classList.remove('hidden');
      safeLocalSet('noteImg2:' + currentNoteDate, dataUrl);
    });
    noteImg2Preview.addEventListener('click', () => {
      if (!noteImg2Preview.classList.contains('hidden')) openFullscreenImage(noteImg2Preview.src);
    });
  }

  if (imgFullscreen) {
    imgFullscreen.addEventListener('click', () => {
      imgFullscreen.classList.add('hidden');
      if (imgFullscreenImg) imgFullscreenImg.src = '';
    });
  }
}

// ---------- Calendar list render (일별/주간) ----------
async function renderCalendarList(dateStr) {
  const all = await idbAll();
  const rows = all.filter(t => t.date === dateStr)
                  .sort((a,b)=> (a.created_at||'').localeCompare(b.created_at||''));
  const total = rows.reduce((acc, t)=> acc + formatPnL(t), 0);

  const headerHtml = `
    <div class="card">
      <h3 class="font-semibold flex justify-between items-center">
        <span>${dateStr} 매매 (합계: ${
          total>=0
            ? `<span class='pnl-pos'>${fmtNumber(Math.round(total))}</span>`
            : `<span class='pnl-neg'>${fmtNumber(Math.round(total))}</span>`
        })</span>
        <button type="button" class="p-1 rounded hover:bg-slate-100" id="dayNoteBtn" title="일자 메모/이미지">
          📊
        </button>
      </h3>
  `;

  const out = [headerHtml,
               `<table class="min-w-full text-sm mt-2"><thead class="text-slate-500"><tr><th class="py-1 pr-3 nowrap">종목</th><th class="py-1 pr-3 nowrap text-right">수익률</th><th class="py-1 pr-3 nowrap text-right">손익</th><th class="py-1 pr-3 nowrap">태그</th></tr></thead><tbody>`];
  for (const t of rows) {
    const pnl = formatPnL(t), r = rate(t);
    out.push(`<tr class="border-t border-slate-100">
      <td class="py-1 pr-3 nowrap"><button class="link-symbol underline" data-id="${t.id}">${t.symbol}</button></td>
      <td class="py-1 pr-3 nowrap text-right">${r>=0?`<span class="pnl-pos">${r.toFixed(2)}%</span>`:`<span class="pnl-neg">${r.toFixed(2)}%</span>`}</td>
      <td class="py-1 pr-3 nowrap text-right">${pnl>=0?`<span class="pnl-pos">${fmtNumber(Math.round(pnl))}</span>`:`<span class="pnl-neg">${fmtNumber(Math.round(pnl))}</span>`}</td>
      <td class="py-1 pr-3 nowrap">${t.tags||''}</td></tr>`);
  }
  out.push(`</tbody></table></div>`);
  const host = document.getElementById('calendarList');
  host.innerHTML = out.join('');

  // 날짜 선택 음영
  highlightCalendarDate(dateStr);

  // 상세보기
  host.querySelectorAll('.link-symbol').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = Number(btn.getAttribute('data-id'));
      const rec = await idbGet(id);
      if (rec) openDetail(rec);
    });
  });

  // 📊 버튼 → 메모/이미지 모달
  const noteBtn = document.getElementById('dayNoteBtn');
  if (noteBtn) {
    noteBtn.addEventListener('click', () => openNoteModal(dateStr));
  }
}

async function renderWeekList(weekStart) {
  const ws = new Date(weekStart);
  const we = new Date(ws); 
  we.setDate(we.getDate()+6);

  const sKey = ws.toISOString().slice(0,10);
  const eKey = we.toISOString().slice(0,10);

  const all = await idbAll();
  const rows = all
      .filter(t => t.date >= sKey && t.date <= eKey)
      .sort((a,b)=> (a.date||'').localeCompare(b.date||''));

  const total = rows.reduce((acc, t)=> acc + formatPnL(t), 0);

  const out = [
`<div class="card">
  <h3 class="font-semibold">
    ${sKey} ~ ${eKey} 주간 매매 (합계: ${
      total>=0 ? `<span class='pnl-pos'>${fmtNumber(Math.round(total))}</span>`
               : `<span class='pnl-neg'>${fmtNumber(Math.round(total))}</span>`
    })
  </h3>`,

`<table class="min-w-full text-sm mt-2">
  <thead class="text-slate-500">
    <tr>
      <th class="py-1 pr-3 nowrap">날짜</th>
      <th class="py-1 pr-3 nowrap">종목</th>
      <th class="py-1 pr-3 nowrap text-right">수익률</th>
      <th class="py-1 pr-3 nowrap text-right">손익</th>
      <th class="py-1 pr-3 nowrap">태그</th>
    </tr>
  </thead>
  <tbody>`
  ];

  for (const t of rows) {
    const pnl = formatPnL(t);
    const r = rate(t);

    out.push(`
      <tr class="border-t border-slate-100">
        <td class="py-1 pr-3 nowrap">${fmtDateNoYear(t.date)}</td>
        <td class="py-1 pr-3 nowrap">
          <button class="link-symbol underline" data-id="${t.id}">${t.symbol}</button>
        </td>
        <td class="py-1 pr-3 nowrap text-right">
          ${
            r>=0
            ? `<span class="pnl-pos">${r.toFixed(2)}%</span>`
            : `<span class="pnl-neg">${r.toFixed(2)}%</span>`
          }
        </td>
        <td class="py-1 pr-3 nowrap text-right">
          ${
            pnl>=0
            ? `<span class="pnl-pos">${fmtNumber(Math.round(pnl))}</span>`
            : `<span class="pnl-neg">${fmtNumber(Math.round(pnl))}</span>`
          }
        </td>
        <td class="py-1 pr-3 nowrap">${t.tags || ''}</td>
      </tr>
    `);
  }

  out.push(`</tbody></table></div>`);

  const host = document.getElementById('calendarList');
  host.innerHTML = out.join('');

  host.querySelectorAll('.link-symbol').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = Number(btn.getAttribute('data-id'));
      const rec = await idbGet(id);
      if (rec) openDetail(rec);
    });
  });

  // 주간합계 클릭 시는 특정 날짜 음영 없음
  highlightCalendarDate(null);
}

// ---------- Tab logic ----------
function switchTab(name) {
  $$('.card').forEach(sec=>sec.classList.add('hidden'));
  $('#tab-' + name).classList.remove('hidden');
  $$('.tab-btn').forEach(btn=>btn.classList.remove('tab-active'));
  const navBtn = document.querySelector(`[data-tab="${name}"]`);
  if (navBtn) navBtn.classList.add('tab-active');
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
    delete t.id;
    await idbAdd(t);
  }
  await populateMonthSelect();
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

  $$('.tab-btn').forEach(btn=>btn.addEventListener('click', ()=>switchTab(btn.dataset.tab)));
  switchTab('list');

  await populateMonthSelect();

  const form = $('#tradeForm');
  ['image1','image2'].forEach(name=>{
    const input = form.querySelector(`input[name="${name}"]`);
    if (!input) return;
    const labelSpan = input.closest('label')?.querySelector('span.btn-secondary');
    input.addEventListener('change', ()=>{
      const f = input.files && input.files[0];
      if (labelSpan) labelSpan.textContent = f ? f.name : '파일 선택';
    });
  });

  $('#searchInput').addEventListener('input', renderList);
  $('#sortSelect').addEventListener('change', renderList);
  $('#exportBtn').addEventListener('click', exportJSON);
  $('#importInput').addEventListener('change', (e)=>{
    if (e.target.files && e.target.files[0]) importJSON(e.target.files[0]);
  });

  // Form submit with compression (HQ profile: 2000px, q=0.85)
  $('#tradeForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const f = e.target;

    let prev = null;
    const editId = f.id.value ? Number(f.id.value) : null;
    if (editId) prev = await idbGet(editId);

    const newImg1 = await compressFileToDataURL(f.image1.files[0], {maxSide:2000, quality:0.85});
    const newImg2 = await compressFileToDataURL(f.image2.files[0], {maxSide:2000, quality:0.85});
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
      openDetail(payload);
    } else {
      await idbAdd(payload);
      alert('저장 완료');
    }
    clearForm();
    await populateMonthSelect();
    await renderList();
    await refreshCalendar();
    if (!payload.id) switchTab('list');
  });

  (document.getElementById('cancelBtn') || document.getElementById('resetForm'))?.addEventListener('click', () => {
    const form = document.getElementById('tradeForm');
    const isEditing = !!(form && form.id && form.id.value);
    clearForm();
    if (isEditing && lastOpenedDetail) openDetail(lastOpenedDetail);
  });

  $('#deleteTrade').addEventListener('click', async ()=>{
    const id = Number($('#tradeForm').id.value);
    if (id && confirm('이 거래를 삭제할까요?')) {
      await idbDelete(id);
      clearForm();
      await populateMonthSelect();
      await renderList();
      await refreshCalendar();
      switchTab('list');
    }
  });

  await initCalendar();

  // 메모 모달/전체화면 초기화
  setupNoteModalEvents();
})();

// flag to confirm JS loaded
window.__APP_OK__ = true;
