let editModeFromDetail = false; 
let lastOpenedDetail = null;

// ---------- 정식 Supabase Client 구성 및 초기화 ----------
let SUPABASE_URL = window.env?.SUPABASE_URL || localStorage.getItem('SUPABASE_URL') || '';
let SUPABASE_KEY = window.env?.SUPABASE_ANON_KEY || localStorage.getItem('SUPABASE_ANON_KEY') || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  const url = prompt("Supabase Project URL을 입력해주세요 (예: https://xxxx.supabase.co):");
  const key = prompt("Supabase Anon API Key를 입력해주세요:");
  if (url && key) {
    SUPABASE_URL = url.trim();
    SUPABASE_KEY = key.trim();
    localStorage.setItem('SUPABASE_URL', SUPABASE_URL);
    localStorage.setItem('SUPABASE_ANON_KEY', SUPABASE_KEY);
    window.location.reload();
  }
}

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY && window.supabase) {
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
} else {
  supabase = {
    from: () => ({
      select: async () => ({ data: null, error: 'Supabase 미초기화' }),
      insert: async () => ({ data: null, error: 'Supabase 미초기화' }),
      update: async () => ({ data: null, error: 'Supabase 미초기화' }),
      delete: async () => ({ data: null, error: 'Supabase 미초기화' })
    }),
    storage: { from: () => ({ upload: async () => ({ error: true }), getPublicUrl: () => ({ data: null }) }) }
  };
}

// ---------- Helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function calcBuyAmount(t){ return Number(t.buy_price||0) * Number(t.qty||0); }
function formatPnL(t) { return Number(t.pnl_val || 0); }
function rate(t) {
  const buyAmount = calcBuyAmount(t);
  const pnl = formatPnL(t);
  if (buyAmount <= 0) return 0;
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

// ---------- Zoom CSS & Fullscreen Helpers ----------
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
  }catch(e){}
  return false;
}
function toggleZoomFallback(el){
  ensureZoomStyles();
  if (el.classList.contains('img-zoomed')) el.classList.remove('img-zoomed');
  else { document.querySelectorAll('.img-zoomed').forEach(x=>x.classList.remove('img-zoomed')); el.classList.add('img-zoomed'); }
}

async function compressImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      const MAX_SIZE = 1000;

      if (width > height && width > MAX_SIZE) {
        height *= MAX_SIZE / width; width = MAX_SIZE;
      } else if (height > MAX_SIZE) {
        width *= MAX_SIZE / height; height = MAX_SIZE;
      }
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob((blob) => {
        resolve(new File([blob], file.name, { type: 'image/jpeg' }));
      }, 'image/jpeg', 0.65);
    };
    reader.readAsDataURL(file);
  });
}

async function uploadImageToSupabase(file) {
  if (!file) return null;
  file = await compressImage(file);
  const fileExt = file.name.split('.').pop();
  const fileName = `${Date.now()}_${Math.random().toString(36).substring(2,7)}.${fileExt}`;
  const filePath = `journal/${fileName}`;

  const { data, error } = await supabase.storage.from('journal-images').upload(filePath, file);
  if (error) {
    console.error("Storage 업로드 실패:", error);
    return null;
  }
  const { data: urlData } = supabase.storage.from('journal-images').getPublicUrl(filePath);
  return urlData?.publicUrl || null;
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
  form.querySelectorAll('input[type="file"]').forEach((inp)=>{
    const span = inp.closest('label')?.querySelector('span.btn-secondary');
    if (span) span.textContent = '파일 선택';
  });
  setFormMode('create');
}

function setFormMode(mode) {
  const saveBtn   = document.getElementById('saveBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const deleteBtn = document.getElementById('deleteTrade');
  if (!saveBtn || !cancelBtn || !deleteBtn) return;
  if (mode === 'edit') {
    saveBtn.textContent = '수정';
    cancelBtn.textContent = '취소';
    deleteBtn.classList.remove('hidden');
  } else {
    saveBtn.textContent = '저장';
    cancelBtn.textContent = '취소';
    deleteBtn.classList.add('hidden');
  }
}

function fillForm(t) {
  const form = $('#tradeForm');
  form.id.value = t.id || '';
  form.date.value = t.date || '';
  form.symbol.value = t.symbol || '';
  form.qty.value = t.qty ?? '';
  form.buy_price.value = t.buy_price ?? '';
  if (form.pnl_val) form.pnl_val.value = t.pnl_val ?? '';
  form.comment.value = t.comment || '';
  if (form.highlight) form.highlight.checked = !!t.highlight;

  document.querySelectorAll('input[name="tags[]"]').forEach(ch => { ch.checked = false; });
  if (t.tags) {
    const tagList = Array.isArray(t.tags) ? t.tags : String(t.tags).split(',').map(s=>s.trim());
    const set = new Set(tagList.filter(Boolean));
    document.querySelectorAll('input[name="tags[]"]').forEach(ch => { if (set.has(ch.value)) ch.checked = true; });
  }
  $('#deleteTrade').classList.toggle('hidden', !t.id);
  
  const span1 = form.querySelector('input[name="image1"]')?.closest('label')?.querySelector('span.btn-secondary');
  if (span1) span1.textContent = t.image1_url ? '이미지 저장됨' : '파일 선택';
  const span2 = form.querySelector('input[name="image2"]')?.closest('label')?.querySelector('span.btn-secondary');
  if (span2) span2.textContent = t.image2_url ? '이미지 저장됨' : '파일 선택';
}

// ---------- Month dropdown ----------
async function populateMonthSelect() {
  const toolbar = $('#searchInput')?.parentElement;
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

  const { data } = await supabase.from('trading_logs').select('date');
  if (!data) return;

  const months = Array.from(
    new Set(data.map(t => monthKeyOf(t.date)).filter(Boolean))
  ).sort().reverse();

  // 현재 월 (예: 2026-07)
  const today = new Date();
  const currentMonth =
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  // 이미 값이 있으면 유지, 처음 실행이면 현재 월 선택
  const cur = monthSel.value || currentMonth;

  monthSel.innerHTML = '<option value="all">전체</option>';

  months.forEach(key => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = monthLabel(key);
    monthSel.appendChild(opt);
  });

  if ([...monthSel.options].some(o => o.value === cur)) {
    monthSel.value = cur;
  } else {
    monthSel.value = 'all';
  }
}

