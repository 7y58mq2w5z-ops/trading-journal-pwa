/* Trading Journal - v6.1 (focus removed + cancel button only)
 * Only changes:
 * 1) When entering edit mode, do not focus date field (avoid calendar popup)
 * 2) Add cancel button below delete button, visible only in edit mode
 */

const DB_NAME = 'journal-db'; const STORE_NAME = 'trades'; let db;
function openDB() { return new Promise((resolve,reject)=>{
  const req = indexedDB.open(DB_NAME,1);
  req.onupgradeneeded = (e)=>{ const db=e.target.result; if(!db.objectStoreNames.contains(STORE_NAME)){ db.createObjectStore(STORE_NAME,{keyPath:'id',autoIncrement:true}); } };
  req.onsuccess=()=>{ db=req.result; resolve(db); }; req.onerror=()=>reject(req.error);
});}

const $=s=>document.querySelector(s);

function ensureCancelButton(){
  const form=$('#tradeForm');
  if(!form)return null;
  let cancel=$('#cancelEdit');
  if(!cancel){
    cancel=document.createElement('button');
    cancel.id='cancelEdit'; cancel.type='button';
    cancel.textContent='취소';
    cancel.className='btn-secondary hidden';
    const del=$('#deleteTrade');
    if(del) del.insertAdjacentElement('afterend', cancel);
    else form.appendChild(cancel);
  }
  return cancel;
}

function setEditUI(on){
  $('#deleteTrade')?.classList.toggle('hidden',!on);
  ensureCancelButton()?.classList.toggle('hidden',!on);
}

function clearForm(){
  const form=$('#tradeForm');
  if(!form)return;
  form.reset();
  form.id.value='';
  $('#deleteTrade')?.classList.add('hidden');
  $('#cancelEdit')?.classList.add('hidden');
}

function fillForm(t){
  const form=$('#tradeForm');
  if(!form)return;
  form.id.value=t.id||'';
  form.date.value=t.date||'';
  form.symbol.value=t.symbol||'';
  form.qty.value=t.qty||'';
  form.buy_price.value=t.buy_price||'';
  form.sell_price.value=t.sell_price||'';
  form.comment.value=t.comment||'';
  setEditUI(true);
}

document.addEventListener('DOMContentLoaded',async()=>{
  await openDB();
  ensureCancelButton()?.addEventListener('click', ()=>{ clearForm(); alert('취소되었습니다'); });
  console.log('Loaded app_v6_1_focus_cancel.js');
});
