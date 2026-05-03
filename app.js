let lastOpenedDetail = null;

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

function calcBuyAmount(t){ return Number(t.buy_price||0) * Number(t.qty||0); }

// (1) 수정된 PnL: 사용자가 직접 입력한 실현손익 사용
function formatPnL(t) {
  return Number(t.pnl_input || 0);
}

// (C) 수익률 계산: (실현손익 / 매수금액) * 100
function rate(t) {
  const buyAmount = calcBuyAmount(t);
  const pnl = Number(t.pnl_input || 0);
  if (!buyAmount) return 0;
  return (pnl / buyAmount) * 100;
}

function fmtDateNoYear(s){ if(!s) return ''; return s.slice(5); }
function fmtNumber(n){ try { return Number(n).toLocaleString('ko-KR'); } catch { return String(n); } }
function fmtMan(n){
  const sign = n < 0 ? -1 : 1;
  const v = Math.floor(Math.abs(n) / 1000) / 10;
  if (v === 0) return '0';
  return (sign<0?'-':'') + (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)) + '만';
}
function monthKeyOf(dateStr){ if (!dateStr || dateStr.length < 7) return ''; return dateStr.slice(0,7); }
function monthLabel(key){ if (!key) return '전체'; const [y,m] = key.split('-'); return `${y}년 ${String(Number(m))}월`; }