// ---------- View counter helper ----------
async function incrementViews(id, currentViews) {
  const newViews = Number(currentViews || 0) + 1;
  await supabase.from('trading_logs').update({ views: newViews }).eq('id', id);
  return newViews;
}
// ---------- List render ----------
let chart = null;
async function renderList() {
  const scrollPos = window.scrollY;
  const q = $('#searchInput')?.value?.trim().toLowerCase() || '';
  const sortKey = $('#sortSelect')?.value || 'date_desc';
  const monthKey = $('#monthSelect')?.value || 'all'; // 형태: "2026-05" 또는 "all"

  // [성능 개선 1] Supabase 기본 쿼리 생성
  let query = supabase.from('trading_logs').select('*');

  // [월단위 검색 오류 수정] 하드코딩된 -31을 제거하고 해당 월의 안전한 범위 지정
  if (monthKey !== 'all') {
    // 30일/31일/윤달 상관없이 안전하게 해당 월 전체를 쿼리하기 위해 다음 달 1일 미만(<) 조건 사용
    const [year, month] = monthKey.split('-').map(Number);
    const startDate = `${monthKey}-01`;
    
    let nextYear = year;
    let nextMonth = month + 1;
    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }
    const nextMonthStr = String(nextMonth).padStart(2, '0');
    const endDateBoundary = `${nextYear}-${nextMonthStr}-01`;

    // gte(이동일 이상) 이고 lt(다음달 1일 미만) 이면 30일이든 31일이든 완벽하게 조회됨
    query = query.gte('date', startDate).lt('date', endDateBoundary);
  }

  // 데이터 가져오기 (태그 필터링을 JavaScript에서 유연하게 하기 위해 종목 쿼리는 대소문자 무시 결합 가능)
  const { data, error } = await query;
  if (error || !data) return;

  // [태그 및 종목명 검색 통합 처리] 자바스크립트 단에서 정밀하게 필터링
  let rows = [...data];
  if (q) {
    rows = rows.filter(t => {
      const symbolMatch = t.symbol ? t.symbol.toLowerCase().includes(q) : false;
      
      // tags가 배열, 문자열, 혹은 없는 경우를 모두 안전하게 체크
      let tagMatch = false;
      if (Array.isArray(t.tags)) {
        tagMatch = t.tags.some(tag => tag.toLowerCase().includes(q));
      } else if (typeof t.tags === 'string') {
        tagMatch = t.tags.toLowerCase().includes(q);
      }

      return symbolMatch || tagMatch;
    });
  }

  // 정렬 처리
  rows.sort((a, b) => {
    if (sortKey === 'date_desc') {
      const dateCmp = (b.date || '').localeCompare(a.date || '');
      return dateCmp !== 0 ? dateCmp : (b.id - a.id);
    }
    if (sortKey === 'date_asc') {
      const dateCmp = (a.date || '').localeCompare(b.date || '');
      return dateCmp !== 0 ? dateCmp : (a.id - b.id);
    }
    if (sortKey === 'pnl_desc') return formatPnL(b) - formatPnL(a);
    if (sortKey === 'pnl_asc') return formatPnL(a) - formatPnL(b);
    return 0;
  });

  // 테이블 생성 로직
  const table = [`<table class="min-w-full table-fixed text-xs">
    <thead class="text-slate-500">
      <tr>
        <th class="py-1 pr-2 w-16 text-left whitespace-nowrap">날짜</th>
        <th class="py-1 pr-2 w-28 text-left whitespace-nowrap">종목</th>
        <th class="py-1 pr-2 w-16 text-right whitespace-nowrap">수익률</th>
        <th class="py-1 pr-2 w-20 text-right whitespace-nowrap">손익</th>
        <th class="py-1 pr-2 w-12 text-right whitespace-nowrap">조회</th>
      </tr>
    </thead>
    <tbody>`];

  let lastDate = null, alt = false;
  for (const t of rows) {
    const pnl = formatPnL(t), r = rate(t), d = t.date || '';
    if (d !== lastDate) { alt = !alt; lastDate = d; }
    
    const symbolHtml = t.highlight
      ? `<span class="inline-flex items-center gap-1 font-semibold max-w-full overflow-hidden">
           <span class="inline-block w-2 h-2 rounded-full bg-amber-400"></span>
           <span class="block overflow-hidden text-ellipsis whitespace-nowrap">${t.symbol}</span>
         </span>`
      : `<span class="block overflow-hidden text-ellipsis whitespace-nowrap">${t.symbol}</span>`;

    // 태그가 존재할 경우 화면 종목명 밑이나 옆에 작게 노출하고 싶다면 템플릿 리터럴에 포함 가능 (현재는 기존 유지)
    table.push(`<tr class="border-t border-slate-200 cursor-pointer ${alt ? 'bg-slate-100' : 'bg-white'}" data-id="${t.id}">
      <td class="py-1 pr-2 whitespace-nowrap">${fmtDateNoYear(d)}</td>
      <td class="py-1 pr-2 w-28 max-w-28 overflow-hidden text-ellipsis whitespace-nowrap">${symbolHtml}</td>
      <td class="py-1 pr-2 text-right whitespace-nowrap">${r >= 0 ? `<span class="pnl-pos">${r.toFixed(2)}%</span>` : `<span class="pnl-neg">${r.toFixed(2)}%</span>`}</td>
      <td class="py-1 pr-2 text-right whitespace-nowrap">${pnl >= 0 ? `<span class="pnl-pos">${fmtNumber(Math.round(pnl))}</span>` : `<span class="pnl-neg">${fmtNumber(Math.round(pnl))}</span>`}</td>
      <td class="py-1 pr-2 w-12 text-right text-slate-600 whitespace-nowrap class-views">${fmtNumber(t.views || 0)}</td>
    </tr>`);
  }
  table.push(`</tbody></table>`);
  $('#listContainer').innerHTML = table.join('');

  requestAnimationFrame(() => { window.scrollTo(0, scrollPos); });

  // 클릭 이벤트 최적화 (재렌더링 무한루프 제거 및 메모리 내 데이터 즉시 반영)
  $('#listContainer').querySelectorAll('tr[data-id]').forEach(tr => {
    tr.addEventListener('click', async () => {
      const id = Number(tr.getAttribute('data-id'));
      const targetData = rows.find(x => x.id === id); // 현재 필터링된 리스트에서 찾기
      if (!targetData) return;
      
      // 조회수 증가 애니메이션 체감 속도를 위해 서버 통신 전에 화면 UI 숫자 먼저 1 올림
      const viewTd = tr.querySelector('.class-views');
      if (viewTd) viewTd.textContent = fmtNumber((targetData.views || 0) + 1);

      // 데이터 백엔드 전송
      const updatedViews = await incrementViews(id, targetData.views);
      targetData.views = updatedViews;
      
      // 상세 팝업 열기
      openDetail(targetData);
      
      // 버그 수정: 여기서 renderList()를 다시 호출하면 전체 데이터를 새로 긁어오므로 
      // 재호출을 과감히 생략하여 속도를 비약적으로 향상시킵니다.
    });
  });

  // 차트 렌더링용 집계 데이터 최적화 (현재 필터링되어 화면에 보이는 rows 데이터 기반 구축)
  if (typeof Chart !== 'undefined') {
    const byDate = {};
    for (const t of rows) {
      if (t.date) byDate[t.date] = (byDate[t.date] || 0) + formatPnL(t);
    }
    const days = Object.keys(byDate).sort();
    if (chart) chart.destroy();
    const ctx = document.getElementById('pnlChart');
    if (ctx) {
      chart = new Chart(ctx, {
        type: 'bar',
        data: { 
          labels: days.map(fmtDateNoYear), 
          datasets: [{ label: '일별 손익 합계', data: days.map(d => byDate[d]), backgroundColor: days.map(d => byDate[d] >= 0 ? '#ef4444' : '#3b82f6') }] 
        },
        options: { responsive: true, maintainAspectRatio: false }
      });
    }
  }
}

