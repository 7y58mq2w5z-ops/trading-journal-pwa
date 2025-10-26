/* Trading Journal - v13 (self-healing containers + tab alias)
 * - #listContainer / #calendar / #calendarList 가 없어도 자동 생성
 * - 탭 이름 'form'/'input' 혼용 지원: data-tab="form" 또는 "input" 모두 처리
 * - 상세보기 편집 → 즉시 폼 탭으로 이동 (form 우선, 없으면 input)
 * - '간단 분석' 완전 제거
 * - FullCalendar 미로딩 시 우아한 비활성화
 * - 풍부한 콘솔 로그로 상태 확인
 */

window.__APP_VERSION__ = 'v13';
console.log('[Journal] boot', window.__APP_VERSION__);

// -------------------- IndexedDB helpers --------------------
const DB_NAME = 'journal-db';
const STORE_NAME = 'trades';
let db;

function openDB() {
  if (!('indexedDB' in window)) {
    console.warn('[Journal] indexedDB not supported');
    return Promise.resolve(null);
  }
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

function idbWrap(fn, fallback=undefined){
  if (!db) return Promise.resolve(fallback);
  try { return fn(); } catch { return Promise.resolve(fallback); }
}

function idbGet(id){ return idbWrap(()=> new Promise((resolve,reject)=>{
  const tx = db.transaction(STORE_NAME, 'readonly');
  const req = tx.objectStore(STORE_NAME).get(id);
  req.onsuccess = ()=> resolve(req.result);
  req.onerror = ()=> reject(req.error);
}), null);}
function idbAdd(trade){ return idbWrap(()=> new Promise((resolve,reject)=>{
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).add(trade).onsuccess = (e)=> resolve(e.target.result);
  tx.onerror = ()=> reject(tx.error);
}), null);}
function idbPut(trade){ return idbWrap(()=> new Promise((resolve,reject)=>{
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(trade).onsuccess = ()=> resolve();
  tx.onerror = ()=> reject(tx.error);
}), null);}
function idbDelete(id){ return idbWrap(()=> new Promise((resolve,reject)=>{
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(id).onsuccess = ()=> resolve();
  tx.onerror = ()=> reject(tx.error);
}), null);}
function idbAll(){ return idbWrap(()=> new Promise((resolve,reject)=>{
  const tx = db.transaction(STORE_NAME, 'readonly');
  const req = tx.objectStore(STORE_NAME).getAll();
  req.onsuccess = ()=> resolve(req.result || []);
  req.onerror = ()=> reject(req.error);
}), []);}

// -------------------- DOM utils --------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function ensureContainers(){
  // List
  if (!$('#listContainer')) {
    const listTab = $('#tab-list') || document.querySelector('[id^="tab-"].tab-list') || $('#tab-form')?.parentElement || $('#app') || document.body;
    const div = document.createElement('div');
    div.id = 'listContainer';
    div.className = 'overflow-x-auto';
    (listTab || document.body).appendChild(div);
    console.log('[Journal] created #listContainer');
  }
  // Calendar
  const calTab = $('#tab-calendar') || $('#app') || document.body;
  if (!$('#calendar')) {
    const div = document.createElement('div');
    div.id = 'calendar';
    calTab.appendChild(div);
    console.log('[Journal] created #calendar');
  }
  if (!$('#calendarList')) {
    const div = document.createElement('div');
    div.id = 'calendarList';
    div.className = 'mt-4';
    calTab.appendChild(div);
    console.log('[Journal] created #calendarList');
  }
}

function killAnalysis(){
  const kill = (el)=>{ if(!el) return; el.style.display='none'; el.innerHTML=''; };
  kill(document.getElementById('analysisCard'));
  document.querySelectorAll('#pnlChart,.analysis,.simple-analysis,[data-analysis]').forEach(kill);
  document.querySelectorAll('.card,div,section').forEach(el=>{
    const t = (el.textContent||'').trim();
    if (t && t.includes('간단 분석')) kill(el);
  });
}

function tabNameForm(){ return $('.tab-btn[data-tab="form"]') ? 'form' : ($('.tab-btn[data-tab="input"]') ? 'input' : 'form'); }
function clickFormTab(){
  const name = tabNameForm();
  const btn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
  btn?.click();
  const sec = document.getElementById(`tab-${name}`);
  if (sec) sec.classList.remove('hidden');
}

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

