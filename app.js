/* Trading Journal - v6.1b (based on v6.1)
 * Minimal tweaks only:
 * 1) '편집' 버튼을 닫기 버튼에서 약 1mm(≈4px) 더 떨어뜨림
 * 2) '편집' 클릭 시 날짜 입력에 포커스를 주지 않음 (모바일 달력 자동 표시 방지)
 *    → 대신 종목(symbol) 필드에 포커스를 줌
 *
 * This file should behave exactly like your working v6.1 except for the two tweaks above.
 * Paste/replace over your current app.js (which was v6.1 base).
 */

/* ===== v6.1 원본의 openDetail()만 최소 변경 ===== */
function openDetail(t){
  const pnl = (Number(t.sell_price||0) - Number(t.buy_price||0)) * Number(t.qty||0);
  const r = t.buy_price ? ((Number(t.sell_price||0) / Number(t.buy_price||0)) - 1) * 100 : 0;
  const buyAmount = (Number(t.buy_price||0) * Number(t.qty||0));

  const fmtNumber = (n)=>{ try { return Number(n).toLocaleString('ko-KR'); } catch { return String(n); } };
  const fmtPrice = (n)=>{
    const v = Number(n||0);
    const hasFraction = Math.abs(v - Math.trunc(v)) > 1e-6;
    return hasFraction ? v.toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2}) : v.toLocaleString('ko-KR');
  };

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
    </div>`;

  const modal = document.getElementById('detailModal');
  const host  = document.getElementById('detailContent');
  host.innerHTML = html;
  modal.classList.add('show');

  // 확대(풀스크린/폴백) — v6.1과 동일
  function ensureZoomStyles(){
    if (document.getElementById('zoom-style')) return;
    const css = `.img-zoomed{position:fixed!important;inset:0!important;background:rgba(0,0,0,.85)!important;object-fit:contain!important;width:100vw!important;height:100vh!important;z-index:9999!important;cursor:zoom-out!important}`;
    const s = document.createElement('style'); s.id='zoom-style'; s.textContent=css; document.head.appendChild(s);
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
  function toggleZoomFallback(el){ ensureZoomStyles(); el.classList.toggle('img-zoomed'); }
  ['img1','img2'].forEach(id=>{
    const el = document.getElementById(id); if (!el) return;
    el.style.cursor='zoom-in';
    el.addEventListener('click', async (ev)=>{
      ev.stopPropagation();
      const ok = await tryFullscreen(el);
      if (!ok) toggleZoomFallback(el);
    });
  });

  // ---- 편집 버튼 추가 (닫기 아래 약 1mm 간격) ----
  const closeBtn = document.getElementById('detailClose');
  const modalCard = closeBtn?.closest('.modal-card');
  if (modalCard) modalCard.style.position = 'relative';

  let editBtn = document.getElementById('detailEdit');
  if (editBtn) editBtn.remove();
  editBtn = document.createElement('button');
  editBtn.id = 'detailEdit';
  editBtn.className = 'btn-secondary';
  editBtn.type = 'button';
  editBtn.textContent = '편집';

  // v6.1: top 3rem → v6.1b: 3rem + 4px (약 1mm)
  editBtn.style.position = 'absolute';
  editBtn.style.right = '.75rem';
  editBtn.style.top   = 'calc(3rem + 4px)';
  closeBtn?.insertAdjacentElement('afterend', editBtn);

  // ---- 편집 클릭 → 폼 탭 + 자동 채움 (날짜 포커스 X, 종목 포커스 O) ----
  function fillForm(t){
    const form = document.getElementById('tradeForm');
    if (!form) return;
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
    const del = document.getElementById('deleteTrade');
    if (del) del.classList.toggle('hidden', !t.id);
    ['image1','image2'].forEach((key)=>{
      const input = form.querySelector(`input[name="${key}"]`);
      const span = input?.closest('label')?.querySelector('span.btn-secondary');
      if (span) span.textContent = t[key] ? '이미지 저장됨' : '파일 선택';
    });
  }

  editBtn.addEventListener('click', ()=>{
    // 모달 닫기
    modal.classList.remove('show');
    // 폼 탭 열기 (form → input 순으로 탐색)
    (document.querySelector('[data-tab="form"]') || document.querySelector('[data-tab="input"]'))?.click();
    // 값 채우기
    fillForm(t);
    // 날짜 입력 포커스 제거 (모바일 달력 자동표시 방지)
    // 대신 종목(symbol) 입력에 포커스
    document.getElementById('tradeForm')?.querySelector('input[name="symbol"]')?.focus({ preventScroll:false });
  });

  // 바깥 영역 클릭 시 닫기 (v6.1과 동일)
  function closeDetail(){ modal.classList.remove('show'); }
  document.addEventListener('click', (e)=>{ if (e.target && e.target.id === 'detailClose') closeDetail(); }, { once:true });
  document.getElementById('detailModal').addEventListener('click', (e)=>{
    if (e.target.id === 'detailModal') closeDetail();
  }, { once:true });
}