// 현재 축적된 전체 데이터(globalTrades)를 기준으로 월선택 필터 옵션을 자동 생성하는 함수
function updateMonthFilterOptions() {
  const monthSelect = document.getElementById('monthSelect');
  if (!monthSelect) return;

  // 현재 선택되어 있던 값을 임시 보관
  const currentValue = monthSelect.value;

  // 데이터에서 중복 없는 YYYY-MM 추출
  const monthsSet = new Set();
  globalTrades.forEach(trade => {
    if (trade.date && trade.date.length >= 7) {
      monthsSet.add(trade.date.substring(0, 7)); // "2026-05" 형태로 추출됨
    }
  });

  // 정렬 (최신 달이 위로 오게 하려면 오름차순/내림차순 정렬)
  const sortedMonths = Array.from(monthsSet).sort((a, b) => b.localeCompare(a));

  // HTML 옵션 초기화 (전체 기간은 고정)
  let optionsHtml = '<option value="all">전체 기간</option>';
  sortedMonths.forEach(m => {
    // 가독성을 위해 "2026-05"를 "2026년 05월"로 변환하여 노출
    const [year, month] = m.split('-');
    optionsHtml += `<option value="${m}">${year}년 ${month}월</option>`;
  });

  monthSelect.innerHTML = optionsHtml;

  // 이전에 선택했던 값이 새 옵션에도 존재하면 복원, 없으면 'all'
  if (sortedMonths.includes(currentValue)) {
    monthSelect.value = currentValue;
  } else {
    monthSelect.value = 'all';
  }
}