// -------------------- Formatting --------------------
function formatPnL(t) { return (Number(t.sell_price||0) - Number(t.buy_price||0)) * Number(t.qty||0); }
function rate(t) { if (!t.buy_price) return 0; return ((Number(t.sell_price||0) / Number(t.buy_price||0)) - 1) * 100; }
function fmtDateNoYear(s){ if(!s) return ''; return s.slice(5); }
function fmtNumber(n){ try { return Number(n).toLocaleString('ko-KR'); } catch { return String(n); } }
function fmtPrice(n){
  const v = Number(n||0);
  const hasFraction = Math.abs(v - Math.trunc(v)) > 1e-6;
  return hasFraction ? v.toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2}) : v.toLocaleString('ko-KR');
}
function fmtMan(n){ const sign=n<0?-1:1; const v=Math.floor(Math.abs(n)/1000)/10; if(v===0) return '0'; return (sign<0?'-':'')+(v%1===0?v.toFixed(0):v.toFixed(1))+'만'; }

// -------------------- List --------------------
async function renderList() {
  killAnalysis();
  ensureContainers();

  const host = $('#listContainer');
  if (!host) { console.warn('[Journal] #listContainer still missing'); return; }

  const q = ($('#searchInput')?.value||'').trim().toLowerCase();
  const sortKey = $('#sortSelect')?.value || 'date_desc';
  const monthKey = $('#monthSelect') ? $('#monthSelect').value : 'all';

  const data = await idbAll();
  let rows = data.filter(t => {
    const tagStr = (t.tags || '').toLowerCase();
    const sym = (t.symbol || '').toLowerCase();
    const okQuery = !q || tagStr.includes(q) || sym.includes(q);
    const okMonth = monthKey === 'all' || (t.date||'').slice(0,7) === monthKey;
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
    const pnl = formatPnL(t); const r = rate(t);
    table.push(`<tr class="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" data-id="${t.id}">
      <td class="py-1 pr-3 nowrap">${fmtDateNoYear(t.date)}</td>
      <td class="py-1 pr-3 nowrap">${t.symbol||''}</td>
      <td class="py-1 pr-3 nowrap text-right">${r>=0?`<span class="pnl-pos">${r.toFixed(2)}%</span>`:`<span class="pnl-neg">${r.toFixed(2)}%</span>`}</td>
      <td class="py-1 pr-3 nowrap text-right">${pnl>=0?`<span class="pnl-pos">${fmtNumber(Math.round(pnl))}</span>`:`<span class="pnl-neg">${fmtNumber(Math.round(pnl))}</span>`}</td>
      <td class="py-1 pr-3 nowrap">${t.tags||''}</td>
    </tr>`);
  }
  table.push(`</tbody></table>`);
  host.innerHTML = table.join('');

  host.querySelectorAll('tr[data-id]').forEach(tr=>{
    tr.addEventListener('click', async ()=>{
      const id = Number(tr.getAttribute('data-id'));
      const rec = await idbGet(id);
      if (rec) openDetail(rec);
    });
  });
}

// -------------------- Detail Modal --------------------
function ensureZoomStyles(){
  if (document.getElementById('zoom-style')) return;
  const s = document.createElement('style'); s.id='zoom-style';
  s.textContent = `.img-zoomed{position:fixed!important;inset:0!important;background:rgba(0,0,0,.85)!important;object-fit:contain!important;width:100vw!important;height:100vh!important;z-index:9999!important;cursor:zoom-out!important}`;
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
function toggleZoomFallback(el){ ensureZoomStyles(); el.classList.toggle('img-zoomed'); }

function openDetail(t){
  const host = $('#detailContent'); const modal = $('#detailModal');
  if (!host || !modal) return;

  const pnl = formatPnL(t), r = rate(t), buyAmount = (Number(t.buy_price||0) * Number(t.qty||0));
  const html = `
    <div class="detail-grid">
      <div><div class="text-slate-500 text-sm">날짜</div><div class="font-medium">${t.date||''}</div></div>
      <div><div class="text-slate-500 text-sm">종목명</div><div class="font-medium">${t.symbol||''}</div></div>
      <div><div class="text-slate-500 text-sm">수익률</div><div class="font-semibold">${r>=0?`<span class="pnl-pos">${r.toFixed(2)}%</span>`:`<span class="pnl-neg">${r.toFixed(2)}%</span>`}</div></div>
      <div><div class="text-slate-500 text-sm">수익금</div><div class="font-semibold">${pnl>=0?`<span class="pnl-pos">${fmtNumber(Math.round(pnl))}</span>`:`<span class="pnl-neg">${fmtNumber(Math.round(pnl))}</span>`}</div></div>
      <div><div class="text-slate-500 text-sm">매수금액</div><div class="font-medium">${fmtNumber(Math.round(buyAmount))}</div></div>
      <div><div class="text-slate-500 text-sm">Tags</div><div class="font-medium">${t.tags||''}</div></div>
      <div class="detail-images" style="display:flex;gap:.75rem;">
        ${t.image1?`<img id="img1" src="${t.image1}" class="detail-img" style="width:50%;">`:''}
        ${t.image2?`<img id="img2" src="${t.image2}" class="detail-img" style="width:50%;">`:''}
      </div>
      <div class="mt-4 flex flex-col items-end gap-2">
        <button id="detailClose" class="btn-secondary">닫기</button>
        <button id="detailEdit" class="btn-primary">편집</button>
      </div>
    </div>`;
  host.innerHTML = html;
  modal.classList.add('show');

  ['img1','img2'].forEach(id=>{
    const el = document.getElementById(id); if (!el) return;
    el.style.cursor = 'zoom-in';
    el.addEventListener('click', async (ev)=>{
      ev.stopPropagation();
      const ok = await tryFullscreen(el);
      if (!ok) toggleZoomFallback(el);
    });
  });

  document.getElementById('detailClose')?.addEventListener('click', ()=> modal.classList.remove('show'));
  document.getElementById('detailEdit')?.addEventListener('click', ()=>{
    modal.classList.remove('show');
    clickFormTab();
    const form = document.getElementById('tradeForm');
    if (form) {
      // fill
      form.id.value = t.id || '';
      form.date.value = t.date || '';
      form.symbol.value = t.symbol || '';
      form.qty.value = t.qty ?? '';
      form.buy_price.value = t.buy_price ?? '';
      form.sell_price.value = t.sell_price ?? '';
      form.comment.value = t.comment || '';
      document.querySelectorAll('input[name="tags[]"]').forEach(ch => ch.checked = false);
      if (t.tags) {
        const set = new Set(String(t.tags).split(',').map(s=>s.trim()).filter(Boolean));
        document.querySelectorAll('input[name="tags[]"]').forEach(ch => { if (set.has(ch.value)) ch.checked = true; });
      }
      form.scrollIntoView({behavior:'smooth', block:'start'});
      form.querySelector('input[name="date"]')?.focus();
    }
  });
}

function closeDetail(){ $('#detailModal')?.classList.remove('show'); }
$('#detailModal')?.addEventListener('click', (e)=>{ if (e.target.id === 'detailModal') closeDetail(); });

// -------------------- Calendar --------------------
let calendar;
function recomputeCalendarEvents(all) {
  const sums = {}; all.forEach(t=>{ if (t.date) sums[t.date]=(sums[t.date]||0)+formatPnL(t); });
  const events = [];
  const dates = Object.keys(sums).sort();
  for (const d of dates) {
    const val = sums[d]||0;
    events.push({ title: fmtMan(Math.round(val)), start: d, allDay: true, color: val>=0 ? '#dc2626' : '#2563eb', extendedProps:{kind:'daily', dateStr:d} });
  }
  if (dates.length){
    const min = new Date(dates[0]), max = new Date(dates[dates.length-1]);
    for (let cur=new Date(min); cur<=max; cur.setDate(cur.getDate()+7)){
      const weekStart = new Date(cur); weekStart.setDate(weekStart.getDate()-((weekStart.getDay()+6)%7));
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate()+6);
      const keyStart = weekStart.toISOString().slice(0,10); const keyEnd = weekEnd.toISOString().slice(0,10);
      let sum = 0; for (const d of Object.keys(sums)) if (d>=keyStart && d<=keyEnd) sum += sums[d];
      const saturday = new Date(weekStart); saturday.setDate(saturday.getDate()+5);
      events.push({ title: fmtMan(Math.round(sum)), start: saturday.toISOString().slice(0,10), allDay:true, color:'#111827', extendedProps:{kind:'weekly', weekStart:keyStart} });
    }
  }
  return events;
}
async function initCalendar() {
  ensureContainers();
  const calHost = $('#calendar');
  if (!calHost) { console.warn('[Journal] #calendar still missing'); return; }
  if (typeof FullCalendar === 'undefined' || !FullCalendar?.Calendar) {
    console.warn('[Journal] FullCalendar not loaded; calendar disabled.');
    calHost.innerHTML = '<div class="text-slate-400 text-sm">캘린더 라이브러리가 로드되지 않아 달력을 표시할 수 없습니다.</div>';
    return;
  }
  calendar = new FullCalendar.Calendar(calHost, {
    initialView: 'dayGridMonth',
    height: 'auto',
    locale: 'ko',
    dayCellDidMount: (arg)=>{
      const d = arg.date.getDay();
      if (d === 0) arg.el.style.color = '#dc2626';
      if (d === 6) arg.el.style.color = '#2563eb';
    },
    dateClick: async (info) => { renderCalendarList(info.dateStr); },
    eventClick: async (info) => {
      const ep = info.event.extendedProps || {};
      if (ep.kind === 'daily' && ep.dateStr) renderCalendarList(ep.dateStr);
      else if (ep.kind === 'weekly' && ep.weekStart) renderWeekList(ep.weekStart);
    }
  });
  try { calendar.render(); } catch (e) { console.error('[Journal] calendar.render failed', e); }
  await refreshCalendar();
}
async function refreshCalendar() {
  if (!calendar) return;
  const all = await idbAll();
  const events = recomputeCalendarEvents(all);
  try {
    calendar.removeAllEvents();
    calendar.addEventSource(events);
  } catch (e) { console.error('[Journal] calendar refresh failed', e); }
}

async function renderCalendarList(dateStr) {
  ensureContainers();
  const host = $('#calendarList'); if (!host) return;
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
  ensureContainers();
  const host = $('#calendarList'); if (!host) return;
  const ws = new Date(weekStart), we = new Date(ws); we.setDate(we.getDate()+6);
  const sKey = ws.toISOString().slice(0,10), eKey = we.toISOString().slice(0,10);
  const all = await idbAll();
  const rows = all.filter(t => t.date >= sKey && t.date <= eKey).sort((a,b)=> (a.date||'').localeCompare(b.date||''));
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
  host.innerHTML = out.join('');
  host.querySelectorAll('.link-symbol').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = Number(btn.getAttribute('data-id'));
      const rec = await idbGet(id);
      if (rec) openDetail(rec);
    });
  });
}

