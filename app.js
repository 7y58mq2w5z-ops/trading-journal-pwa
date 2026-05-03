// ---------- (1) 데이터베이스 설정 (IndexedDB) ----------
const DB_NAME = 'TradingJournalProDB';
const DB_VERSION = 2;
const STORE_NAME = 'trades';
let db;

/**
 * DB 오픈 및 초기화: 원본의 안정적인 에러 핸들링 유지
 */
export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };

    request.onerror = (e) => {
      console.error('DB Open Error:', e.target.error);
      reject(e.target.error);
    };
  });
}

// 공통 IDB 트랜잭션 유틸리티
const idb = {
  add: (item) => db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).add(item),
  put: (item) => db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(item),
  delete: (id) => db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id),
  getAll: () => new Promise((res) => {
    const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    req.onsuccess = () => res(req.result);
  }),
  get: (id) => new Promise((res) => {
    const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
    req.onsuccess = () => res(req.result);
  })
};

// ---------- (2) 이미지 압축 및 처리 (원본 로직 복구) ----------

/**
 * 원본의 938줄 코드에서 가장 핵심이었던 캔버스 압축 로직입니다.
 * 고용량 사진 업로드 시 DB 용량 초과를 방지합니다.
 */
async function compressImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // 최대 해상도 제한 (가로 기준 1200px)
        const MAX_WIDTH = 1200;
        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // JPEG 0.7 압축률로 변환
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
    };
  });
}

// ---------- (3) 수익률 및 데이터 계산 유틸리티 ----------

/**
 * 수정사항 1번 반영: 실현손익 직접 입력 기반 수익률 계산
 * 공식: (실현손익 / (매수가 * 수량)) * 100
 */
function calculateYield(trade) {
  const buyPrice = parseFloat(trade.buy_price || 0);
  const qty = parseFloat(trade.qty || 0);
  const pnl = parseFloat(trade.pnl_input || 0);
  
  const totalBuy = buyPrice * qty;
  if (totalBuy === 0) return 0;
  
  return (pnl / totalBuy) * 100;
}

// 천단위 콤마 포맷
function formatKrw(val) {
  return Math.round(val).toLocaleString('ko-KR');
}
// ---------- (4) 리스트 렌더링 (요청사항 1번 수익률 반영) ----------

async function renderList() {
  const listContainer = document.getElementById('listContainer');
  const allTrades = await idb.getAll();
  
  // 최신순 정렬
  allTrades.sort((a, b) => new Date(b.date) - new Date(a.date));

  if (allTrades.length === 0) {
    listContainer.innerHTML = `<div class="text-center py-10 text-slate-400 text-sm">기록된 매매가 없습니다.</div>`;
    return;
  }

  let html = '';
  allTrades.forEach(t => {
    const pnl = parseFloat(t.pnl_input || 0);
    const yieldRate = calculateYield(t);
    
    // 수정사항 3번과 통일감을 위해 리스트 한 줄 디자인 적용
    html += `
      <div class="list-row-single bg-white rounded-2xl shadow-sm border border-slate-50 mb-2 cursor-pointer" onclick="openDetail(${t.id})">
        <div class="flex items-center gap-3 overflow-hidden">
          <span class="text-[11px] font-bold text-slate-300 w-10">${t.date.slice(5)}</span>
          <span class="font-bold text-slate-800 truncate">${t.symbol}</span>
        </div>
        <div class="flex items-center gap-4">
          <span class="text-xs font-bold ${yieldRate >= 0 ? 'pnl-pos' : 'pnl-neg'}">${yieldRate.toFixed(2)}%</span>
          <span class="text-sm font-black w-20 text-right ${pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}">${formatKrw(pnl)}</span>
        </div>
      </div>
    `;
  });

  listContainer.innerHTML = html;
  // 차트 업데이트 (파트 5에서 구현)
  if (window.updateChart) window.updateChart(allTrades);
}

// ---------- (5) 상세 정보 모달 (수정사항 2번 반영) ----------