// ---------- Detail Modal ----------
async function openDetail(t){
  lastOpenedDetail = t;
  const pnl = formatPnL(t), r = rate(t), buyAmount = calcBuyAmount(t);

  // [성능 개선 핵심 2] 전체 조회를 하지 않고, 정확히 타겟팅된 해당 날짜의 일기 1건만 조회하도록 교체
  const { data: noteData } = await supabase.from('daily_notes').select('*').eq('date', t.date).maybeSingle();
  
  const dayMemo = noteData?.note_text || '기록된 일자 메모가 없습니다.';
  const dayImg1 = noteData?.note_img1_url;
  const dayImg2 = noteData?.note_img2_url;

  const displayTags = Array.isArray(t.tags) ? t.tags.join(', ') : (t.tags || '');

  const html = `
    <div class="detail-grid">
      <div><div class="text-slate-500 text-sm">날짜</div><div class="font-medium">${t.date||''}</div></div>
      <div><div class="text-slate-500 text-sm">종목명</div><div class="font-medium">${t.symbol||''}</div></div>
      <div><div class="text-slate-500 text-sm">수익률</div><div>${r>=0?`<span class="pnl-pos">${r.toFixed(2)}%</span>`:`<span class="pnl-neg">${r.toFixed(2)}%</span>`}</div></div>
      <div><div class="text-slate-500 text-sm">손익</div><div>${pnl>=0?`<span class="pnl-pos">${fmtNumber(Math.round(pnl))}</span>`:`<span class="pnl-neg">${fmtNumber(Math.round(pnl))}</span>`}</div></div>
      <div><div class="text-slate-500 text-sm">매수금액</div><div class="font-medium">${fmtNumber(Math.round(buyAmount))}</div></div>
      <div><div class="text-slate-500 text-sm">태그</div><div class="font-medium whitespace-pre-wrap">${displayTags}</div></div>
      <div style="grid-column: 1 / -1;"><div class="text-slate-500 text-sm">코멘트</div><div id="detailComment" class="mt-1 p-2 rounded border border-slate-200 bg-slate-50 whitespace-pre overflow-x-auto text-sm leading-relaxed"></div></div>
      <div class="detail-images" style="display:flex;gap:.75rem;">
        ${t.image1_url?`<img id="img1" src="${t.image1_url}" class="detail-img" style="width:50%;">`:''}
        ${t.image2_url?`<img id="img2" src="${t.image2_url}" class="detail-img" style="width:50%;">`:''}
      </div>
    </div>
    <hr class="my-4 border-slate-200">
    <div class="mt-4">
      <div class="text-slate-500 text-sm mb-2">📅 해당 일자 메모 & 이미지</div>
      <div class="p-3 bg-amber-50 rounded border border-amber-100 text-sm whitespace-pre-wrap">${dayMemo}</div>
      <div class="flex gap-2 mt-2">
        ${dayImg1 ? `<img id="dayImg1" src="${dayImg1}" class="detail-img" style="width:100px; height:100px; object-fit:cover; border-radius:4px;">` : ''}
        ${dayImg2 ? `<img id="dayImg2" src="${dayImg2}" class="detail-img" style="width:100px; height:100px; object-fit:cover; border-radius:4px;">` : ''}
      </div>
    </div>`;

  $('#detailContent').innerHTML = html;
  if ($('#detailComment')) $('#detailComment').textContent = t.comment || '';
  const modal = $('#detailModal');
  modal.classList.add('show');

  const closeBtn = document.getElementById('detailClose');
  if (closeBtn) { closeBtn.onclick = () => { modal.classList.remove('show'); }; }
  
  function attachZoomHandler(id){
    const el = document.getElementById(id);
    if (!el) return;
    el.onclick = async (ev)=>{
      ev.stopPropagation();
      if (!(await tryFullscreen(el))) toggleZoomFallback(el);
    };
  }
  attachZoomHandler('img1'); attachZoomHandler('img2'); attachZoomHandler('dayImg1'); attachZoomHandler('dayImg2');

  let editBtn = document.getElementById('detailEdit');
  if (editBtn) editBtn.remove();
  editBtn = document.createElement('button');
  editBtn.id = 'detailEdit'; editBtn.className = 'btn-secondary'; editBtn.textContent = '편집';
  editBtn.style.position = 'absolute'; editBtn.style.right = '.75rem'; editBtn.style.top = '3rem';
  document.getElementById('detailClose')?.insertAdjacentElement('afterend', editBtn);

  editBtn.addEventListener('click', ()=>{
    modal.classList.remove('show');
    document.querySelector('[data-tab="form"]')?.click();
    fillForm(t);
    setFormMode('edit');
    editModeFromDetail = true;
    document.getElementById('tradeForm')?.scrollIntoView({behavior:'smooth', block:'start'});
  });
}