// -------------------- Month select & image inputs --------------------
async function populateMonthSelect() {
  const search = $('#searchInput');
  const sort = $('#sortSelect');
  if (search) search.style.flex = '1 1 auto';
  if (sort) sort.style.width = '7.5rem';

  const toolbar = search?.parentElement || null;
  if (!toolbar) return;
  let monthSel = $('#monthSelect');
  if (!monthSel) {
    monthSel = document.createElement('select');
    monthSel.id = 'monthSelect'; monthSel.className = 'input'; monthSel.style.width = '7.5rem';
    toolbar.appendChild(monthSel);
    monthSel.addEventListener('change', renderList);
  }
  const data = await idbAll();
  const months = Array.from(new Set(data.map(t=>(t.date||'').slice(0,7)).filter(Boolean))).sort().reverse();
  const cur = monthSel.value || 'all';
  monthSel.innerHTML = '';
  const optAll = document.createElement('option'); optAll.value='all'; optAll.textContent='전체'; monthSel.appendChild(optAll);
  months.forEach(key=>{
    const opt = document.createElement('option'); opt.value = key; opt.textContent = `${key.slice(0,4)}년 ${Number(key.slice(5))}월`; monthSel.appendChild(opt);
  });
  if ([...monthSel.options].some(o=>o.value===cur)) monthSel.value = cur;
}

