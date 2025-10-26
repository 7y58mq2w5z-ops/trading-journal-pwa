/* Trading Journal - v6.1d (based on your working v6.1)
 * Changes:
 * 1) Edit → no focus on date (no calendar popup). We don't focus anything.
 * 2) While editing, show a '취소' button next to existing buttons; clicking it cancels edit (clear + back to list).
 */

// --- DB helpers (same as v6.1 minimal) ---
const DB_NAME = 'journal-db'; const STORE_NAME = 'trades'; let db;
function openDB() { return new Promise((resolve,reject)=>{
  const req = indexedDB.open(DB_NAME,1);
  req.onupgradeneeded = (e)=>{ const db=e.target.result; if(!db.objectStoreNames.contains(STORE_NAME)){ const s=db.createObjectStore(STORE_NAME,{keyPath:'id',autoIncrement:true}); s.createIndex('date','date'); s.createIndex('symbol','symbol'); } };
  req.onsuccess=()=>{ db=req.result; resolve(db); }; req.onerror=()=>reject(req.error);
});}
function idbGet(id){return new Promise((resolve,reject)=>{const tx=db.transaction(STORE_NAME,'readonly');const r=tx.objectStore(STORE_NAME).get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function idbAdd(t){return new Promise((resolve,reject)=>{const tx=db.transaction(STORE_NAME,'readwrite');tx.objectStore(STORE_NAME).add(t).onsuccess=(e)=>resolve(e.target.result);tx.onerror=()=>reject(tx.error);});}
function idbPut(t){return new Promise((resolve,reject)=>{const tx=db.transaction(STORE_NAME,'readwrite');tx.objectStore(STORE_NAME).put(t).onsuccess=()=>resolve();tx.onerror=()=>reject(tx.error);});}
function idbDelete(id){return new Promise((resolve,reject)=>{const tx=db.transaction(STORE_NAME,'readwrite');tx.objectStore(STORE_NAME).delete(id).onsuccess=()=>resolve();tx.onerror=()=>reject(tx.error);});}
function idbAll(){return new Promise((resolve,reject)=>{const tx=db.transaction(STORE_NAME,'readonly');const r=tx.objectStore(STORE_NAME).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});}

const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
function formatPnL(t){return (Number(t.sell_price||0)-Number(t.buy_price||0))*Number(t.qty||0);}
function rate(t){if(!t.buy_price) return 0; return ((Number(t.sell_price||0)/Number(t.buy_price||0))-1)*100;}
function fmtDateNoYear(s){if(!s) return ''; return s.slice(5);} function fmtNumber(n){try{return Number(n).toLocaleString('ko-KR');}catch{return String(n);}}
function fmtPrice(n){const v=Number(n||0);const f=Math.abs(v-Math.trunc(v))>1e-6;return f?v.toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2}):v.toLocaleString('ko-KR');}
function fmtMan(n){const sign=n<0?-1:1;const v=Math.floor(Math.abs(n)/1000)/10;if(v===0) return '0';return (sign<0?'-':'')+(v%1===0?v.toFixed(0):v.toFixed(1))+'만';}
function monthKeyOf(d){if(!d||d.length<7) return ''; return d.slice(0,7);} function monthLabel(k){if(!k) return '전체';const[y,m]=k.split('-');return `${y}년 ${Number(m)}월`;}

// zoom bits
function ensureZoomStyles(){if($('#zoom-style'))return;const css=`.img-zoomed{position:fixed!important;inset:0!important;background:rgba(0,0,0,.85)!important;object-fit:contain!important;width:100vw!important;height:100vh!important;z-index:9999!important;cursor:zoom-out!important}`;const s=document.createElement('style');s.id='zoom-style';s.textContent=css;document.head.appendChild(s);}
async function tryFullscreen(el){try{if(document.fullscreenElement===el||document.webkitFullscreenElement===el){if(document.exitFullscreen)await document.exitFullscreen();else if(document.webkitExitFullscreen)document.webkitExitFullscreen();return true;}else{if(el.requestFullscreen){await el.requestFullscreen();return true;}else if(el.webkitRequestFullscreen){el.webkitRequestFullscreen();return true;}}}catch(e){}return false;}
function toggleZoomFallback(el){ensureZoomStyles();el.classList.toggle('img-zoomed');}

// form helpers + cancel
function ensureCancelButton(){const form=$('#tradeForm');if(!form)return null;let cancel=$('#cancelEdit');if(!cancel){cancel=document.createElement('button');cancel.id='cancelEdit';cancel.type='button';cancel.className='btn-secondary hidden';cancel.textContent='취소';const del=$('#deleteTrade');if(del&&del.parentElement)del.insertAdjacentElement('afterend',cancel);else form.appendChild(cancel);}return cancel;}
function setEditUI(on){$('#deleteTrade')?.classList.toggle('hidden',!on);ensureCancelButton()?.classList.toggle('hidden',!on);}
function clearForm(){const form=$('#tradeForm');if(!form)return;form.reset();form.id.value='';$$('input[name="tags[]"]').forEach(ch=>ch.checked=false);$('#deleteTrade')?.classList.add('hidden');$('#cancelEdit')?.classList.add('hidden');form.querySelectorAll('input[type="file"]').forEach(inp=>{const span=inp.closest('label')?.querySelector('span.btn-secondary');if(span)span.textContent='파일 선택';});}
function fillForm(t){const form=$('#tradeForm');if(!form)return;form.id.value=t.id||'';form.date.value=t.date||'';form.symbol.value=t.symbol||'';form.qty.value=t.qty??'';form.buy_price.value=t.buy_price??'';form.sell_price.value=t.sell_price??'';form.comment.value=t.comment||'';$$('input[name="tags[]"]').forEach(ch=>ch.checked=false);if(t.tags){const set=new Set(String(t.tags).split(',').map(s=>s.trim()).filter(Boolean));$$('input[name="tags[]"]').forEach(ch=>{if(set.has(ch.value))ch.checked=true;});}['image1','image2'].forEach(k=>{const input=form.querySelector(`input[name="${k}"]`);const span=input?.closest('label')?.querySelector('span.btn-secondary');if(span)span.textContent=t[k]?'이미지 저장됨':'파일 선택';});setEditUI(true);}

// month/list/calendar (minimal)
async function populateMonthSelect(){const toolbar=$('#searchInput')?.parentElement||null;if(!toolbar)return;let m=$('#monthSelect');if(!m){m=document.createElement('select');m.id='monthSelect';m.className='input';m.style.width='7.5rem';toolbar.appendChild(m);m.addEventListener('change',renderList);}const data=await idbAll();const months=Array.from(new Set(data.map(t=>monthKeyOf(t.date)).filter(Boolean))).sort().reverse();const cur=m.value||'all';m.innerHTML='';const a=document.createElement('option');a.value='all';a.textContent='전체';m.appendChild(a);months.forEach(key=>{const o=document.createElement('option');o.value=key;o.textContent=monthLabel(key);m.appendChild(o);});if([...m.options].some(o=>o.value===cur))m.value=cur;const s=$('#searchInput');const sort=$('#sortSelect');if(s)s.style.flex='1 1 auto';if(sort)sort.style.width='7.5rem';}
async function renderList(){const q=$('#searchInput')?.value?.trim()?.toLowerCase?.()||'';const sortKey=$('#sortSelect')?.value||'date_desc';const monthKey=$('#monthSelect')?$('#monthSelect').value:'all';const data=await idbAll();let rows=data.filter(t=>{const tag=(t.tags||'').toLowerCase();const sym=(t.symbol||'').toLowerCase();const okQ=!q||tag.includes(q)||sym.includes(q);const okM=monthKey==='all'||monthKeyOf(t.date)===monthKey;return okQ&&okM;});rows.sort((a,b)=>{if(sortKey==='date_desc')return(b.date||'').localeCompare(a.date||'');if(sortKey==='date_asc')return(a.date||'').localeCompare(b.date||'');if(sortKey==='pnl_desc')return formatPnL(b)-formatPnL(a);if(sortKey==='pnl_asc')return formatPnL(a)-formatPnL(b);return 0;});const table=[`<table class="min-w-full text-sm"><thead class="text-slate-500"><tr><th class="py-2 pr-3 nowrap">날짜</th><th class="py-2 pr-3 nowrap">종목</th><th class="py-2 pr-3 nowrap text-right">수익률</th><th class="py-2 pr-3 nowrap text-right">손익</th><th class="py-2 pr-3 nowrap">태그</th></tr></thead><tbody>`];for(const t of rows){const pnl=formatPnL(t),r=rate(t);table.push(`<tr class="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" data-id="${t.id}"><td class="py-1 pr-3 nowrap">${fmtDateNoYear(t.date)}</td><td class="py-1 pr-3 nowrap">${t.symbol||''}</td><td class="py-1 pr-3 nowrap text-right">${r>=0?`<span class="pnl-pos">${r.toFixed(2)}%</span>`:`<span class="pnl-neg">${r.toFixed(2)}%</span>`}</td><td class="py-1 pr-3 nowrap text-right">${pnl>=0?`<span class="pnl-pos">${fmtNumber(Math.round(pnl))}</span>`:`<span class="pnl-neg">${fmtNumber(Math.round(pnl))}</span>`}</td><td class="py-1 pr-3 nowrap">${t.tags||''}</td></tr>`);}table.push(`</tbody></table>`);$('#listContainer').innerHTML=table.join('');$('#listContainer').querySelectorAll('tr[data-id]').forEach(tr=>{tr.addEventListener('click', async ()=>{const id=Number(tr.getAttribute('data-id'));const rec=await idbGet(id);if(rec)openDetail(rec);});});}

/* Detail modal: edit(no focus) + cancel support */
function openDetail(t){
  const pnl=formatPnL(t), r=rate(t), buyAmount=(Number(t.buy_price||0)*Number(t.qty||0));
  const html=`
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
        <button id="detailClose" type="button" class="btn-secondary">닫기</button>
        <button id="detailEdit"  type="button" class="btn-primary">편집</button>
      </div>
    </div>`;
  $('#detailContent').innerHTML=html; const modal=$('#detailModal'); modal.classList.add('show');

  ['img1','img2'].forEach(id=>{const el=document.getElementById(id); if(!el)return; el.style.cursor='zoom-in'; el.addEventListener('click', async (ev)=>{ev.stopPropagation(); const ok=await tryFullscreen(el); if(!ok) toggleZoomFallback(el);});});
  function closeDetail(){ modal.classList.remove('show'); }
  document.getElementById('detailClose')?.addEventListener('click', closeDetail);
  $('#detailModal').addEventListener('click',(e)=>{ if(e.target.id==='detailModal') closeDetail(); },{once:true});

  document.getElementById('detailEdit')?.addEventListener('click', ()=>{
    closeDetail();
    (document.querySelector('[data-tab="form"]')||document.querySelector('[data-tab="input"]'))?.click();
    fillForm(t);          // fill values
    setEditUI(true);      // show delete + cancel
    // no focus anywhere → no calendar popup
  });
}

// Calendar (short)
let calendar;
function recomputeCalendarEvents(all){const sums={};all.forEach(t=>{if(t.date)sums[t.date]=(sums[t.date]||0)+formatPnL(t);});const events=[];const dates=Object.keys(sums).sort();for(const d of dates){const val=sums[d]||0;events.push({title:fmtMan(Math.round(val)),start:d,allDay:true,color:val>=0?'#dc2626':'#2563eb',extendedProps:{kind:'daily',dateStr:d}});}if(dates.length){const min=new Date(dates[0]),max=new Date(dates[dates.length-1]);for(let cur=new Date(min);cur<=max;cur.setDate(cur.getDate()+7)){const ws=new Date(cur);ws.setDate(ws.getDate()-((ws.getDay()+6)%7));const we=new Date(ws);we.setDate(we.getDate()+6);const s=ws.toISOString().slice(0,10),e=we.toISOString().slice(0,10);let sum=0;for(const d of Object.keys(sums)) if(d>=s&&d<=e) sum+=sums[d];const sat=new Date(ws);sat.setDate(sat.getDate()+5);events.push({title:fmtMan(Math.round(sum)),start:sat.toISOString().slice(0,10),allDay:true,color:'#111827',extendedProps:{kind:'weekly',weekStart:s}});}}return events;}
async function initCalendar(){const el=document.getElementById('calendar'); if(!el||typeof FullCalendar==='undefined')return;calendar=new FullCalendar.Calendar(el,{initialView:'dayGridMonth',height:'auto',locale:'ko',dayCellDidMount:(arg)=>{const d=arg.date.getDay();if(d===0)arg.el.style.color='#dc2626';if(d===6)arg.el.style.color='#2563eb';},dateClick:async(info)=>{renderCalendarList(info.dateStr);},eventClick:async(info)=>{const ep=info.event.extendedProps||{};if(ep.kind==='daily'&&ep.dateStr)renderCalendarList(ep.dateStr);else if(ep.kind==='weekly'&&ep.weekStart)renderWeekList(ep.weekStart);}});calendar.render();await refreshCalendar();}
async function refreshCalendar(){if(!calendar)return;const all=await idbAll();const events=recomputeCalendarEvents(all);calendar.removeAllEvents();calendar.addEventSource(events);}
async function renderCalendarList(dateStr){const all=await idbAll();const rows=all.filter(t=>t.date===dateStr).sort((a,b)=>(a.created_at||'').localeCompare(b.created_at||''));const total=rows.reduce((acc,t)=>acc+formatPnL(t),0);const out=[`<div class="card"><h3 class="font-semibold">${dateStr} 매매 (합계: ${total>=0?`<span class='pnl-pos'>${fmtNumber(Math.round(total))}</span>`:`<span class='pnl-neg'>${fmtNumber(Math.round(total))}</span>`})</h3>`,`<table class="min-w-full text-sm mt-2"><thead class="text-slate-500"><tr><th class="py-1 pr-3 nowrap">종목</th><th class="py-1 pr-3 nowrap text-right">수익률</th><th class="py-1 pr-3 nowrap text-right">손익</th><th class="py-1 pr-3 nowrap">수량</th><th class="py-1 pr-3 nowrap">매수가</th><th class="py-1 pr-3 nowrap">매도가</th></tr></thead><tbody>`];for(const t of rows){const pnl=formatPnL(t),r=rate(t);out.push(`<tr class="border-t border-slate-100"><td class="py-1 pr-3 nowrap"><button class="link-symbol underline" data-id="${t.id}">${t.symbol}</button></td><td class="py-1 pr-3 nowrap text-right">${r>=0?`<span class="pnl-pos">${r.toFixed(2)}%</span>`:`<span class="pnl-neg">${r.toFixed(2)}%</span>`}</td><td class="py-1 pr-3 nowrap text-right">${pnl>=0?`<span class="pnl-pos'>${fmtNumber(Math.round(pnl))}</span>`:`<span class='pnl-neg'>${fmtNumber(Math.round(pnl))}</span>`}</td><td class="py-1 pr-3 nowrap">${fmtNumber(t.qty)}</td><td class="py-1 pr-3 nowrap">${fmtPrice(t.buy_price)}</td><td class="py-1 pr-3 nowrap">${fmtPrice(t.sell_price)}</td></tr>`);}out.push(`</tbody></table></div>`);const host=document.getElementById('calendarList');host.innerHTML=out.join('');host.querySelectorAll('.link-symbol').forEach(btn=>{btn.addEventListener('click', async ()=>{const id=Number(btn.getAttribute('data-id'));const rec=await idbGet(id);if(rec)openDetail(rec);});});}
async function renderWeekList(weekStart){const ws=new Date(weekStart),we=new Date(ws);we.setDate(we.getDate()+6);const sKey=ws.toISOString().slice(0,10),eKey=we.toISOString().slice(0,10);const all=await idbAll();const rows=all.filter(t=>t.date>=sKey&&t.date<=eKey).sort((a,b)=>(a.date||'').localeCompare(b.date||''));const total=rows.reduce((acc,t)=>acc+formatPnL(t),0);const out=[`<div class="card"><h3 class="font-semibold">${sKey} ~ ${eKey} 주간 매매 (합계: ${total>=0?`<span class='pnl-pos'>${fmtNumber(Math.round(total))}</span>`:`<span class='pnl-neg'>${fmtNumber(Math.round(total))}</span>`})</h3>`,`<table class="min-w-full text-sm mt-2"><thead class="text-slate-500"><tr><th class="py-1 pr-3 nowrap">날짜</th><th class="py-1 pr-3 nowrap">종목</th><th class="py-1 pr-3 nowrap text-right">수익률</th><th class="py-1 pr-3 nowrap text-right">손익</th><th class="py-1 pr-3 nowrap">수량</th><th class="py-1 pr-3 nowrap">매수가</th><th class="py-1 pr-3 nowrap">매도가</th></tr></thead><tbody>`];for(const t of rows){const pnl=formatPnL(t),r=rate(t);out.push(`<tr class="border-t border-slate-100"><td class="py-1 pr-3 nowrap">${fmtDateNoYear(t.date)}</td><td class="py-1 pr-3 nowrap"><button class="link-symbol underline" data-id="${t.id}">${t.symbol}</button></td><td class="py-1 pr-3 nowrap text-right">${r>=0?`<span class="pnl-pos">${r.toFixed(2)}%</span>`:`<span class="pnl-neg">${r.toFixed(2)}%</span>`}</td><td class="py-1 pr-3 nowrap text-right">${pnl>=0?`<span class="pnl-pos'>${fmtNumber(Math.round(pnl))}</span>`:`<span class='pnl-neg'>${fmtNumber(Math.round(pnl))}</span>`}</td><td class="py-1 pr-3 nowrap">${fmtNumber(t.qty)}</td><td class="py-1 pr-3 nowrap">${fmtPrice(t.buy_price)}</td><td class="py-1 pr-3 nowrap">${fmtPrice(t.sell_price)}</td></tr>`);}out.push(`</tbody></table></div>`);const host=document.getElementById('calendarList');host.innerHTML=out.join('');host.querySelectorAll('.link-symbol').forEach(btn=>{btn.addEventListener('click', async ()=>{const id=Number(btn.getAttribute('data-id'));const rec=await idbGet(id);if(rec)openDetail(rec);});});}

// tabs/import/export/init
function switchTab(name){$$('.card').forEach(sec=>sec.classList.add('hidden'));document.getElementById('tab-'+name)?.classList.remove('hidden');$$('.tab-btn').forEach(btn=>btn.classList.remove('tab-active'));document.querySelector(`[data-tab="${name}"]`)?.classList.add('tab-active');if(name==='calendar')refreshCalendar();if(name==='list')renderList();}
async function exportJSON(){const data=await idbAll();const blob=new Blob([JSON.stringify({version:1,trades:data},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='trades_export.json';a.click();URL.revokeObjectURL(url);}
async function importJSON(file){const text=await file.text();const obj=JSON.parse(text);if(!obj||!Array.isArray(obj.trades))return;for(const t of obj.trades){delete t.id;await idbAdd(t);}await populateMonthSelect();await renderList();await refreshCalendar();alert('가져오기 완료');}

(async function init(){
  await openDB();
  $$('.tab-btn').forEach(btn=>btn.addEventListener('click', ()=>switchTab(btn.dataset.tab)));
  switchTab('list');
  await populateMonthSelect();

  const form=$('#tradeForm');
  ['image1','image2'].forEach(name=>{const input=form?.querySelector(`input[name="${name}"]`); if(!input)return; const span=input.closest('label')?.querySelector('span.btn-secondary'); input.addEventListener('change',()=>{const f=input.files&&input.files[0]; if(span) span.textContent = f?f.name:'파일 선택';});});
  $('#searchInput')?.addEventListener('input', renderList);
  $('#sortSelect')?.addEventListener('change', renderList);
  $('#exportBtn')?.addEventListener('click', exportJSON);
  $('#importInput')?.addEventListener('change',(e)=>{if(e.target.files&&e.target.files[0])importJSON(e.target.files[0]);});

  $('#tradeForm')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const f=e.target;
    let prev=null; const editId=f.id.value?Number(f.id.value):null; if(editId) prev=await idbGet(editId);
    const img1=(f.image1.files&&f.image1.files[0])?await compressFileToDataURL(f.image1.files[0],{maxSide:2000,quality:0.85}):(prev?prev.image1:null);
    const img2=(f.image2.files&&f.image2.files[0])?await compressFileToDataURL(f.image2.files[0],{maxSide:2000,quality:0.85}):(prev?prev.image2:null);
    const tags=Array.from(document.querySelectorAll('input[name="tags[]"]:checked')).map(x=>x.value).join(',');
    const payload={id:editId||undefined,date:f.date.value,symbol:f.symbol.value.trim(),qty:Number(f.qty.value||0),buy_price:Number(f.buy_price.value||0),sell_price:Number(f.sell_price.value||0),tags,comment:f.comment.value,image1:img1,image2:img2,created_at:prev?prev.created_at:new Date().toISOString()};
    if(payload.id){await idbPut(payload);alert('수정 완료');} else {await idbAdd(payload);alert('저장 완료');}
    clearForm(); await populateMonthSelect(); await renderList(); await refreshCalendar(); switchTab('list');
  });
  $('#resetForm')?.addEventListener('click', clearForm);
  $('#deleteTrade')?.addEventListener('click', async ()=>{const id=Number($('#tradeForm')?.id?.value); if(id&&confirm('이 거래를 삭제할까요?')){await idbDelete(id); clearForm(); await populateMonthSelect(); await renderList(); await refreshCalendar(); switchTab('list');}});
  ensureCancelButton()?.addEventListener('click', ()=>{ clearForm(); switchTab('list'); });

  await initCalendar(); await renderList();
  console.log('Trading Journal JS loaded: v6.1d');
})();

// simple image compression (same profile)
function readFileAsImage(file){return new Promise((resolve,reject)=>{const url=URL.createObjectURL(file);const img=new Image();img.onload=()=>{URL.revokeObjectURL(url);resolve(img);};img.onerror=(e)=>{URL.revokeObjectURL(url);reject(e);};img.src=url;});}
function canvasToDataURL(canvas,mime='image/jpeg',quality=0.85){try{return canvas.toDataURL(mime,quality);}catch{return canvas.toDataURL();}}
async function compressFileToDataURL(file,{maxSide=2000,quality=0.85}={}){if(!file)return null;if(file.size&&file.size<200*1024){return await new Promise((resolve)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(file);});}let img;try{img=await readFileAsImage(file);}catch{return await new Promise((resolve)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(file);});}const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;const scale=Math.min(1,maxSide/Math.max(w,h));const outW=Math.max(1,Math.round(w*scale)),outH=Math.max(1,Math.round(h*scale));const canvas=document.createElement('canvas');canvas.width=outW;canvas.height=outH;const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(img,0,0,outW,outH);return canvasToDataURL(canvas,'image/jpeg',quality);}