// ---------- Calendar Logic ----------
let calendar = null;
function recomputeCalendarEvents(all) {
  const sums = {};
  all.forEach(t => { if (t.date) sums[t.date] = (sums[t.date] || 0) + formatPnL(t); });
  const events = [];
  const dates = Object.keys(sums).sort();
  for (const d of dates) {
    const val = sums[d] || 0;
    events.push({
      title: fmtMan(Math.round(val)), start: d, allDay: true,
      textColor: val >= 0 ? '#dc2626' : '#2563eb', color: 'transparent',
      extendedProps: { kind: 'daily', dateStr: d }
    });
  }
  if (dates.length) {
    const min = new Date(dates[0]), max = new Date(dates[dates.length - 1]);
    for (let cur = new Date(min); cur <= max; cur.setDate(cur.getDate()+7)) {
      const weekStart = new Date(cur);
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay()+6)%7));
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate()+6);
      const keyStart = weekStart.toISOString().slice(0,10), keyEnd = weekEnd.toISOString().slice(0,10);

      let sum = 0;
      for (const d of Object.keys(sums)) if (d >= keyStart && d <= keyEnd) sum += sums[d];
      const saturday = new Date(weekStart); saturday.setDate(saturday.getDate()+5);
      events.push({
        title: fmtMan(Math.round(sum)), start: saturday.toISOString().slice(0,10), allDay: true,
        color: sum >= 0 ? '#dc2626' : '#2563eb', textColor: '#ffffff',
        extendedProps: { kind: 'weekly', weekStart: keyStart, weekEnd: keyEnd }
      });
    }
  }
  return events;
}

async function initCalendar() {
  const calEl = document.getElementById('calendar');
  if (!calEl || typeof FullCalendar === 'undefined') return;
  
  calendar = new FullCalendar.Calendar(calEl, {
    initialView: 'dayGridMonth', height: 'auto', locale: 'ko',
    dayCellDidMount: (arg) => {
      const d = arg.date.getDay();
      if (d === 0) arg.el.style.color = '#dc2626';
      if (d === 6) arg.el.style.color = '#2563eb';
    },
    dateClick: async (info) => { await renderCalendarList(info.dateStr); },
    eventClick: async (info) => {
      const ep = info.event.extendedProps || {};
      if (ep.kind === 'daily') await renderCalendarList(ep.dateStr);
      else if (ep.kind === 'weekly') await renderWeekList(ep.weekStart, ep.weekEnd);
    },
    eventDidMount: function(info) {
      if (info.event.extendedProps.kind === 'daily') {
        info.el.style.fontWeight = 'bold'; info.el.style.border = 'none'; info.el.style.textAlign = 'center';
      }
      if (info.event.extendedProps.kind === 'weekly') {
        info.el.style.borderRadius = '4px'; info.el.style.padding = '2px'; info.el.style.textAlign = 'center';
      }
    }
  });
  calendar.render();
  await refreshCalendar();
}
async function refreshCalendar() {
  if (!calendar) return;
  const { data } = await supabase.from('trading_logs').select('date, pnl_val');
  if (data) { calendar.removeAllEvents(); calendar.addEventSource(recomputeCalendarEvents(data)); }
}

// ---------- Day note modal & Supabase integration ----------
let currentNoteDate = null;
const noteModal = document.getElementById('noteModal');

function highlightCalendarDate(dateStr) {
  document.querySelectorAll('.fc-daygrid-day').forEach(el => {
    if (dateStr && el.dataset.date === dateStr) el.classList.add('cal-selected-day');
    else el.classList.remove('cal-selected-day');
  });
}

async function openNoteModal(dateStr) {
  currentNoteDate = dateStr;
  if (!noteModal) return;
  $('#noteDateLabel').textContent = `${dateStr} 메모 및 이미지`;

  // [최적화 적용] 전체를 뽑지 않고 1개만 매칭해서 패치
  const { data: row } = await supabase.from('daily_notes').select('*').eq('date', dateStr).maybeSingle();

  const preview1 = $('#noteImg1Preview');
  const preview2 = $('#noteImg2Preview');

  $('#noteText').value = row?.note_text || '';
  
  if (row?.note_img1_url) { 
    preview1.src = row.note_img1_url; preview1.classList.remove('hidden'); 
  } else { preview1.classList.add('hidden'); }
  
  if (row?.note_img2_url) { 
    preview2.src = row.note_img2_url; preview2.classList.remove('hidden'); 
  } else { preview2.classList.add('hidden'); }

  const attachNoteZoom = (el) => {
    if (!el) return;
    el.onclick = (ev) => {
      ev.stopPropagation();
      openFullscreenImage(el.src);
    };
  };
  attachNoteZoom(preview1); attachNoteZoom(preview2);
  noteModal.classList.remove('hidden');
}