function setupImageManage() {
  const form = $('#tradeForm'); if (!form) return;
  ['image1','image2'].forEach(name=>{
    const input = form.querySelector(`input[name="${name}"]`); if (!input) return;
    const span = input.closest('label')?.querySelector('span.btn-secondary');
    const btn = span || (()=>{
      const b = document.createElement('button'); b.type='button'; b.className='btn-secondary'; b.textContent='파일 선택';
      input.insertAdjacentElement('afterend', b); return b;
    })();
    btn.style.cursor='pointer';
    btn.addEventListener('click', ()=>{
      const txt = btn.textContent || '';
      if (txt.includes('이미지 저장됨') || (txt && txt !== '파일 선택' && txt !== '삭제됨')) {
        const del = confirm('이미지를 삭제할까요?\n확인 = 삭제, 취소 = 이미지 변경');
        if (del) { btn.textContent = '삭제됨'; input.value = ''; form.dataset[name==='image1'?'clearImage1':'clearImage2']='1'; }
        else { form.dataset[name==='image1'?'clearImage1':'clearImage2']='0'; input.click(); }
      } else { input.click(); }
    });
    input.addEventListener('change', ()=>{
      const f = input.files && input.files[0];
      btn.textContent = f ? f.name : '파일 선택';
      form.dataset[name==='image1'?'clearImage1':'clearImage2'] = f ? '0' : form.dataset[name==='image1'?'clearImage1':'clearImage2'];
    });
  });
}