window.openDetail = async (id) => {
  const t = await idb.get(id);
  if (!t) return;

  const pnl = parseFloat(t.pnl_input || 0);
  const yieldRate = calculateYield(t);
  
  // 수정사항 2번: 해당 날짜의 일자별 메모 가져오기 (localStorage 활용)
  const dailyNote = localStorage.getItem(`note_${t.date}`) || "기록된 일자 메모가 없습니다.";

  const content = document.getElementById('detailContent');
  content.innerHTML = `
    <div class="space-y-6">
      <!-- 헤더: 종목 및 핵심 지표 -->
      <div class="flex justify-between items-end border-b border-slate-100 pb-4">
        <div>
          <h2 class="text-2xl font-black text-slate-900">${t.symbol}</h2>
          <p class="text-sm text-slate-400 font-bold">${t.date}</p>
        </div>
        <div class="text-right">
          <div class="text-xl font-black ${pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}">${formatKrw(pnl)}원</div>
          <div class="text-sm font-bold ${yieldRate >= 0 ? 'pnl-pos' : 'pnl-neg'}">${yieldRate.toFixed(2)}%</div>
        </div>
      </div>

      <!-- 매매 코멘트 -->
      <div class="bg-slate-50 p-4 rounded-2xl">
        <h4 class="text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">Trade Comment</h4>
        <p class="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">${t.comment || '코멘트 없음'}</p>
      </div>

      <!-- 매매 사진 (수평 나열) -->
      ${(t.image1 || t.image2) ? `
        <div class="detail-img-grid">
          ${t.image1 ? `<img src="${t.image1}" class="detail-img-item" onclick="viewFullscreen(this.src)">` : ''}
          ${t.image2 ? `<img src="${t.image2}" class="detail-img-item" onclick="viewFullscreen(this.src)">` : ''}
        </div>
      ` : ''}

      <!-- 수정사항 2번: 일자별 메모 및 날짜 강조 표시 -->
      <div class="mt-8 pt-6 border-t-2 border-dashed border-slate-100">
        <div class="flex items-center gap-2 mb-3">
          <span class="bg-slate-900 text-white text-[10px] font-black px-2 py-1 rounded">DAILY LOG</span>
          <span class="text-xs font-bold text-slate-400">${t.date} 통합 메모</span>
        </div>
        <div class="bg-amber-50/50 border border-amber-100 p-4 rounded-2xl">
          <p class="text-sm text-slate-600 leading-relaxed italic">"${dailyNote}"</p>
        </div>
      </div>

      <!-- 제어 버튼 -->
      <div class="flex gap-2 pt-4">
        <button onclick="editTrade(${t.id})" class="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold text-sm">수정하기</button>
        <button onclick="closeDetail()" class="flex-1 bg-slate-900 text-white py-3 rounded-xl font-bold text-sm">닫기</button>
      </div>
    </div>
  `;

  document.getElementById('detailModal').classList.add('show');
};

window.closeDetail = () => {
  document.getElementById('detailModal').classList.remove('show');
};

window.viewFullscreen = (src) => {
  // 전체화면 뷰어 로직 (파트 1의 HTML 구조 활용)
  const viewer = document.createElement('div');
  viewer.className = 'fixed inset-0 bg-black z-[200] flex items-center justify-center p-4 cursor-zoom-out';
  viewer.innerHTML = `<img src="${src}" class="max-w-full max-h-full object-contain shadow-2xl">`;
  viewer.onclick = () => document.body.removeChild(viewer);
  document.body.appendChild(viewer);
};
// ---------- (6) 캘린더 초기화 및 이벤트 렌더링 ----------

let calendar;