function setupNoteModalEvents() {
  if (!noteModal) return;
  $('#noteClose')?.addEventListener('click', () => noteModal.classList.add('hidden'));
  $('#noteImg1Btn')?.addEventListener('click', () => $('#noteImg1Input').click());
  $('#noteImg2Btn')?.addEventListener('click', () => $('#noteImg2Input').click());

  $('#noteText')?.addEventListener('blur', async () => {
    if (!currentNoteDate) return;
    const txt = $('#noteText').value;
    const { data: exist } = await supabase.from('daily_notes').select('id').eq('date', currentNoteDate).maybeSingle();

    if (exist) {
      await supabase.from('daily_notes').update({ note_text: txt }).eq('id', exist.id);
    } else {
      await supabase.from('daily_notes').insert({ date: currentNoteDate, note_text: txt });
    }
  });

  async function handleNoteImg(inputEl, previewEl, fieldName) {
    inputEl.addEventListener('change', async () => {
      const file = inputEl.files?.[0];
      if (!file || !currentNoteDate) return;
      const uploadedUrl = await uploadImageToSupabase(file);
      if (!uploadedUrl) return;

      previewEl.src = uploadedUrl; previewEl.classList.remove('hidden');

      previewEl.onclick = async (ev) => {
        ev.stopPropagation();
        if (typeof tryFullscreen === 'function') {
          if (!(await tryFullscreen(previewEl))) {
            if (typeof toggleZoomFallback === 'function') toggleZoomFallback(previewEl);
          }
        }
      };

      const { data: exist } = await supabase.from('daily_notes').select('id').eq('date', currentNoteDate).maybeSingle();
      const payload = {}; payload[fieldName] = uploadedUrl;

      if (exist) await supabase.from('daily_notes').update(payload).eq('id', exist.id);
      else { payload.date = currentNoteDate; await supabase.from('daily_notes').insert(payload); }
    });
  }
  
  handleNoteImg($('#noteImg1Input'), $('#noteImg1Preview'), 'note_img1_url');
  handleNoteImg($('#noteImg2Input'), $('#noteImg2Preview'), 'note_img2_url');

  document.getElementById('noteImg1Preview')?.addEventListener('click', (e) => {
    e.stopPropagation(); openFullscreenImage(e.target.src);
  });
  document.getElementById('noteImg2Preview')?.addEventListener('click', (e) => {
    e.stopPropagation(); openFullscreenImage(e.target.src);
  });
  document.getElementById('imgFullscreen')?.addEventListener('click', () => {
    closeFullscreenImage();
  });
}

function openFullscreenImage(src) {
  const wrap = document.getElementById('imgFullscreen');
  const img = document.getElementById('imgFullscreenImg');
  if (!wrap || !img || !src) return;
  img.src = src;
  wrap.classList.remove('hidden');
  wrap.style.display = 'flex';
}

function closeFullscreenImage() {
  const wrap = document.getElementById('imgFullscreen');
  if (!wrap) return;
  wrap.classList.add('hidden');
  wrap.style.display = 'none';
}

// ---------- Calendar List View ----------
async function renderCalendarList(dateStr) {
  const { data } = await supabase.from('trading_logs').select('*').eq('date', dateStr);
  const rows = (data || []).sort((a,b)=> (a.created_at||'').localeCompare(b.created_at||''));
  const total = rows.reduce((acc, t)=> acc + formatPnL(t), 0);

  const headerHtml = `<div class="card"><h3 class="font-semibold flex justify-between items-center">
    <span>${dateStr} 매매 (합계: ${total>=0 ? `<span class='pnl-pos'>${fmtNumber(Math.round(total))}</span>` : `<span class='pnl-neg'>${fmtNumber(Math.round(total))}</span>`})</span>
    <button type="button" class="p-1 rounded hover:bg-slate-100" id="dayNoteBtn">📊</button></h3>`;

  const out = [headerHtml, `<table class="min-w-full text-sm mt-2"><thead class="text-slate-500"><tr><th class="py-1 pr-3 nowrap">종목</th><th class="py-1 pr-3 nowrap text-right">수익률</th><th class="py-1 pr-3 nowrap text-right">손익</th><th class="py-1 pr-3 nowrap">태그</th></tr></thead><tbody>`];

  for (const t of rows) {
    const pnl = formatPnL(t), r = rate(t);
    const tagsStr = Array.isArray(t.tags) ? t.tags.join(',') : (t.tags || '');
    out.push(`<tr class="border-t border-slate-100">
      <td class="py-1 pr-3 nowrap"><button class="link-symbol underline" data-id="${t.id}">${t.symbol}</button></td>
      <td class="py-1 pr-3 nowrap text-right">${r>=0?`<span class="pnl-pos">${r.toFixed(2)}%</span>`:`<span class="pnl-neg">${r.toFixed(2)}%</span>`}</td>
      <td class="py-1 pr-3 nowrap text-right">${pnl>=0?`<span class="pnl-pos">${fmtNumber(Math.round(pnl))}</span>`:`<span class="pnl-neg">${fmtNumber(Math.round(pnl))}</span>`}</td>
      <td class="py-1 pr-3 nowrap">${tagsStr}</td></tr>`);
  }
  out.push(`</tbody></table></div>`);
  $('#calendarList').innerHTML = out.join('');
  highlightCalendarDate(dateStr);

  $('#calendarList').querySelectorAll('.link-symbol').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = Number(btn.getAttribute('data-id'));
      const found = rows.find(x => x.id === id);
      if(!found) return;
      await incrementViews(id, found.views);
      found.views = Number(found.views || 0) + 1;
      openDetail(found);
      renderList();
    });
  });
  document.getElementById('dayNoteBtn')?.addEventListener('click', () => openNoteModal(dateStr));
}