// ---------- Image Compression ----------
function readFileAsImage(file){
  return new Promise((resolve, reject)=>{
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = ()=>{ URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e)=>{ URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

async function compressFileToDataURL(file, {maxSide=2000, quality=0.85} = {}){
  if (!file) return null;
  if (file.size && file.size < 200*1024) {
    return await new Promise((resolve)=>{ const r=new FileReader(); r.onload=()=>resolve(r.result); r.readAsDataURL(file); });
  }
  let img;
  try { img = await readFileAsImage(file); }
  catch { return await new Promise((resolve)=>{ const r=new FileReader(); r.onload=()=>resolve(r.result); r.readAsDataURL(file); }); }
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const scale = Math.min(1, maxSide/Math.max(w,h));
  const outW = Math.max(1, Math.round(w*scale)), outH = Math.max(1, Math.round(h*scale));
  const canvas = document.createElement('canvas'); canvas.width=outW; canvas.height=outH;
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, outW, outH);
  return canvas.toDataURL('image/jpeg', quality);
}

// ---------- Form helpers ----------
function clearForm() {
  const form = $('#tradeForm');
  if (!form) return;
  form.reset();
  form.id.value = '';
  document.querySelectorAll('input[name="tags[]"]').forEach(ch => ch.checked = false);
  if (form.highlight) form.highlight.checked = false;
  $('#deleteTrade').classList.add('hidden');
  setFormMode('create');
}

function setFormMode(mode) {
  const saveBtn = document.getElementById('saveBtn');
  const deleteBtn = document.getElementById('deleteTrade');
  if (mode === 'edit') {
    if(saveBtn) saveBtn.textContent = '수정 완료';
    if(deleteBtn) deleteBtn.classList.remove('hidden');
  } else {
    if(saveBtn) saveBtn.textContent = '일지 저장';
    if(deleteBtn) deleteBtn.classList.add('hidden');
  }
}

function fillForm(t) {
  const form = $('#tradeForm');
  form.id.value = t.id || '';
  form.date.value = t.date || '';
  form.symbol.value = t.symbol || '';
  form.qty.value = t.qty ?? '';
  form.buy_price.value = t.buy_price ?? '';
  form.pnl_input.value = t.pnl_input ?? '';
  form.comment.value = t.comment || '';
  if (form.highlight) form.highlight.checked = !!t.highlight;
  
  const tagSet = new Set(String(t.tags || '').split(',').map(s=>s.trim()));
  document.querySelectorAll('input[name="tags[]"]').forEach(ch => {
    ch.checked = tagSet.has(ch.value);
  });
  setFormMode('edit');
}

// ---------- List render ----------
let chart;
async function renderList() {
  const q = $('#searchInput')?.value?.trim().toLowerCase() || '';
  const sortKey = $('#sortSelect')?.value || 'date_desc';
  const monthKey = $('#monthSelect')?.value || 'all';
  const data = await idbAll();

  let rows = data.filter(t => {
    const sym = (t.symbol || '').toLowerCase();
    const tags = (t.tags || '').toLowerCase();
    const okQuery = !q || sym.includes(q) || tags.includes(q);
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

  const table = [`<table class="min-w-full table-fixed text-xs">
    <thead class="text-slate-500">
      <tr>
        <th class="py-1 pr-2 w-16 text-left">날짜</th>
        <th class="py-1 pr-2 w-28 text-left">종목</th>
        <th class="py-1 pr-2 w-16 text-right">수익률</th>
        <th class="py-1 pr-2 w-20 text-right">손익</th>
        <th class="py-1 pr-2 w-12 text-right">조회</th>
      </tr>
    </thead>
    <tbody>`];

  let lastDate = null; let alt = false;
  for (const t of rows) {
    const pnl = formatPnL(t); const r = rate(t);
    if (t.date !== lastDate) { alt = !alt; lastDate = t.date; }
    const rowBg = alt ? 'bg-slate-100' : 'bg-white';
    const symbolHtml = t.highlight ? `<span class="inline-flex items-center gap-1 font-bold text-slate-800"><span class="w-2 h-2 rounded-full bg-amber-400"></span>${t.symbol}</span>` : t.symbol;

    table.push(`<tr class="border-t border-slate-200 cursor-pointer ${rowBg}" data-id="${t.id}">
      <td class="py-1 pr-2">${fmtDateNoYear(t.date)}</td>
      <td class="py-1 pr-2 truncate">${symbolHtml}</td>
      <td class="py-1 pr-2 text-right ${r>=0?'pnl-pos':'pnl-neg'}">${r.toFixed(2)}%</td>
      <td class="py-1 pr-2 text-right ${pnl>=0?'pnl-pos':'pnl-neg'}">${fmtNumber(Math.round(pnl))}</td>
      <td class="py-1 pr-2 text-right text-slate-500">${t.views||0}</td>
    </tr>`);
  }
  table.push('</tbody></table>');
  $('#listContainer').innerHTML = table.join('');

  $('#listContainer').querySelectorAll('tr[data-id]').forEach(tr=>{
    tr.addEventListener('click', async ()=>{
      const id = Number(tr.getAttribute('data-id'));
      const rec = await idbGet(id);
      rec.views = (rec.views || 0) + 1;
      await idbPut(rec);
      openDetail(rec);
      renderList();
    });
  });

  renderChart(data);
}

function renderChart(data) {
  const byDate = {};
  data.forEach(t => { if (t.date) byDate[t.date] = (byDate[t.date] || 0) + formatPnL(t); });
  const days = Object.keys(byDate).sort();
  const values = days.map(d => byDate[d]);

  if (chart) chart.destroy();
  const ctx = document.getElementById('pnlChart');
  if (ctx) {
    chart = new Chart(ctx, {
      type: 'bar',
      data: { labels: days.map(fmtDateNoYear), datasets: [{ label: '일별 손익', data: values, backgroundColor: values.map(v => v>=0 ? '#ef4444':'#3b82f6') }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  }
}
// ---------- Detail Modal ----------
function openDetail(t){
  lastOpenedDetail = t;
  const pnl = formatPnL(t);
  const r = rate(t);
  const dateStr = t.date;
  
  // 로컬 스토리지에서 일자별 메모 및 이미지 가져오기
  const dayMemo = safeLocalGet('note:' + dateStr) || '';
  const dayImg1 = safeLocalGet('noteImg1:' + dateStr);
  const dayImg2 = safeLocalGet('noteImg2:' + dateStr);

  const html = `
    <div class="detail-grid">
      <div><div class="text-slate-500 text-xs uppercase font-bold">DATE</div><div class="font-medium">${t.date}</div></div>
      <div><div class="text-slate-500 text-xs uppercase font-bold">SYMBOL</div><div class="font-medium">${t.symbol}</div></div>
      <div><div class="text-slate-500 text-xs uppercase font-bold">RATE</div><div class="font-bold ${r>=0?'pnl-pos':'pnl-neg'}">${r.toFixed(2)}%</div></div>
      <div><div class="text-slate-500 text-xs uppercase font-bold">P/L</div><div class="font-bold ${pnl>=0?'pnl-pos':'pnl-neg'}">${fmtNumber(Math.round(pnl))}</div></div>
      <div style="grid-column: 1 / -1;"><div class="text-slate-500 text-xs font-bold">TAGS</div><div class="text-sm text-slate-600">${t.tags || '-'}</div></div>
      <div style="grid-column: 1 / -1;"><div class="text-slate-500 text-xs font-bold">COMMENT</div><div class="mt-1 p-3 bg-slate-50 rounded-lg text-sm whitespace-pre-wrap border border-slate-100">${t.comment || '기록된 코멘트가 없습니다.'}</div></div>
      <div class="detail-images">
        ${t.image1?`<img src="${t.image1}" class="detail-img" onclick="openFullscreenImage('${t.image1}')">`:''}
        ${t.image2?`<img src="${t.image2}" class="detail-img" onclick="openFullscreenImage('${t.image2}')">`:''}
      </div>
      
      <!-- 📅 일자별 메모 통합 섹션 -->
      <div class="mt-4 pt-4 border-t border-dashed border-slate-200" style="grid-column: 1 / -1;">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-xs font-black bg-slate-800 text-white px-2 py-0.5 rounded">DAILY NOTE</span>
          <span class="text-xs text-slate-400 font-medium">${dateStr}</span>
        </div>
        <div class="p-3 bg-amber-50/50 rounded-lg text-sm text-slate-700 leading-relaxed mb-3 border border-amber-100">${dayMemo || '이 날의 통합 메모가 없습니다.'}</div>
        <div class="flex gap-2">
          ${dayImg1?`<img src="${dayImg1}" class="h-24 w-1/2 object-cover rounded-lg shadow-sm" onclick="openFullscreenImage('${dayImg1}')">`:''}
          ${dayImg2?`<img src="${dayImg2}" class="h-24 w-1/2 object-cover rounded-lg shadow-sm" onclick="openFullscreenImage('${dayImg2}')">`:''}
        </div>
      </div>
    </div>`;

  $('#detailContent').innerHTML = html;
  $('#detailModal').classList.add('show');

  // 편집 버튼 처리
  let editBtn = document.getElementById('detailEdit');
  if (!editBtn) {
    editBtn = document.createElement('button');
    editBtn.id = 'detailEdit'; editBtn.className = 'btn-secondary'; editBtn.textContent = '편집';
    editBtn.style.cssText = "position:absolute; right:4.5rem; top:.75rem; font-size:12px; padding:4px 12px;";
    $('#detailClose').insertAdjacentElement('beforebegin', editBtn);
  }
  editBtn.onclick = () => {
    $('#detailModal').classList.remove('show');
    switchTab('form');
    fillForm(t);
  };
}

// ---------- Calendar Logic ----------
function recomputeCalendarEvents(all) {
  const sums = {};
  all.forEach(t => { if (t.date) sums[t.date] = (sums[t.date] || 0) + formatPnL(t); });
  const events = [];
  const dates = Object.keys(sums).sort();

  for (const d of dates) {
    const val = sums[d] || 0;
    const dayOfWeek = new Date(d).getDay(); // 0:일, 6:토
    
    if (dayOfWeek !== 6) { // 평일 및 일요일
      events.push({
        title: fmtMan(Math.round(val)),
        start: d,
        display: 'list-item',
        textColor: val >= 0 ? '#dc2626' : '#2563eb',
        backgroundColor: 'transparent', borderColor: 'transparent',
        extendedProps: { kind: 'daily', dateStr: d }
      });
    }
  }

  // 주간 합계 (토요일 음영 처리)
  if (dates.length) {
    const min = new Date(dates[0]); const max = new Date(dates[dates.length-1]);
    for (let cur = new Date(min); cur <= max; cur.setDate(cur.getDate()+7)) {
      const weekStart = new Date(cur); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay()+6)%7));
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate()+6);
      const sKey = weekStart.toISOString().slice(0,10); const eKey = weekEnd.toISOString().slice(0,10);
      let sum = 0;
      for (const d of Object.keys(sums)) if (d >= sKey && d <= eKey) sum += sums[d];
      
      events.push({
        title: '주합:' + fmtMan(Math.round(sum)),
        start: weekEnd.toISOString().slice(0,10),
        backgroundColor: sum >= 0 ? '#dc2626' : '#2563eb',
        textColor: '#ffffff',
        borderColor: 'transparent',
        allDay: true,
        extendedProps: { kind: 'weekly', weekStart: sKey }
      });
    }
  }
  return events;
}

// ---------- Tab & Utility ----------
function switchTab(name) {
  $$('section').forEach(sec=>sec.classList.add('hidden'));
  $(`#tab-${name}`)?.classList.remove('hidden');
  $$('.tab-btn').forEach(btn=>btn.classList.remove('tab-active'));
  document.querySelector(`[data-tab="${name}"]`)?.classList.add('tab-active');
  if (name === 'calendar') refreshCalendar();
  if (name === 'list') renderList();
}

async function refreshCalendar() {
  const all = await idbAll();
  if (window.calendar) {
    window.calendar.removeAllEvents();
    window.calendar.addEventSource(recomputeCalendarEvents(all));
  }
}

function safeLocalGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function safeLocalSet(key, val) { try { localStorage.setItem(key, val); } catch {} }

function openFullscreenImage(src) {
  const viewer = $('#imgFullscreen');
  const img = $('#imgFullscreenImg');
  if (viewer && img) {
    img.src = src;
    viewer.classList.remove('hidden');
    viewer.classList.add('show');
  }
}

// ---------- App Initialization ----------
window.onload = async () => {
  await openDB();
  
  // 탭 클릭 이벤트
  $$('.tab-btn').forEach(btn => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });

  // 폼 제출 이벤트
  $('#tradeForm').onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const id = formData.get('id');
    const t = {
      date: formData.get('date'),
      symbol: formData.get('symbol'),
      qty: formData.get('qty'),
      buy_price: formData.get('buy_price'),
      pnl_input: formData.get('pnl_input'),
      comment: formData.get('comment'),
      highlight: e.target.highlight.checked,
      tags: Array.from(e.target.querySelectorAll('input[name="tags[]"]:checked')).map(c=>c.value).join(','),
      created_at: new Date().toISOString()
    };

    // 이미지 처리
    const img1 = e.target.image1.files[0];
    const img2 = e.target.image2.files[0];
    if (img1) t.image1 = await compressFileToDataURL(img1);
    if (img2) t.image2 = await compressFileToDataURL(img2);

    if (id) {
      const old = await idbGet(Number(id));
      t.id = Number(id);
      t.views = old.views || 0;
      if (!t.image1) t.image1 = old.image1;
      if (!t.image2) t.image2 = old.image2;
      await idbPut(t);
    } else {
      t.views = 0;
      await idbAdd(t);
    }
    alert('저장되었습니다.');
    clearForm();
    switchTab('list');
  };

  // 모달 닫기
  $('#detailClose').onclick = () => $('#detailModal').classList.remove('show');
  $('#imgFullscreen').onclick = () => $('#imgFullscreen').classList.add('hidden');
  
  // 삭제 버튼
  $('#deleteTrade').onclick = async () => {
    const id = $('#tradeForm').id.value;
    if (id && confirm('정말 삭제할까요?')) {
      await idbDelete(Number(id));
      clearForm();
      switchTab('list');
    }
  };

  // 초기 로딩
  renderList();
  
  // 캘린더 초기화
  const calendarEl = document.getElementById('calendar');
  if (calendarEl) {
    window.calendar = new FullCalendar.Calendar(calendarEl, {
      initialView: 'dayGridMonth', locale: 'ko', height: 'auto',
      events: recomputeCalendarEvents(await idbAll()),
      dateClick: (info) => { /* 일별 리스트 로직 */ },
      eventClick: (info) => {
        const ep = info.event.extendedProps;
        if (ep.dateStr) /* 일별 상세 */;
      }
    });
    window.calendar.render();
  }
};