async function initCalendar() {
  const calendarEl = document.getElementById('calendar');
  if (!calendarEl) return;

  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    locale: 'ko',
    height: 'auto',
    headerToolbar: { left: 'prev', center: 'title', right: 'next' },
    dayMaxEvents: true,
    
    // 날짜 클릭 시 하단 상세 영역 표시 (기능 복구)
    dateClick: (info) => {
      showDailyDetail(info.dateStr);
    },

    // 이벤트 데이터 생성
    events: async (info, successCallback, failureCallback) => {
      try {
        const trades = await idb.getAll();
        const events = [];
        const dailySums = {};

        trades.forEach(t => {
          const pnl = parseFloat(t.pnl_input || 0);
          // 1. 평일 종목별 손익 (글자색만 변경 - 수정사항 3번)
          events.push({
            title: `${t.symbol} ${formatKrw(pnl)}`,
            start: t.date,
            className: pnl >= 0 ? 'pnl-plus-text' : 'pnl-minus-text',
            display: 'list-item' 
          });

          // 주간 합계를 위한 일별 합산 데이터 생성
          dailySums[t.date] = (dailySums[t.date] || 0) + pnl;
        });

        // 2. 토요일 주간 합계 계산 및 표시 (음영 적용 - 수정사항 3번)
        const weeklyTotals = {};
        Object.keys(dailySums).forEach(dateStr => {
          const date = new Date(dateStr);
          const day = date.getDay(); // 0(일)~6(토)
          
          // 해당 날짜가 속한 주의 토요일 날짜 구하기
          const sat = new Date(date);
          sat.setDate(date.getDate() + (6 - day));
          const satStr = sat.toISOString().split('T')[0];
          
          weeklyTotals[satStr] = (weeklyTotals[satStr] || 0) + dailySums[dateStr];
        });

        Object.keys(weeklyTotals).forEach(satStr => {
          const sum = weeklyTotals[satStr];
          events.push({
            title: `주간합계: ${formatKrw(sum)}`,
            start: satStr,
            allDay: true,
            // 수정사항 3번: 수익/손실에 따른 배경색 음영 및 흰색 글자
            className: sum >= 0 ? 'weekly-sum-plus' : 'weekly-sum-minus',
            display: 'block'
          });
        });

        successCallback(events);
      } catch (err) {
        failureCallback(err);
      }
    }
  });

  calendar.render();
}

// ---------- (7) 캘린더 하단 일자별 상세 표시 (기능 복구) ----------

async function showDailyDetail(dateStr) {
  const detailArea = document.getElementById('calendarDetailArea');
  const listContainer = document.getElementById('dailyTradeList');
  const noteDisplay = document.getElementById('dailyNoteDisplay');
  const title = document.getElementById('selectedDateTitle');

  const trades = (await idb.getAll()).filter(t => t.date === dateStr);
  const note = localStorage.getItem(`note_${dateStr}`) || "작성된 메모가 없습니다.";

  detailArea.classList.remove('hidden');
  title.innerText = `${dateStr} 매매 내역`;
  noteDisplay.innerText = note;

  // 해당 일자 종목 리스트 렌더링
  if (trades.length === 0) {
    listContainer.innerHTML = `<p class="text-xs text-slate-400">매매 기록이 없습니다.</p>`;
  } else {
    listContainer.innerHTML = trades.map(t => {
      const pnl = parseFloat(t.pnl_input || 0);
      return `
        <div class="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100 cursor-pointer" onclick="openDetail(${t.id})">
          <span class="text-sm font-bold text-slate-700">${t.symbol}</span>
          <span class="text-sm font-black ${pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}">${formatKrw(pnl)}</span>
        </div>
      `;
    }).join('');
  }

  // 메모 작성 버튼 연동
  document.getElementById('addDailyNoteBtn').onclick = () => {
    const noteModal = document.getElementById('noteModal');
    const noteText = document.getElementById('noteText');
    noteText.value = localStorage.getItem(`note_${dateStr}`) || "";
    noteModal.classList.add('show');

    document.getElementById('saveNoteBtn').onclick = () => {
      localStorage.setItem(`note_${dateStr}`, noteText.value);
      noteModal.classList.remove('show');
      showDailyDetail(dateStr); // 즉시 갱신
      if(calendar) calendar.refetchEvents(); // 캘린더 메모 영향 있을 수 있으니 갱신
    };
  };
}
// ---------- (8) 폼 제출 및 데이터 저장 (이미지 압축 연동) ----------

const tradeForm = document.getElementById('tradeForm');

tradeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const saveBtn = document.getElementById('saveBtn');
  saveBtn.disabled = true;
  saveBtn.innerText = '저장 중...';

  const formData = new FormData(tradeForm);
  const id = formData.get('id');
  
  const tradeData = {
    date: formData.get('date'),
    symbol: formData.get('symbol'),
    qty: parseFloat(formData.get('qty') || 0),
    buy_price: parseFloat(formData.get('buy_price') || 0),
    pnl_input: parseFloat(formData.get('pnl_input') || 0), // 직접 입력값
    comment: formData.get('comment'),
    updated_at: new Date().toISOString()
  };

  try {
    // 이미지 처리 (파트 2의 compressImage 로직 활용)
    const img1File = tradeForm.image1.files[0];
    const img2File = tradeForm.image2.files[0];

    if (img1File) tradeData.image1 = await compressImage(img1File);
    if (img2File) tradeData.image2 = await compressImage(img2File);

    if (id) {
      // 수정 모드: 기존 이미지 유지 로직
      const existing = await idb.get(Number(id));
      tradeData.id = Number(id);
      if (!tradeData.image1) tradeData.image1 = existing.image1;
      if (!tradeData.image2) tradeData.image2 = existing.image2;
      await idb.put(tradeData);
    } else {
      // 신규 등록
      tradeData.created_at = new Date().toISOString();
      await idb.add(tradeData);
    }

    alert('매매 일지가 저장되었습니다.');
    location.reload(); // 데이터 정합성을 위해 새로고침
  } catch (err) {
    console.error(err);
    alert('저장 중 오류가 발생했습니다.');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerText = 'SAVE TRADE';
  }
});

// ---------- (9) 수정 및 삭제 기능 ----------

window.editTrade = async (id) => {
  const t = await idb.get(id);
  if (!t) return;

  const f = tradeForm;
  f.id.value = t.id;
  f.date.value = t.date;
  f.symbol.value = t.symbol;
  f.qty.value = t.qty;
  f.buy_price.value = t.buy_price;
  f.pnl_input.value = t.pnl_input;
  f.comment.value = t.comment;

  document.getElementById('saveBtn').innerText = '수정 완료';
  document.getElementById('deleteTrade').classList.remove('hidden');
  document.getElementById('detailModal').classList.remove('show');
  switchTab('form');
};

document.getElementById('deleteTrade').onclick = async () => {
  const id = document.getElementById('tradeForm').id.value;
  if (confirm('정말로 이 매매 기록을 삭제하시겠습니까?') && id) {
    await idb.delete(Number(id));
    location.reload();
  }
};

// ---------- (10) PnL 차트 시각화 (Chart.js) ----------

let pnlChart;
window.updateChart = (data) => {
  const ctx = document.getElementById('pnlChart').getContext('2d');
  const sortedData = [...data].sort((a, b) => new Date(a.date) - new Date(b.date));
  
  // 누적 수익 계산
  let cumulativePnl = 0;
  const labels = sortedData.map(d => d.date.slice(5));
  const chartData = sortedData.map(d => {
    cumulativePnl += parseFloat(d.pnl_input || 0);
    return cumulativePnl;
  });

  if (pnlChart) pnlChart.destroy();
  pnlChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: '누적 수익 현황',
        data: chartData,
        borderColor: '#1e293b',
        backgroundColor: 'rgba(30, 41, 59, 0.05)',
        fill: true,
        tension: 0.4,
        borderWidth: 3,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { position: 'right', grid: { color: '#f1f5f9' } }
      }
    }
  });
};

// ---------- (11) 앱 초기화 및 탭 전환 ----------

function switchTab(tabId) {
  document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
  document.getElementById(`tab-${tabId}`).classList.remove('hidden');

  document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.dataset.tab === tabId) {
      btn.classList.replace('bg-slate-100', 'bg-slate-900');
      btn.classList.replace('text-slate-400', 'text-white');
      btn.classList.add('shadow-lg');
    } else {
      btn.classList.replace('bg-slate-900', 'bg-slate-100');
      btn.classList.replace('text-white', 'text-slate-400');
      btn.classList.remove('shadow-lg');
    }
  });

  if (tabId === 'calendar' && calendar) {
    calendar.render(); // 캘린더 크기 재조정
  }
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.onclick = () => switchTab(btn.dataset.tab);
});

document.getElementById('cancelBtn').onclick = () => location.reload();
document.getElementById('closeNoteBtn').onclick = () => document.getElementById('noteModal').classList.remove('show');

window.onload = async () => {
  try {
    await openDB();
    await renderList();
    await initCalendar();
    
    // URL 파라미터 체크 (특정 날짜로 바로 이동 등 확장성용)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('tab')) switchTab(urlParams.get('tab'));
    
  } catch (err) {
    console.error("초기화 실패:", err);
  }
};