async function renderWeekList(sKey, eKey) {
  const { data } = await supabase.from('trading_logs').select('*').gte('date', sKey).lte('date', eKey);
  const rows = (data || []).sort((a,b)=> (a.date||'').localeCompare(b.date||''));
  const total = rows.reduce((acc, t)=> acc + formatPnL(t), 0);

  const out = [`<div class="card"><h3 class="font-semibold">${sKey} ~ ${eKey} 주간 매매 (합계: ${total>=0?`<span class='pnl-pos'>${fmtNumber(Math.round(total))}</span>`:`<span class='pnl-neg'>${fmtNumber(Math.round(total))}</span>`})</h3>`, `<table class="min-w-full text-sm mt-2"><thead class="text-slate-500"><tr><th class="py-1 pr-3 nowrap">날짜</th><th class="py-1 pr-3 nowrap">종목</th><th class="py-1 pr-3 nowrap text-right">수익률</th><th class="py-1 pr-3 nowrap text-right">손익</th><th class="py-1 pr-3 nowrap">태그</th></tr></thead><tbody>`];

  for (const t of rows) {
    const pnl = formatPnL(t), r = rate(t);
    const tagsStr = Array.isArray(t.tags) ? t.tags.join(',') : (t.tags || '');
    out.push(`<tr class="border-t border-slate-100">
      <td class="py-1 pr-3 nowrap">${fmtDateNoYear(t.date)}</td>
      <td class="py-1 pr-3 nowrap"><button class="link-symbol underline" data-id="${t.id}">${t.symbol}</button></td>
      <td class="py-1 pr-3 nowrap text-right">${r>=0?`<span class="pnl-pos">${r.toFixed(2)}%</span>`:`<span class="pnl-neg">${r.toFixed(2)}%</span>`}</td>
      <td class="py-1 pr-3 nowrap text-right">${pnl>=0?`<span class="pnl-pos">${fmtNumber(Math.round(pnl))}</span>`:`<span class="pnl-neg">${fmtNumber(Math.round(pnl))}</span>`}</td>
      <td class="py-1 pr-3 nowrap">${tagsStr}</td></tr>`);
  }
  out.push(`</tbody></table></div>`);
  $('#calendarList').innerHTML = out.join('');
  highlightCalendarDate(null);

  $('#calendarList').querySelectorAll('.link-symbol').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = Number(btn.getAttribute('data-id'));
      const found = rows.find(x => x.id === id);
      if(!found) return;
      await incrementViews(id, found.views);
      found.views = Number(found.views || 0) + 1;
      openDetail(found);
      renderList();
    });
  });
}

// ---------- Tab logic ----------
function switchTab(name) {
  $$('.card').forEach(sec=>sec.classList.add('hidden'));
  $('#tab-' + name)?.classList.remove('hidden');
  $$('.tab-btn').forEach(btn=>btn.classList.remove('tab-active'));
  document.querySelector(`[data-tab="${name}"]`)?.classList.add('tab-active');

  if (name === 'calendar') {
    setTimeout(() => calendar?.updateSize(), 50);
  }
  if (name === 'list' && !$('#tradeForm').id.value) renderList();
}

