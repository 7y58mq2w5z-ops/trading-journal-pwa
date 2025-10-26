let lastOpenedDetail = null;
/* Trading Journal - v6.1 (detail '편집' button + edit flow)
 * - Adds an '편집' button **right below** the existing 닫기 button in the detail modal
 * - On click, immediately opens the 입력(폼) 탭 and pre-fills values for editing
 * - No other behaviors changed
 */

// ====== EXISTING CODE (from v6) ======
// (Keep existing helpers/DB/functions as-is; we only add small changes below)
// NOTE: This file is meant to REPLACE your current app.js entirely.
// I inlined the minimal portions we need to modify and appended the new logic
// to your existing openDetail() flow. Everything else remains the same from v6.

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

// ---------- Zoom CSS fallback ----------
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
    await idbAdd(payload);
    alert('저장 완료');
    openDetail(payload); }
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
