/* Trading Journal - v9
 * - 상세보기 버튼 복구: '닫기' 버튼을 명시적으로 렌더링 + 그 바로 아래 '편집' 버튼을 함께 렌더
 * - 편집 클릭 시 입력 탭 즉시 표시 + 폼 자동 채움 (빈 화면 문제 해결)
 * - 리스트의 '간단 분석'(차트) 제거: 차트 렌더링 코드 삭제 + 분석 카드가 있으면 숨김
 * - 유지: 이미지 관리 UX(라벨 클릭 → 삭제/변경), 자동 리사이즈(2000px,q=0.85), 기타 UI
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
// 만원 단위(한 자리 소수, 둘째자리 버림) 표시: -35000 => -3.5만
function fmtMan(n){
  const sign = n < 0 ? -1 : 1;
  const v = Math.floor(Math.abs(n) / 1000) / 10;
  if (v === 0) return '0';
  return (sign<0?'-':'') + (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)) + '만';
}
function monthKeyOf(dateStr){ if (!dateStr || dateStr.length < 7) return ''; return dateStr.slice(0,7); }
function monthLabel(key){ if (!key) return '전체'; const [y,m] = key.split('-'); return `${y}년 ${String(Number(m))}월`; }

// ---------- Zoom CSS fallback ----------
function ensureZoomStyles(){
  if (document.getElementById('zoom-style')) return;
  const css = `
  .img-zoomed{
    position: fixed !important; inset: 0 !important;
    margin: 0 !important; background: rgba(0,0,0,.85) !important;
    object-fit: contain !important; max-width: 100vw !important; max-height: 100vh !important;
    width: 100vw !important; height: 100vh !important; z-index: 9999 !important;
    cursor: zoom-out !important;
  }`;
  const s = document.createElement('style');
  s.id = 'zoom-style'; s.textContent = css;
  document.head.appendChild(s);
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
  if (el.classList.contains('img-zoomed')) {
    el.classList.remove('img-zoomed');
  } else {
    document.querySelectorAll('.img-zoomed').forEach(x=>x.classList.remove('img-zoomed'));
    el.classList.add('img-zoomed');
  }
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
    return await new Promise((resolve)=>{
      const r = new FileReader(); r.onload = ()=>resolve(r.result); r.readAsDataURL(file);
    });
  }
  let img;
  try { img = await readFileAsImage(file); }
  catch {
    return await new Promise((resolve)=>{
      const r = new FileReader(); r.onload = ()=>resolve(r.result); r.readAsDataURL(file);
    });
  }
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outW; canvas.height = outH;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
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
  form.dataset.clearImage1 = '0';
  form.dataset.clearImage2 = '0';
  form.querySelectorAll('input[type="file"]').forEach((inp)=>{
    const span = inp.closest('label')?.querySelector('span.btn-secondary');
    if (span) span.textContent = '파일 선택';
  });
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
  form.dataset.clearImage1 = '0';
  form.dataset.clearImage2 = '0';
  [{key:'image1'},{key:'image2'}].forEach(({key})=>{
    const input = form.querySelector(`input[name="${key}"]`);
    const span = input?.closest('label')?.querySelector('span.btn-secondary');
    if (span) span.textContent = t[key] ? '이미지 저장됨' : '파일 선택';
  });
}

// '이미지 저장됨'(라벨) 클릭 → 삭제/변경 선택
function setupImageManage() {
  const form = $('#tradeForm');
  ['image1','image2'].forEach(name=>{
    const input = form.querySelector(`input[name="${name}"]`);
    if (!input) return;
    const span = input.closest('label')?.querySelector('span.btn-secondary');
    if (!span) return;
    span.style.cursor = 'pointer';
    span.addEventListener('click', ()=>{
      const txt = span.textContent || '';
      if (txt.includes('이미지 저장됨') || (txt && txt !== '파일 선택' && txt !== '삭제됨')) {
        const del = confirm('이미지를 삭제할까요?\n확인 = 삭제, 취소 = 이미지 변경');
        if (del) {
          span.textContent = '삭제됨';
          input.value = '';
          form.dataset[name === 'image1' ? 'clearImage1' : 'clearImage2'] = '1';
        } else {
          form.dataset[name === 'image1' ? 'clearImage1' : 'clearImage2'] = '0';
          input.click();
        }
      } else {
        input.click();
      }
    });
    input.addEventListener('change', ()=>{
      const f = input.files && input.files[0];
      span.textContent = f ? f.name : '파일 선택';
      form.dataset[name === 'image1' ? 'clearImage1' : 'clearImage2'] = f ? '0' : form.dataset[name === 'image1' ? 'clearImage1' : 'clearImage2'];
    });
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
async function renderList() {
  // 만약 index.html에 '간단 분석' 카드가 존재하면 숨김
  const analysisCard = document.getElementById('analysisCard');
  if (analysisCard) analysisCard.style.display = 'none';

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
}

// ---------- Detail Modal ----------
function openDetail(t){
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
      <div class="detail-images" style="display:flex;gap:.75rem;">
        ${t.image1?`<img id="img1" src="${t.image1}" class="detail-img" style="width:50%;">`:''}
        ${t.image2?`<img id="img2" src="${t.image2}" class="detail-img" style="width:50%;">`:''}
      </div>
      <div class="mt-4 flex flex-col items-end gap-2">
        <button id="detailClose" class="btn-secondary">닫기</button>
        <button id="detailEdit" class="btn-primary">편집</button>
      </div>
    </div>`;
  $('#detailContent').innerHTML = html;
  $('#detailModal').classList.add('show');

  // 확대
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

  // 이벤트 바인딩
  const closeBtn = document.getElementById('detailClose');
  if (closeBtn) closeBtn.addEventListener('click', closeDetail);

  const editBtn = document.getElementById('detailEdit');
  if (editBtn) editBtn.addEventListener('click', ()=>{
    closeDetail();
    const container = document.getElementById('tab-input');
    if (container) container.classList.remove('hidden');
    try { switchTab('input'); } catch {}
    fillForm(t);
    const form = document.getElementById('tradeForm');
    if (form) { form.scrollIntoView({behavior:'smooth', block:'start'}); form.querySelector('input[name="date"]')?.focus(); }
  });

  // ESC: 폴백 확대 해제
  document.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape') document.querySelectorAll('.img-zoomed').forEach(x=>x.classList.remove('img-zoomed'));
  }, { once:true });
}

function closeDetail(){ $('#detailModal').classList.remove('show'); }
document.getElementById('detailModal').addEventListener('click', (e)=>{ if (e.target.id === 'detailModal') closeDetail(); });

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
      color: val >= 0 ? '#dc2626' : '#2563eb',
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
    dayCellDidMount: (arg)=>{
      const d = arg.date.getDay();
      if (d === 0) { arg.el.style.color = '#dc2626'; }
      if (d === 6) { arg.el.style.color = '#2563eb'; }
    },
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
               `<table class="min-w-full text-sm mt-2"><thead class="text-slate-500"><tr>
                 <th class="py-1 pr-3 nowrap">종목</th><th class="py-1 pr-3 nowrap text-right">수익률</th><th class="py-1 pr-3 nowrap text-right">손익</th><th class="py-1 pr-3 nowrap">수량</th><th class="py-1 pr-3 nowrap">매수가</th><th class="py-1 pr-3 nowrap">매도가</th></tr></thead><tbody>`];
  for (const t of rows) {
    const pnl = formatPnL(t), r = rate(t);
    out.push(`<tr class="border-t border-slate-100">
      <td class="py-1 pr-3 nowrap"><button class="link-symbol underline" data-id="${t.id}">${t.symbol}</button></td>
      <td class="py-1 pr-3 nowrap text-right">${r>=0?`<span class="pnl-pos">${r.toFixed(2)}%</span>`:`<span class="pnl-neg">${r.toFixed(2)}%</span>`}</td>
      <td class="py-1 pr-3 nowrap text-right">${pnl>=0?`<span class="pnl-pos">${fmtNumber(Math.round(pnl))}</span>`:`<span class="pnl-neg">${fmtNumber(Math.round(pnl))}</span>`}</td>
      <td class="py-1 pr-3 nowrap">${fmtNumber(t.qty)}</td>
      <td class="py-1 pr-3 nowrap">${fmtPrice(t.buy_price)}</td>
      <td class="py-1 pr-3 nowrap">${fmtPrice(t.sell_price)}</td></tr>`);
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
               `<table class="min-w-full text-sm mt-2"><thead class="text-slate-500"><tr>
                 <th class="py-1 pr-3 nowrap">날짜</th><th class="py-1 pr-3 nowrap">종목</th><th class="py-1 pr-3 nowrap text-right">수익률</th><th class="py-1 pr-3 nowrap text-right">손익</th><th class="py-1 pr-3 nowrap">수량</th><th class="py-1 pr-3 nowrap">매수가</th><th class="py-1 pr-3 nowrap">매도가</th></tr></thead><tbody>`];
  for (const t of rows) {
    const pnl = formatPnL(t), r = rate(t);
    out.push(`<tr class="border-t border-slate-100">
      <td class="py-1 pr-3 nowrap">${fmtDateNoYear(t.date)}</td>
      <td class="py-1 pr-3 nowrap"><button class="link-symbol underline" data-id="${t.id}">${t.symbol}</button></td>
      <td class="py-1 pr-3 nowrap text-right">${r>=0?`<span class="pnl-pos">${r.toFixed(2)}%</span>`:`<span class="pnl-neg">${r.toFixed(2)}%</span>`}</td>
      <td class="py-1 pr-3 nowrap text-right">${pnl>=0?`<span class="pnl-pos">${fmtNumber(Math.round(pnl))}</span>`:`<span class="pnl-neg">${fmtNumber(Math.round(pnl))}</span>`}</td>
      <td class="py-1 pr-3 nowrap">${fmtNumber(t.qty)}</td>
      <td class="py-1 pr-3 nowrap">${fmtPrice(t.buy_price)}</td>
      <td class="py-1 pr-3 nowrap">${fmtPrice(t.sell_price)}</td></tr>`);
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
}

// ---------- Tab logic ----------
function switchTab(name) {
  const tabs = Array.from(document.querySelectorAll('[id^="tab-"]'));
  tabs.forEach(sec=>sec.classList.add('hidden'));
  const tab = document.getElementById('tab-' + name);
  if (tab) tab.classList.remove('hidden');

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
  setupImageManage();

  // 혹시 '간단 분석' 카드가 레이아웃에 있으면 숨겨두기
  const analysisCard = document.getElementById('analysisCard');
  if (analysisCard) analysisCard.style.display = 'none';

  // 입력 폼 파일 라벨 갱신
  const form = $('#tradeForm');
  ['image1','image2'].forEach(name=>{
    const input = form.querySelector(`input[name="${name}"]`);
    if (!input) return;
    const span = input.closest('label')?.querySelector('span.btn-secondary');
    input.addEventListener('change', ()=>{
      const f = input.files && input.files[0];
      if (span) span.textContent = f ? f.name : '파일 선택';
    });
  });

  // List controls
  $('#searchInput').addEventListener('input', renderList);
  $('#sortSelect').addEventListener('change', renderList);
  $('#exportBtn').addEventListener('click', exportJSON);
  $('#importInput').addEventListener('change', (e)=>{
    if (e.target.files && e.target.files[0]) importJSON(e.target.files[0]);
  });

  // Form submit with compression
  $('#tradeForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const f = e.target;

    let prev = null;
    const editId = f.id.value ? Number(f.id.value) : null;
    if (editId) prev = await idbGet(editId);

    const clear1 = f.dataset.clearImage1 === '1';
    const clear2 = f.dataset.clearImage2 === '1';

    const newImg1 = await compressFileToDataURL(f.image1.files[0], {maxSide:2000, quality:0.85});
    const newImg2 = await compressFileToDataURL(f.image2.files[0], {maxSide:2000, quality:0.85});

    const img1 = newImg1 ?? (clear1 ? null : (prev ? prev.image1 : null));
    const img2 = newImg2 ?? (clear2 ? null : (prev ? prev.image2 : null));

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
    if (payload.id) { await idbPut(payload); alert('수정 완료'); }
    else { await idbAdd(payload); alert('저장 완료'); }
    clearForm();
    await populateMonthSelect();
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
      await populateMonthSelect();
      await renderList();
      await refreshCalendar();
      switchTab('list');
    }
  });

  await initCalendar();
})();

// flag to confirm JS loaded
window.__APP_OK__ = true;