// ---------- Init ----------
(async function init() {
  $$('.tab-btn').forEach(btn=>btn.addEventListener('click', ()=>switchTab(btn.dataset.tab)));
  switchTab('list');
  
  if (SUPABASE_URL && SUPABASE_KEY) {
    await populateMonthSelect();
    await renderList();
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }

  const form = $('#tradeForm');
  if (form) {
    ['image1','image2'].forEach(name=>{
      const input = form.querySelector(`input[name="${name}"]`);
      input?.addEventListener('change', ()=>{
        const f = input.files?.[0];
        const span = input.closest('label')?.querySelector('span.btn-secondary');
        if (span) span.textContent = f ? f.name : '파일 선택';
      });
    });
  }

  $('#searchInput')?.addEventListener('input', renderList);
  $('#sortSelect')?.addEventListener('change', renderList);
  // ---------- App Initialization ----------

  // [수정] 월 선택 드롭다운 변경 시 실시간 반영 (HTML id="monthSelect"와 매칭)
  $('#monthSelect')?.addEventListener('change', renderList);
  

  // Submit Logic
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
  
    try {
      const editId = f.id.value ? Number(f.id.value) : null;
      let existingRecord = null;
      let savedTrade = null;
  
      if (editId) {
        const { data } = await supabase.from('trading_logs').select('*').eq('id', editId).maybeSingle();
        existingRecord = data;
      }
  
      let url1 = existingRecord?.image1_url || null;
      let url2 = existingRecord?.image2_url || null;
  
      if (f.image1?.files?.[0]) {
        const compressed1 = await compressImage(f.image1.files[0]);
        url1 = await uploadImageToSupabase(compressed1);
      }
      if (f.image2?.files?.[0]) {
        const compressed2 = await compressImage(f.image2.files[0]);
        url2 = await uploadImageToSupabase(compressed2);
      }
  
      const chosenTags = Array.from(
        document.querySelectorAll('input[name="tags[]"]:checked')
      ).map(x => x.value);
  
      const payload = {
        date: f.date.value,
        symbol: f.symbol.value.trim(),
        qty: Number(f.qty.value || 0),
        buy_price: Number(f.buy_price.value || 0),
        pnl_val: Number(f.pnl_val.value || 0),
        tags: chosenTags,
        comment: f.comment.value,
        image1_url: url1,
        image2_url: url2,
        highlight: !!f.highlight?.checked,
        views: existingRecord ? Number(existingRecord.views || 0) : 0
      };
  
      if (editId) {
        await supabase.from('trading_logs').update(payload).eq('id', editId);
        savedTrade = { ...existingRecord, ...payload, id: editId };
        alert('수정이 완료되었습니다.');
      } else {
        payload.created_at = new Date().toISOString();
        const { data: insertedData } = await supabase.from('trading_logs').insert(payload).select().single();
        savedTrade = insertedData;
        alert('저장 완료');
      }
  
      await renderList();
      await refreshCalendar();
      clearForm(); 
      switchTab('list');
  
      if (savedTrade) { openDetail(savedTrade); }
    } catch (err) {
      console.error(err);
      alert("처리 중 에러가 발생했습니다.");
    }
  });

  function handleCancelAction(ev) {
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
    if (window.isCancelProcessing) return;
    window.isCancelProcessing = true;
    setTimeout(() => { window.isCancelProcessing = false; }, 300);

    const isFromDetail = editModeFromDetail;
    const backupDetail = lastOpenedDetail;

    clearForm();
    switchTab('list');

    if (isFromDetail && backupDetail) {
      setTimeout(() => { openDetail(backupDetail); }, 150);
    }
    editModeFromDetail = false;
  }

  const cancelBtnEl = document.getElementById('cancelBtn');
  if (cancelBtnEl) {
    const newCancelBtn = cancelBtnEl.cloneNode(true);
    cancelBtnEl.parentNode.replaceChild(newCancelBtn, cancelBtnEl);
    newCancelBtn.addEventListener('click', handleCancelAction);
  }

  $('#deleteTrade')?.addEventListener('click', async ()=>{
    const id = Number($('#tradeForm').id.value);
    if (id && confirm('이 거래를 삭제할까요?')) {
      await supabase.from('trading_logs').delete().eq('id', id);
      clearForm();
      await populateMonthSelect();
      await renderList();
      await refreshCalendar();
      switchTab('list');
    }
  });

  await initCalendar();
  setupNoteModalEvents();
})();

// ---------- 앱 잠금번호 설정 ----------
const APP_PASSWORD = "9410"; 

document.addEventListener('DOMContentLoaded', () => {
  const lockModal = document.getElementById('lockModal');
  const passwordInput = document.getElementById('lockPassword');
  const unlockBtn = document.getElementById('lockUnlockBtn');
  const errorMsg = document.getElementById('lockError');

  /*function checkPassword() {
    if (passwordInput.value === APP_PASSWORD) {
      lockModal.style.setProperty('display', 'none', 'important');
      passwordInput.value = '';
      errorMsg.classList.add('hidden');
    } else {
      errorMsg.classList.remove('hidden');
      passwordInput.value = '';
      passwordInput.focus();
      if (navigator.vibrate) navigator.vibrate(200); 
    }
  }*/
// app.js 내부의 기존 checkPassword() 부분을 찾아 아래와 같이 교체해 주세요.
  function checkPassword() {
    if (passwordInput.value === APP_PASSWORD) {
      lockModal.style.setProperty('display', 'none', 'important');
      passwordInput.value = '';
      errorMsg.classList.add('hidden');

      // [추가] 비밀번호가 맞았을 때 숨겨져 있던 본문 레이아웃을 표시합니다.
      const appMain = document.getElementById('app');
      if (appMain) {
        appMain.classList.remove('hidden');
      }
      
    } else {
      errorMsg.classList.remove('hidden');
      passwordInput.value = '';
      passwordInput.focus();
      if (navigator.vibrate) navigator.vibrate(200); 
    }
  }

  unlockBtn?.addEventListener('click', checkPassword);
  passwordInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') checkPassword();
  });
  passwordInput?.addEventListener('input', () => {
    if (passwordInput.value.length === 4) {
      setTimeout(checkPassword, 100);
    }
  });
});
window.__APP_OK__ = true;