// -------------------- Export/Import --------------------
async function exportJSON() {
  const data = await idbAll();
  const blob = new Blob([JSON.stringify({version:1, trades:data}, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'trades_export.json'; a.click();
  URL.revokeObjectURL(url);
}
async function importJSON(file) {
  const text = await file.text();
  const obj = JSON.parse(text);
  if (!obj || !Array.isArray(obj.trades)) return;
  for (const t of obj.trades) { delete t.id; await idbAdd(t); }
  await populateMonthSelect(); await renderList(); await refreshCalendar();
  alert('가져오기 완료');
}

// -------------------- Init --------------------
(async function init() {
  try {
    await openDB();

    // 탭 버튼 연결
    $$('.tab-btn').forEach(btn=>btn.addEventListener('click', ()=>switchTab(btn.dataset.tab)));
    switchTab('list');

    ensureContainers();
    killAnalysis();

    await populateMonthSelect();
    setupImageManage();

    // List controls
    $('#searchInput')?.addEventListener('input', renderList);
    $('#sortSelect')?.addEventListener('change', renderList);
    $('#exportBtn')?.addEventListener('click', exportJSON);
    $('#importInput')?.addEventListener('change', (e)=>{
      const f = e.target.files && e.target.files[0]; if (f) importJSON(f);
    });

    // Form submit
    const form = $('#tradeForm');
    form?.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const f = e.target;
      let prev = null;
      const editId = f.id?.value ? Number(f.id.value) : null;
      if (editId) prev = await idbGet(editId);
      const clear1 = f.dataset.clearImage1 === '1';
      const clear2 = f.dataset.clearImage2 === '1';
      const newImg1 = await (f.image1 ? compressFileToDataURL(f.image1.files?.[0], {maxSide:2000, quality:0.85}) : null);
      const newImg2 = await (f.image2 ? compressFileToDataURL(f.image2.files?.[0], {maxSide:2000, quality:0.85}) : null);
      const img1 = newImg1 ?? (clear1 ? null : (prev ? prev.image1 : null));
      const img2 = newImg2 ?? (clear2 ? null : (prev ? prev.image2 : null));
      const tags = Array.from(document.querySelectorAll('input[name="tags[]"]:checked')).map(x=>x.value).join(',');
      const payload = {
        id: editId || undefined,
        date: f.date?.value || '',
        symbol: (f.symbol?.value || '').trim(),
        qty: Number(f.qty?.value||0),
        buy_price: Number(f.buy_price?.value||0),
        sell_price: Number(f.sell_price?.value||0),
        tags,
        comment: f.comment?.value || '',
        image1: img1,
        image2: img2,
        created_at: prev ? prev.created_at : new Date().toISOString()
      };
      if (payload.id) { await idbPut(payload); alert('수정 완료'); }
      else { await idbAdd(payload); alert('저장 완료'); }
      // reset + rerender
      f.reset(); f.id.value=''; f.dataset.clearImage1='0'; f.dataset.clearImage2='0';
      await populateMonthSelect(); await renderList(); await refreshCalendar();
      switchTab('list');
    });

    $('#resetForm')?.addEventListener('click', ()=>{
      const form = $('#tradeForm'); if (!form) return;
      form.reset(); form.id.value=''; form.dataset.clearImage1='0'; form.dataset.clearImage2='0';
    });

    $('#deleteTrade')?.addEventListener('click', async ()=>{
      const id = Number($('#tradeForm')?.id?.value);
      if (id && confirm('이 거래를 삭제할까요?')) {
        await idbDelete(id);
        const form = $('#tradeForm'); if (form) { form.reset(); form.id.value=''; }
        await populateMonthSelect(); await renderList(); await refreshCalendar(); switchTab('list');
      }
    });

    await initCalendar();
    await renderList();

    console.log('[Journal] init done (v13)');
  } catch (err) {
    console.error('[Journal] fatal init error:', err);
    alert('스크립트 초기화 중 오류가 발생했어요. 콘솔을 확인해주세요.');
  }
})();
