/* Trading Journal - v6.1c (stability hotfix)
 * Safe patch on top of your working v6.1
 * - No absolute positioning → no invisible overlay hijacking clicks
 * - '편집' placed right *after* '닫기' as a normal flow element with small margin
 * - Robust click handlers with stopPropagation + preventDefault
 * - No auto-focus on date (prevents mobile calendar pop)
 * Drop-in: replace your openDetail(t) only.
 */

function openDetail(t){
  // helpers (use the same ones v6.1 had if they exist)
  const fmtNumber = (n)=>{ try { return Number(n).toLocaleString('ko-KR'); } catch { return String(n); } };
  const formatPnL = (x)=> (Number(x.sell_price||0) - Number(x.buy_price||0)) * Number(x.qty||0);
  const rate = (x)=> x.buy_price ? ((Number(x.sell_price||0) / Number(x.buy_price||0)) - 1) * 100 : 0;

  const pnl = formatPnL(t);
  const r = rate(t);
  const buyAmount = (Number(t.buy_price||0) * Number(t.qty||0));

  const host  = document.getElementById('detailContent');
  const modal = document.getElementById('detailModal');
  if (!host || !modal) return;

  host.innerHTML = `
    <div class="detail-grid">
      <div><div class="text-slate-500 text-sm">날짜</div><div class="font-medium">${t.date||''}</div></div>
      <div><div class="text-slate-500 text-sm">종목명</div><div class="font-medium">${t.symbol||''}</div></div>
      <div><div class="text-slate-500 text-sm">수익률</div><div class="font-semibold">${
        r>=0?`<span class="pnl-pos">${r.toFixed(2)}%</span>`:`<span class="pnl-neg">${r.toFixed(2)}%</span>`
      }</div></div>
      <div><div class="text-slate-500 text-sm">수익금</div><div class="font-semibold">${
        pnl>=0?`<span class="pnl-pos">${fmtNumber(Math.round(pnl))}</span>`:`<span class="pnl-neg">${fmtNumber(Math.round(pnl))}</span>`
      }</div></div>
      <div><div class="text-slate-500 text-sm">매수금액</div><div class="font-medium">${fmtNumber(Math.round(buyAmount))}</div></div>
      <div><div class="text-slate-500 text-sm">Tags</div><div class="font-medium">${t.tags||''}</div></div>

      <div class="detail-images" style="display:flex;gap:.75rem;">
        ${t.image1?`<img id="img1" src="${t.image1}" class="detail-img" style="width:50%;cursor:zoom-in">`:''}
        ${t.image2?`<img id="img2" src="${t.image2}" class="detail-img" style="width:50%;cursor:zoom-in">`:''}
      </div>

      <div class="mt-4 flex flex-col items-end gap-2">
        <button id="detailClose" type="button" class="btn-secondary">닫기</button>
        <button id="detailEdit"  type="button" class="btn-primary" style="margin-top:4px">편집</button>
      </div>
    </div>
  `;

  // show modal
  modal.classList.add('show');

  // zoom helpers (non-blocking)
  function ensureZoomStyles(){
    if (document.getElementById('zoom-style')) return;
    const css = `.img-zoomed{position:fixed!important;inset:0!important;background:rgba(0,0,0,.85)!important;object-fit:contain!important;width:100vw!important;height:100vh!important;z-index:9999!important;cursor:zoom-out!important}`;
    const s = document.createElement('style'); s.id='zoom-style'; s.textContent=css; document.head.appendChild(s);
  }
  async function tryFullscreen(el){
    try{
      if (document.fullscreenElement === el || document.webkitFullscreenElement === el) {
        if (document.exitFullscreen)      await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        return true;
      } else {
        if (el.requestFullscreen)            { await el.requestFullscreen(); return true; }
        else if (el.webkitRequestFullscreen) { el.webkitRequestFullscreen();  return true; }
      }
    }catch(e){}
    return false;
  }
  function toggleZoomFallback(el){ ensureZoomStyles(); el.classList.toggle('img-zoomed'); }
  ['img1','img2'].forEach(id=>{
    const el = document.getElementById(id); if (!el) return;
    el.addEventListener('click', async (ev)=>{
      ev.preventDefault(); ev.stopPropagation();
      const ok = await tryFullscreen(el);
      if (!ok) toggleZoomFallback(el);
    });
  });

  // close & overlay
  const onClose = (ev)=>{ ev?.preventDefault?.(); ev?.stopPropagation?.(); modal.classList.remove('show'); };
  document.getElementById('detailClose')?.addEventListener('click', onClose);
  modal.addEventListener('click', (e)=>{ if (e.target.id === 'detailModal') onClose(e); });

  // edit → form
  document.getElementById('detailEdit')?.addEventListener('click', (e)=>{
    e.preventDefault(); e.stopPropagation();
    modal.classList.remove('show');

    // switch to form tab
    const tabBtn = document.querySelector('[data-tab="form"], [data-tab="input"]');
    tabBtn?.click();

    // fill form (reuse existing fields)
    const form = document.getElementById('tradeForm');
    if (form){
      form.id.value = t.id || '';
      form.date.value = t.date || '';
      form.symbol.value = t.symbol || '';
      form.qty.value = t.qty ?? '';
      form.buy_price.value = t.buy_price ?? '';
      form.sell_price.value = t.sell_price ?? '';
      form.comment.value = t.comment || '';
      // tags
      document.querySelectorAll('input[name="tags[]"]').forEach(ch => ch.checked = false);
      if (t.tags) {
        const set = new Set(String(t.tags).split(',').map(s=>s.trim()).filter(Boolean));
        document.querySelectorAll('input[name="tags[]"]').forEach(ch => { if (set.has(ch.value)) ch.checked = true; });
      }
      // image label text
      ['image1','image2'].forEach((key)=>{
        const input = form.querySelector(`input[name="${key}"]`);
        const span = input?.closest('label')?.querySelector('span.btn-secondary');
        if (span) span.textContent = t[key] ? '이미지 저장됨' : '파일 선택';
      });
      // NO focus on date (prevents mobile calendar)
      // form.querySelector('input[name="symbol"]')?.focus(); // <— enable if you want
    }
  });
}

console.log('[patch] v6.1c openDetail override applied');
