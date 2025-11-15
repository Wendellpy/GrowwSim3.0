// app.js - single module handling state, UI, charts
import { TIMEFRAMES, stocks, funds, latestPriceTF, rupee, pct, randomWalkUpdate, sensexSeries } from './data.js';

// ------- State -------
const DEFAULT_BALANCE = 100000; // ₹1,00,000
const STORAGE_KEY = 'growwSimStateV1';
const AUTH_KEY = 'growwSimAuthV1';

const State = {
  balance: DEFAULT_BALANCE,
  holdings: { /* stockId: { qty, avg } */ },
  mfHoldings: { /* fundId: { units, avg } */ },
  sips: [ /* { id, fundId, amount, startedAt } */ ],
  transactions: [ /* { ts, type, assetType, id, name, qty, units, price, nav, amount } */ ],
  watchlist: [],
  stockTF: '1D',
  liveEnabled: false,
  finnhubKey: '',
  sipChartType: 'line',
};

const Auth = {
  users: [], // { name, email, password }
  currentUser: null,
};

function loadState(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(!raw){
    saveState();
    return {...State};
  }
  try { return JSON.parse(raw); } catch(e){ return {...State}; }
}

function loadAuth(){
  const raw = localStorage.getItem(AUTH_KEY);
  if(!raw) return {...Auth};
  try { return JSON.parse(raw); } catch(e){ return {...Auth}; }
}

function renderWatchlist(){
  const listEl = document.getElementById('watchlistList');
  const emptyEl = document.getElementById('watchlistEmpty');
  if(!listEl) return;
  listEl.innerHTML = '';
  const ids = State.watchlist || [];
  if(emptyEl) emptyEl.classList.toggle('hidden', ids.length>0);
  const labels = Array.from({length: 30}, (_,i)=> i+1);
  for(const id of ids){
    const s = stocks.find(x=>x.id===id);
    if(!s) continue;
    const card = document.createElement('div');
    card.className = 'card p-4 hover:shadow-md transition';
    card.innerHTML = `
      <div class="flex items-start justify-between">
        <div>
          <div class="font-semibold">${s.name}</div>
          <div class="text-sm text-neutral-500">${s.id}</div>
        </div>
        <div class="text-right">
          <div class="font-semibold" id="price-watch-${s.id}">${rupee(latestPriceTF(s, State.stockTF))}</div>
          <div class="text-xs ${s.change>=0?'up':'down'}" id="chg-watch-${s.id}">${pct(s.change)}</div>
        </div>
      </div>
      <div class="h-20 mt-3"><canvas id="chart-watch-${s.id}"></canvas></div>
      <div class="mt-3 flex gap-2">
        <button class="btn btn-ghost" data-star="${s.id}">★</button>
        <button class="btn btn-primary" data-act="buy" data-id="${s.id}"><i class="fa-solid fa-plus"></i> Buy</button>
        <button class="btn btn-ghost" data-act="sell" data-id="${s.id}"><i class="fa-solid fa-minus"></i> Sell</button>
      </div>
    `;
    listEl.appendChild(card);
    const ctx = card.querySelector('canvas').getContext('2d');
    const key = `watch-${s.id}`;
    charts.get(key)?.destroy();
    charts.set(key, makeLineChart(ctx, labels, s.tf[State.stockTF]));
    card.querySelectorAll('button[data-act]')
      .forEach(btn => btn.addEventListener('click', () => onStockAction(btn.dataset.act, s.id)));
    const star = card.querySelector('button[data-star]');
    if(star){
      star.textContent = '★';
      star.classList.add('up');
      star.addEventListener('click', () => {
        const set = new Set(State.watchlist||[]);
        set.delete(s.id);
        State.watchlist = Array.from(set);
        saveState();
        renderWatchlist();
        renderStocks();
        showToast('Removed from Watchlist');
      });
    }
  }
}
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(State)); }

function saveAuth(){ localStorage.setItem(AUTH_KEY, JSON.stringify(Auth)); }

Object.assign(State, loadState());
Object.assign(Auth, loadAuth());

if(!(Auth.users instanceof Array)) Auth.users = [];
if(!Auth.users.find(u => u.email === 'demo')){
  Auth.users.push({ name: 'Demo User', email: 'demo', password: 'demo123' });
  saveAuth();
}

// ------- Utils -------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const round3 = (x) => Math.round((x + Number.EPSILON) * 1000) / 1000;
const MF_DUST = 0.01; // hide and auto-clear tiny residual MF units
const timeAgoShort = (t) => {
  if(!t) return '';
  const s = Math.max(0, Math.floor((Date.now()-t)/1000));
  if(s<2) return 'just now';
  if(s<60) return `${s}s ago`;
  const m = Math.floor(s/60);
  return `${m}m ago`;
};

function setText(id, txt){ const el = typeof id === 'string' ? document.getElementById(id) : id; if(el) el.textContent = txt; }

// ------- Tabs -------
function setupTabs(){
  const tabs = $$('#nav-tabs .tab');
  const mobileWrap = $('#mobile-tabs');
  tabs.forEach(t => {
    const clone = t.cloneNode(true);
    clone.classList.remove('tab-active');
    mobileWrap.appendChild(clone);
  });
  const allTabs = [...tabs, ...$$('#mobile-tabs .tab')];
  allTabs.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.target)));
}

function switchTab(id){
  if(!Auth.currentUser && id !== 'auth'){
    showToast('Please login first', 'error');
    id = 'auth';
  }
  const header = document.getElementById('mainHeader');
  if(header){
    const hideHeader = !Auth.currentUser && id === 'auth';
    header.classList.toggle('hidden', hideHeader);
  }
  $$('#nav-tabs .tab, #mobile-tabs .tab').forEach(b => b.classList.toggle('tab-active', b.dataset.target === id));
  $$('main > section').forEach(sec => sec.classList.toggle('hidden', sec.id !== id));
}

$('#mobileMenuBtn')?.addEventListener('click', () => {
  $('#mobileMenu')?.classList.toggle('hidden');
});

const liveBtn = document.getElementById('liveToggle');
const keyInput = document.getElementById('finnhubKey');
if(liveBtn){
  const syncLiveUI = () => {
    liveBtn.classList.toggle('tab-active', !!State.liveEnabled);
    if(keyInput) keyInput.value = State.finnhubKey || '';
  };
  liveBtn.addEventListener('click', () => { State.liveEnabled = !State.liveEnabled; saveState(); syncLiveUI(); });
  if(keyInput){ keyInput.addEventListener('change', () => { State.finnhubKey = keyInput.value.trim(); saveState(); }); }
  syncLiveUI();
}
const userMenuWrap = document.getElementById('userMenuWrap');
const userMenuBtn = document.getElementById('userMenuBtn');
const userMenu = document.getElementById('userMenu');
const userLogout = document.getElementById('userLogout');
const userSettings = document.getElementById('userSettings');
const userGreeting = document.getElementById('userGreeting');
const userAvatar = document.getElementById('userAvatar');

function refreshUserUI(){
  const loggedIn = !!Auth.currentUser;
  if(userMenuWrap){ userMenuWrap.classList.toggle('hidden', !loggedIn); }
  if(userGreeting && Auth.currentUser){
    const name = Auth.currentUser.name || Auth.currentUser.email || 'User';
    userGreeting.textContent = `Hi, ${name.split(' ')[0]}`;
  }
  if(userAvatar && Auth.currentUser){
    const name = Auth.currentUser.name || Auth.currentUser.email || 'U';
    userAvatar.textContent = (name.trim()[0] || 'U').toUpperCase();
  }
}

if(userMenuBtn && userMenu){
  userMenuBtn.addEventListener('click', () => {
    userMenu.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if(!userMenuWrap) return;
    if(!userMenuWrap.contains(e.target)){ userMenu?.classList.add('hidden'); }
  });
}

if(userLogout){
  userLogout.addEventListener('click', () => {
    Auth.currentUser = null;
    saveAuth();
    showToast('Logged out', 'info');
    refreshUserUI();
    switchTab('auth');
  });
}

if(userSettings){
  userSettings.addEventListener('click', () => {
    openModal({
      title: 'Add Money',
      bodyHTML: `
        <label class="text-sm">Amount to add (₹)</label>
        <input id="addMoneyInput" type="number" class="mt-1 w-full card px-3 py-2" value="10000" min="1" />
        <div class="mt-2 flex gap-2 text-xs">
          <button type="button" class="chip btn-ghost" data-add-preset="10000">+10k</button>
          <button type="button" class="chip btn-ghost" data-add-preset="50000">+50k</button>
          <button type="button" class="chip btn-ghost" data-add-preset="100000">+1L</button>
        </div>
      `,
      onOpen: () => {
        const input = document.getElementById('addMoneyInput');
        document.querySelectorAll('[data-add-preset]').forEach(btn => {
          btn.addEventListener('click', () => {
            const v = parseInt(btn.getAttribute('data-add-preset') || '0');
            if(!input) return;
            input.value = String(v);
          });
        });
      },
      onConfirm: () => {
        const el = document.getElementById('addMoneyInput');
        const amt = el ? parseInt(el.value) : 0;
        if(!amt || amt<=0){ showToast('Enter a valid amount', 'error'); return false; }
        State.balance += amt;
        saveState();
        refreshTopline();
        showToast(`Added ${rupee(amt)} to balance`, 'success');
      }
    });
  });
}

const resetBtn = document.getElementById('resetBtn');
if(resetBtn){
  resetBtn.addEventListener('click', () => {
    openModal({
      title: 'Reset Data',
      bodyHTML: '<div class="text-sm">This will clear your balance, holdings, SIPs, and live settings. Continue?</div>',
      onConfirm: () => {
        localStorage.removeItem(STORAGE_KEY);
        State.balance = DEFAULT_BALANCE;
        State.holdings = {};
        State.mfHoldings = {};
        State.sips = [];
        State.transactions = [];
        State.watchlist = [];
        State.stockTF = '1D';
        State.liveEnabled = false;
        State.finnhubKey = '';
        saveState();
        renderAll();
        showToast('Data reset', 'success');
      }
    });
  });
}

// ------- UI helpers: modal & toast -------
const modalEl = document.getElementById('modal');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const modalConfirm = document.getElementById('modalConfirm');
function openModal({ title, bodyHTML, onConfirm, onOpen }){
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHTML || '';
  modalEl.classList.remove('hidden');
  modalEl.classList.add('flex');
  const closeBtns = modalEl.querySelectorAll('[data-close]');
  const close = () => { modalEl.classList.add('hidden'); modalEl.classList.remove('flex'); };
  closeBtns.forEach(b => b.onclick = close);
  try { onOpen?.(); } catch(e){}
  modalConfirm.onclick = async () => {
    try{
      const res = await onConfirm?.();
      if(res === false) return;
      close();
    } catch(e){ close(); }
  };
}
function showToast(msg, type='info'){
  const wrap = document.getElementById('toasts');
  const d = document.createElement('div');
  d.className = `card px-3 py-2 text-sm ${type==='error' ? 'down' : type==='success' ? 'up' : ''}`;
  d.textContent = msg;
  wrap.appendChild(d);
  setTimeout(()=>{ d.remove(); }, 3000);
}

// ------- Auth handlers -------
function setupAuth(){
  const loginEmail = document.getElementById('loginEmail');
  const loginPassword = document.getElementById('loginPassword');
  const loginBtn = document.getElementById('loginBtn');
  const signupName = document.getElementById('signupName');
  const signupEmail = document.getElementById('signupEmail');
  const signupPassword = document.getElementById('signupPassword');
  const signupBtn = document.getElementById('signupBtn');

  if(loginBtn){
    loginBtn.onclick = () => {
      const email = (loginEmail?.value || '').trim().toLowerCase();
      const pwd = (loginPassword?.value || '').trim();
      if(!email || !pwd){ showToast('Enter username and password', 'error'); return; }
      const user = (Auth.users || []).find(u => u.email === email && u.password === pwd);
      if(!user){ showToast('Invalid credentials', 'error'); return; }
      Auth.currentUser = { name: user.name, email: user.email };
      saveAuth();
      showToast(`Welcome back, ${user.name || user.email}`, 'success');
      refreshUserUI();
      switchTab('dashboard');
    };
  }

  if(signupBtn){
    signupBtn.onclick = () => {
      const name = (signupName?.value || '').trim();
      const email = (signupEmail?.value || '').trim().toLowerCase();
      const pwd = (signupPassword?.value || '').trim();
      if(!name || !email || !pwd){ showToast('Fill all signup fields', 'error'); return; }
      if(!(Auth.users instanceof Array)) Auth.users = [];
      if(Auth.users.find(u => u.email === email)){ showToast('Email already registered', 'error'); return; }
      Auth.users.push({ name, email, password: pwd });
      Auth.currentUser = { name, email };
      saveAuth();
      showToast('Account created. Logged in!', 'success');
      refreshUserUI();
      switchTab('dashboard');
    };
  }
}

// ------- Charts registry -------
const charts = new Map();
function makeLineChart(ctx, labels, data, color='rgb(16 185 129)'){
  const c = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ data, borderColor: color, backgroundColor: 'rgba(16,185,129,0.12)', fill: true, tension: 0.35, pointRadius: 0 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 200 },
      scales: { x: { display:false }, y: { display:false } },
      plugins: { legend:{display:false}, tooltip:{enabled:true} }
    }
  });
  return c;
}

function openStockDetailModal(id){
  const s = stocks.find(x=>x.id===id);
  if(!s) return;
  const price = latestPriceTF(s, State.stockTF);
  const series1D = s.tf['1D'] || [];
  const series1Y = s.tf['1Y'] || [];
  const avg = (arr) => arr && arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
  const min = (arr) => arr && arr.length ? Math.min(...arr) : 0;
  const max = (arr) => arr && arr.length ? Math.max(...arr) : 0;
  const avg1D = avg(series1D);
  const avg52W = avg(series1Y);
  const dayLow = min(series1D);
  const dayHigh = max(series1D);
  const wk52Low = min(series1Y);
  const wk52High = max(series1Y);

  const holding = State.holdings[id];
  const heldQty = holding?.qty || 0;
  const heldValue = heldQty ? heldQty * price : 0;
  const heldInvested = heldQty ? heldQty * (holding?.avg || 0) : 0;
  const heldPL = heldValue - heldInvested;
  openModal({
    title: `${s.name} (${s.id})`,
    bodyHTML: `
      <div class="text-sm flex flex-col md:flex-row gap-4">
        <div class="md:w-2/3 space-y-3">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="text-xs text-neutral-500">${s.id}</div>
              <div class="text-lg font-semibold mt-0.5">${s.name}</div>
            </div>
            <div class="text-right">
              <div id="stockDetailPrice" class="text-2xl font-semibold">${rupee(price)}</div>
              <div id="stockDetailChange" class="text-xs mt-1 ${s.change>=0?'up':'down'}">${pct(s.change)} · ${State.stockTF}</div>
            </div>
          </div>
          <div class="mt-2 flex gap-2 text-xs" id="stockDetailTfGroup">
            <button class="chip btn-ghost" data-tf="1D">1D</button>
            <button class="chip btn-ghost" data-tf="1W">1W</button>
            <button class="chip btn-ghost" data-tf="1M">1M</button>
            <button class="chip btn-ghost" data-tf="1Y">1Y</button>
          </div>
          <div class="card mt-1 h-48 md:h-64 overflow-hidden">
            <canvas id="stockDetailChart"></canvas>
          </div>
        </div>

        <div class="md:w-1/3 space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <div class="card p-3">
              <div class="text-[11px] text-neutral-500">1D Average</div>
              <div class="font-medium mt-0.5">${rupee(avg1D)}</div>
            </div>
            <div class="card p-3">
              <div class="text-[11px] text-neutral-500">52W Average</div>
              <div class="font-medium mt-0.5">${rupee(avg52W)}</div>
            </div>
            <div class="card p-3">
              <div class="text-[11px] text-neutral-500">Day Low / High</div>
              <div class="mt-0.5 whitespace-nowrap">${rupee(dayLow)} – ${rupee(dayHigh)}</div>
              <input type="range" disabled class="w-full mt-1" min="${dayLow}" max="${dayHigh}" value="${price}" />
            </div>
            <div class="card p-3">
              <div class="text-[11px] text-neutral-500">52W Low / High</div>
              <div class="mt-0.5 whitespace-nowrap">${rupee(wk52Low)} – ${rupee(wk52High)}</div>
              <input type="range" disabled class="w-full mt-1" min="${wk52Low}" max="${wk52High}" value="${price}" />
            </div>
          </div>

          ${heldQty ? `
          <div class="card p-3 flex items-center justify-between">
            <div>
              <div class="text-xs text-neutral-500">Your holding</div>
              <div class="text-sm mt-0.5">Qty: ${heldQty}</div>
            </div>
            <div class="text-right text-xs">
              <div>Value: ${rupee(heldValue)}</div>
              <div class="${heldPL>=0?'up':'down'}">P/L: ${rupee(heldPL)}</div>
            </div>
          </div>
          ` : ''}

          <div class="mt-1 flex gap-2">
            <button id="detailBuy" class="btn btn-primary flex-1"><i class="fa-solid fa-plus"></i> Buy</button>
            <button id="detailSell" class="btn btn-ghost flex-1"><i class="fa-solid fa-minus"></i> Sell</button>
          </div>
        </div>
      </div>
    `,
    onOpen: () => {
      let currentTf = State.stockTF;
      const ctx = document.getElementById('stockDetailChart')?.getContext('2d');
      const priceEl = document.getElementById('stockDetailPrice');
      const changeEl = document.getElementById('stockDetailChange');
      const tfGroup = document.getElementById('stockDetailTfGroup');

      const key = `stock-modal-${id}`;
      let chart = charts.get(key);
      if(chart){ chart.destroy(); charts.delete(key); chart = null; }

      function renderForTf(tf){
        currentTf = tf;
        const seriesFull = s.tf[tf] || [];
        const series = seriesFull.slice(-30);
        const labels = Array.from({length: series.length || 30}, (_,i)=> i+1);
        const lastPrice = latestPriceTF(s, tf);
        const first = series[0] ?? lastPrice;
        const chgPct = first ? ((lastPrice - first)/first)*100 : 0;

        if(priceEl) priceEl.textContent = rupee(lastPrice);
        if(changeEl){
          changeEl.textContent = `${chgPct>=0?'+':''}${chgPct.toFixed(2)}% · ${tf}`;
          changeEl.classList.toggle('up', chgPct>=0);
          changeEl.classList.toggle('down', chgPct<0);
        }

        if(ctx){
          if(chart){
            chart.data.labels = labels;
            chart.data.datasets[0].data = series;
            chart._tf = tf;
            chart.update('none');
          } else {
            chart = makeLineChart(ctx, labels, series);
            chart._tf = tf;
            charts.set(key, chart);
          }
        }

        if(tfGroup){
          tfGroup.querySelectorAll('button').forEach(b => {
            b.classList.toggle('tab-active', b.dataset.tf === tf);
          });
        }
      }

      if(tfGroup){
        tfGroup.querySelectorAll('button').forEach(b => {
          const tf = b.dataset.tf;
          if(!tf) return;
          b.addEventListener('click', () => renderForTf(tf));
        });
      }

      renderForTf(currentTf);
      const buyBtn = document.getElementById('detailBuy');
      const sellBtn = document.getElementById('detailSell');
      if(buyBtn){ buyBtn.onclick = () => onStockAction('buy', id); }
      if(sellBtn){ sellBtn.onclick = () => onStockAction('sell', id); }
    }
  });
}

// ------- Rendering -------
function refreshTopline(){
  setText('balanceDisplay', rupee(State.balance));
  setText('cashBalance', rupee(State.balance));
  const { value, invested } = computePortfolio();
  setText('portfolioValue', rupee(value + State.balance));
  setText('totalInvested', rupee(invested));
  const pl = value - invested;
  const el = document.getElementById('portfolioPL');
  if(el){
    el.textContent = `${pl>=0?'+':''}${rupee(Math.abs(pl))}`;
    el.className = `mt-2 text-sm ${pl>=0? 'up':'down'}`;
  }
}

function computePortfolio(){
  // stocks
  let invested = 0; let value = 0;
  for(const [id, pos] of Object.entries(State.holdings)){
    invested += pos.qty * pos.avg;
    const s = stocks.find(x => x.id===id);
    if(s) value += pos.qty * latestPriceTF(s, State.stockTF);
  }
  // funds
  for(const [id, pos] of Object.entries(State.mfHoldings)){
    invested += pos.units * pos.avg;
    const f = funds.find(x => x.id===id);
    if(f) value += pos.units * latestPriceTF(f, '1D');
  }
  return { invested, value };
}

function renderTxHistory(){
  const list = document.getElementById('txList');
  const empty = document.getElementById('txEmpty');
  if(!list) return;
  list.innerHTML = '';
  const arr = (State.transactions || []).slice().sort((a,b)=> b.ts - a.ts);
  if(empty) empty.classList.toggle('hidden', arr.length>0);
  for(const t of arr){
    const d = document.createElement('div');
    d.className = 'card p-3 flex items-center justify-between';
    const when = new Date(t.ts).toLocaleString('en-IN', { hour12:false });
    let left = '';
    if(t.assetType==='stock'){
      if(t.type==='buy' || t.type==='sell'){
        left = `${t.type.toUpperCase()} • ${t.name} (${t.id}) · Qty ${t.qty} @ ${rupee(t.price)}`;
      }
    } else if(t.assetType==='fund'){
      if(t.type==='invest'){
        left = `INVEST • ${t.name} · ${rupee(t.amount)} @ NAV ${rupee(t.nav)}`;
      } else if(t.type==='redeem'){
        left = `REDEEM • ${t.name} · ${rupee(t.amount)} (${(t.units||0).toFixed(3)} units)`;
      } else if(t.type==='sip_start'){
        left = `SIP START • ${t.name} · ${rupee(t.amount)}/mo`;
      }
    }
    const amt = t.amount ?? 0;
    const right = `<div class="text-right">
      <div class="${amt>=0?'up':'down'} font-medium">${amt>=0?'+':''}${rupee(Math.abs(amt))}</div>
      <div class="text-[10px] text-neutral-500">${when}</div>
    </div>`;
    d.innerHTML = `<div class="text-sm">${left}</div>${right}`;
    list.appendChild(d);
  }
}

function logTx(tx){
  if(!State.transactions) State.transactions = [];
  State.transactions.push({ ts: Date.now(), ...tx });
  saveState();
  renderTxHistory();
}

function updateChartsOnly(){
  const tf = State.stockTF;
  const mkSeriesFull = sensexSeries(tf);
  const mkSeries = mkSeriesFull.slice(-30);
  const len = mkSeries.length;
  const labelsDash = Array.from({length: len}, (_,i)=> i+1);
  const dash = charts.get('market');
  if(dash){ dash.data.labels = labelsDash; dash.data.datasets[0].data = mkSeries; dash.update('none'); }

  for(const s of stocks){
    const series = s.tf[tf].slice(-30);
    const labels = Array.from({length: series.length}, (_,i)=> i+1);
    const key = `stock-${s.id}`;
    const c = charts.get(key);
    if(c){ c.data.labels = labels; c.data.datasets[0].data = series; c.update('none'); }
    const p = document.getElementById(`price-${s.id}`);
    const ch = document.getElementById(`chg-${s.id}`);
    if(p) p.textContent = rupee(latestPriceTF(s, tf));
    if(ch){ ch.textContent = pct(s.change); ch.classList.toggle('up', s.change>=0); ch.classList.toggle('down', s.change<0); }
    const u = document.getElementById(`upd-${s.id}`);
    if(u){
      const t = liveStamp.get(s.id);
      u.textContent = State.liveEnabled && t ? `Live · ${timeAgoShort(t)}` : 'Simulated';
    }
  }

  // update open stock detail modal chart if present
  for(const s of stocks){
    const keyModal = `stock-modal-${s.id}`;
    const cModal = charts.get(keyModal);
    if(!cModal) continue;
    const tfModal = cModal._tf || State.stockTF;
    const seriesFull = s.tf[tfModal] || [];
    const series = seriesFull.slice(-30);
    const labels = Array.from({length: series.length || 30}, (_,i)=> i+1);
    cModal.data.labels = labels;
    cModal.data.datasets[0].data = series;
    cModal.update('none');

    const priceEl = document.getElementById('stockDetailPrice');
    const changeEl = document.getElementById('stockDetailChange');
    const lastPrice = latestPriceTF(s, tfModal);
    const first = series[0] ?? lastPrice;
    const chgPct = first ? ((lastPrice - first)/first)*100 : 0;
    if(priceEl) priceEl.textContent = rupee(lastPrice);
    if(changeEl){
      changeEl.textContent = `${chgPct>=0?'+':''}${chgPct.toFixed(2)}% · ${tfModal}`;
      changeEl.classList.toggle('up', chgPct>=0);
      changeEl.classList.toggle('down', chgPct<0);
    }
  }

  // watchlist updates
  const wl = State.watchlist || [];
  for(const id of wl){
    const s = stocks.find(x=>x.id===id);
    if(!s) continue;
    const series = s.tf[tf].slice(-30);
    const labels = Array.from({length: series.length}, (_,i)=> i+1);
    const key = `watch-${s.id}`;
    const c = charts.get(key);
    if(c){ c.data.labels = labels; c.data.datasets[0].data = series; c.update('none'); }
    const p = document.getElementById(`price-watch-${s.id}`);
    const ch = document.getElementById(`chg-watch-${s.id}`);
    if(p) p.textContent = rupee(latestPriceTF(s, tf));
    if(ch){ ch.textContent = pct(s.change); ch.classList.toggle('up', s.change>=0); ch.classList.toggle('down', s.change<0); }
  }

  for(const f of funds){
    const series = f.tf['1D'].slice(-30);
    const labels = Array.from({length: series.length}, (_,i)=> i+1);
    const key = `fund-${f.id}`;
    const c = charts.get(key);
    const nav = latestPriceTF(f,'1D');
    if(c){ c.data.labels = labels; c.data.datasets[0].data = series; c.update('none'); }
    const n = document.getElementById(`nav-${f.id}`);
    if(n) n.textContent = rupee(nav);
  }
}

function renderDashboard(){
  // Market chart (use average of some stocks)
  const labels = Array.from({length: 30}, (_,i)=> i+1);
  const series = sensexSeries(State.stockTF).slice(-30);
  const ctx = document.getElementById('marketChart').getContext('2d');
  if(charts.get('market')){
    const c = charts.get('market');
    c.data.labels = labels;
    c.data.datasets[0].data = series;
    c.update('none');
  } else {
    charts.set('market', makeLineChart(ctx, labels, series));
  }
  const grp = document.getElementById('dashTfGroup');
  if(grp){
    grp.querySelectorAll('button').forEach(b => {
      b.classList.toggle('tab-active', b.dataset.tf === State.stockTF);
      if(!b._bound){
        b._bound = true;
        b.addEventListener('click', () => { State.stockTF = b.dataset.tf; saveState(); renderAll(); });
      }
    });
  }
}

function renderStocks(){
  const wrap = document.getElementById('stocksList');
  wrap.innerHTML = '';
  const labels = Array.from({length: 30}, (_,i)=> i+1);
  const q = ($('#stockSearch')?.value || '').trim().toLowerCase();
  const list = q ? stocks.filter(s => s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)) : stocks;
  for(const s of list){
    const card = document.createElement('div');
    card.className = 'card p-4 hover:shadow-md transition';
    card.innerHTML = `
      <div class="flex items-start justify-between">
        <div>
          <div class="font-semibold">${s.name}</div>
          <div class="text-sm text-neutral-500">${s.id}</div>
        </div>
        <div class="text-right">
          <div class="font-semibold" id="price-${s.id}">${rupee(latestPriceTF(s, State.stockTF))}</div>
          <div class="text-xs ${s.change>=0?'up':'down'}" id="chg-${s.id}">${pct(s.change)}</div>
          <div class="text-[10px] text-neutral-500" id="upd-${s.id}"></div>
        </div>
      </div>
      <div class="h-20 mt-3"><canvas id="chart-${s.id}"></canvas></div>
      <div class="mt-3 flex gap-2">
        <button class="btn btn-ghost" data-star="${s.id}">★</button>
        <button class="btn btn-primary" data-act="buy" data-id="${s.id}"><i class="fa-solid fa-plus"></i> Buy</button>
        <button class="btn btn-ghost" data-act="sell" data-id="${s.id}"><i class="fa-solid fa-minus"></i> Sell</button>
      </div>
    `;
    wrap.appendChild(card);

    card.addEventListener('click', (e) => {
      const target = e.target;
      if(target.closest && target.closest('button')) return;
      openStockDetailModal(s.id);
    });

    // chart
    const ctx = card.querySelector('canvas').getContext('2d');
    const key = `stock-${s.id}`;
    charts.get(key)?.destroy();
    charts.set(key, makeLineChart(ctx, labels, s.tf[State.stockTF]));

    // buttons
    card.querySelectorAll('button[data-act]')
      .forEach(btn => btn.addEventListener('click', () => onStockAction(btn.dataset.act, s.id)));
    const star = card.querySelector('button[data-star]');
    if(star){
      const inWL = (State.watchlist||[]).includes(s.id);
      star.textContent = inWL ? '★' : '☆';
      star.classList.toggle('up', inWL);
      star.addEventListener('click', () => {
        const set = new Set(State.watchlist||[]);
        if(set.has(s.id)) set.delete(s.id); else set.add(s.id);
        State.watchlist = Array.from(set);
        saveState();
        renderStocks();
        renderWatchlist();
        showToast(inWL ? 'Removed from Watchlist' : 'Added to Watchlist');
      });
    }
  }
  // timeframe header buttons
  $('#stockTfGroup')?.querySelectorAll('button').forEach(b => {
    b.classList.toggle('tab-active', b.dataset.tf === State.stockTF);
    b.onclick = () => { State.stockTF = b.dataset.tf; saveState(); renderAll(); };
  });
  const search = document.getElementById('stockSearch');
  if(search && !search._bound){
    search._bound = true;
    search.addEventListener('input', () => renderStocks());
  }
}

function onStockAction(act, id){
  const s = stocks.find(x=>x.id===id);
  if(!s) return;
  if(act==='buy'){
    openModal({
      title: `Buy ${s.name}`,
      bodyHTML: `<label class="text-sm">Quantity</label><input id="qtyInput" type="number" class="mt-1 w-full card px-3 py-2" value="1" min="1" />` ,
      onConfirm: () => {
        const qty = parseInt(document.getElementById('qtyInput').value);
        if(!qty || qty<=0) return false;
        const price = latestPriceTF(s, State.stockTF);
        const cost = price * qty;
        if(cost > State.balance){ showToast('Not enough balance', 'error'); return false; }
        const pos = State.holdings[id] || { qty:0, avg: 0 };
        const newQty = pos.qty + qty;
        const newAvg = (pos.qty*pos.avg + cost)/newQty;
        State.holdings[id] = { qty: newQty, avg: newAvg };
        State.balance -= cost;
        logTx({ type:'buy', assetType:'stock', id, name:s.name, qty, price, amount: -cost });
        saveState(); refreshTopline(); renderPortfolio(); renderStocks();
        showToast('Order executed', 'success');
      }
    });
  } else {
    const pos = State.holdings[id];
    if(!pos || pos.qty<=0){ showToast('No holdings to sell', 'error'); return; }
    openModal({
      title: `Sell ${s.name}`,
      bodyHTML: `<label class="text-sm">Quantity (max ${pos.qty})</label><input id="qtyInput" type="number" class="mt-1 w-full card px-3 py-2" value="${pos.qty}" min="1" max="${pos.qty}" />` ,
      onConfirm: () => {
        const qty = parseInt(document.getElementById('qtyInput').value);
        if(!qty || qty<=0 || qty>pos.qty) return false;
        const price = latestPriceTF(s, State.stockTF);
        const value = price * qty;
        pos.qty -= qty;
        if(pos.qty <= 1e-6) delete State.holdings[id];
        State.balance += value;
        logTx({ type:'sell', assetType:'stock', id, name:s.name, qty, price, amount: value });
        saveState(); refreshTopline(); renderPortfolio(); renderStocks();
        showToast('Sold successfully', 'success');
      }
    });
  }
}

function renderFunds(){
  const wrap = document.getElementById('fundsList');
  wrap.innerHTML = '';
  const labels = Array.from({length: 30}, (_,i)=> i+1);
  for(const f of funds){
    const card = document.createElement('div');
    card.className = 'card p-4 hover:shadow-md transition';
    const held = State.mfHoldings[f.id];
    const heldUnits = held && held.units >= MF_DUST ? held.units : 0;
    card.innerHTML = `
      <div class="flex items-start justify-between">
        <div>
          <div class="font-semibold">${f.name}</div>
          <div class="text-sm text-neutral-500">NAV <span id="nav-${f.id}">${rupee(latestPriceTF(f,'1D'))}</span>${heldUnits>0 ? ` · Units: ${heldUnits.toFixed(3)}` : ''}</div>
        </div>
        <div class="text-right">
          <div class="font-semibold"></div>
          <div class="text-xs up">1Y ${pct(f.oneY)}</div>
        </div>
      </div>
      <div class="h-20 mt-3"><canvas id="chart-${f.id}"></canvas></div>
      <div class="mt-3 flex gap-2">
        <button class="btn btn-primary" data-act="invest" data-id="${f.id}">Invest Now</button>
        <button class="btn btn-ghost" data-act="sip" data-id="${f.id}">Start SIP</button>
        ${heldUnits>0 ? `<button class="btn btn-ghost" data-act="redeem" data-id="${f.id}">Redeem</button>` : ''}
      </div>
    `;
    wrap.appendChild(card);

    const ctx = card.querySelector('canvas').getContext('2d');
    const key = `fund-${f.id}`;
    charts.get(key)?.destroy();
    charts.set(key, makeLineChart(ctx, labels, f.tf['1D'], 'rgb(59 130 246)'));

    card.querySelectorAll('button[data-act]')
      .forEach(btn => btn.addEventListener('click', () => onFundAction(btn.dataset.act, f.id)));
  }
  renderMySips();
}

function onFundAction(act, id){
  const f = funds.find(x=>x.id===id);
  if(!f) return;
  if(act==='invest'){
    openModal({
      title: `Invest in ${f.name}`,
      bodyHTML: `<label class="text-sm">Amount (₹)</label><input id="amtInput" type="number" class="mt-1 w-full card px-3 py-2" value="1000" min="1" />` ,
      onConfirm: () => {
        const amt = parseInt(document.getElementById('amtInput').value);
        if(!amt || amt<=0) return false;
        if(amt > State.balance){ showToast('Not enough balance', 'error'); return false; }
        const nav = latestPriceTF(f,'1D');
        const units = amt / nav;
        const pos = State.mfHoldings[id] || { units:0, avg:0 };
        const newUnits = round3(pos.units + units);
        const newAvg = (pos.units*pos.avg + amt)/newUnits;
        State.mfHoldings[id] = { units: newUnits, avg: newAvg };
        State.balance -= amt;
        logTx({ type:'invest', assetType:'fund', id, name:f.name, nav, amount: -amt, units });
        saveState(); refreshTopline(); renderFunds(); renderPortfolio();
        showToast('Invested successfully', 'success');
      }
    });
  } else if(act==='sip'){
    openModal({
      title: `Start SIP - ${f.name}`,
      bodyHTML: `
        <label class="text-sm">Amount per instalment (₹)</label>
        <input id="amtInput" type="number" class="mt-1 w-full card px-3 py-2" value="2000" min="1" />
        <div class="mt-3 text-sm">
          <div class="text-xs text-neutral-500 mb-1">Frequency</div>
          <div class="flex gap-2 text-xs" id="sipFreqGroup">
            <button class="chip btn-ghost tab-active" data-freq="monthly">Monthly</button>
            <button class="chip btn-ghost" data-freq="quarterly">Quarterly</button>
          </div>
        </div>
        <div class="mt-3 text-xs flex items-center gap-2">
          <input id="sipStepUp" type="checkbox" class="scale-90" />
          <span>Enable step-up SIP</span>
        </div>
        <div class="mt-2 text-xs flex items-center gap-2">
          <span class="text-neutral-500">Step-up % per year</span>
          <input id="sipStepUpPct" type="number" class="card px-2 py-1 w-20" value="10" min="1" max="50" />
        </div>
        <div class="mt-3 text-xs flex items-center gap-2">
          <input id="sipInvestNow" type="checkbox" class="scale-90" />
          <span>Invest this amount instantly and then start SIP</span>
        </div>
      ` ,
      onOpen: () => {
        const grp = document.getElementById('sipFreqGroup');
        if(grp && !grp._bound){
          grp._bound = true;
          grp.querySelectorAll('button').forEach(b => {
            b.addEventListener('click', () => {
              grp.querySelectorAll('button').forEach(x => x.classList.remove('tab-active'));
              b.classList.add('tab-active');
            });
          });
        }
      },
      onConfirm: () => {
        const amt = parseInt(document.getElementById('amtInput').value);
        if(!amt || amt<=0) return false;
        const freqGroup = document.getElementById('sipFreqGroup');
        let freq = 'monthly';
        if(freqGroup){
          const active = freqGroup.querySelector('button.tab-active');
          if(active && active.dataset.freq) freq = active.dataset.freq;
        }
        const stepUpEnabled = !!document.getElementById('sipStepUp')?.checked;
        const stepUpPct = stepUpEnabled ? Number(document.getElementById('sipStepUpPct')?.value || 0) : 0;
        const investNow = !!document.getElementById('sipInvestNow')?.checked;

        if(investNow){
          if(amt > State.balance){ showToast('Not enough balance for instant invest', 'error'); return false; }
          const nav = latestPriceTF(f,'1D');
          const units = amt / nav;
          const pos = State.mfHoldings[id] || { units:0, avg:0 };
          const newUnits = round3(pos.units + units);
          const newAvg = (pos.units*pos.avg + amt)/newUnits;
          State.mfHoldings[id] = { units: newUnits, avg: newAvg };
          State.balance -= amt;
          logTx({ type:'invest', assetType:'fund', id, name:f.name, nav, amount: -amt, units });
        }

        const sip = {
          id: `SIP-${Date.now()}`,
          fundId: id,
          amount: amt,
          startedAt: new Date().toISOString(),
          freq,
          stepUpPct: stepUpEnabled ? stepUpPct : 0
        };
        State.sips.push(sip);
        logTx({ type:'sip_start', assetType:'fund', id, name:f.name, amount: amt });
        saveState(); renderFunds(); showToast('SIP started', 'success');
      }
    });
  } else if(act==='redeem'){
    const pos = State.mfHoldings[id];
    if(!pos || pos.units < MF_DUST){ showToast('No holdings to redeem', 'error'); return; }
    const nav = latestPriceTF(f,'1D');
    const maxAmount = Math.floor(pos.units * nav);
    openModal({
      title: `Redeem ${f.name}`,
      bodyHTML: `
        <div class="text-xs text-neutral-500">Available units: ${pos.units.toFixed(3)} (≈ ${rupee(maxAmount)})</div>
        <div class="mt-2 flex gap-2 text-xs">
          <button class="chip btn-ghost" id="modeAmount">By Amount (₹)</button>
          <button class="chip btn-ghost" id="modeUnits">By Units</button>
        </div>
        <div class="mt-2" id="redeemFields"></div>
      `,
      onOpen: () => {
        const fields = document.getElementById('redeemFields');
        const btnAmt = document.getElementById('modeAmount');
        const btnUnits = document.getElementById('modeUnits');
        let mode = 'amount';
        const renderFields = () => {
          btnAmt.classList.toggle('tab-active', mode==='amount');
          btnUnits.classList.toggle('tab-active', mode==='units');
          if(mode==='amount'){
            fields.innerHTML = `
              <label class="text-sm">Amount (₹)</label>
              <div class="flex gap-2 mt-1">
                <input id="amtInput" type="number" class="w-full card px-3 py-2" value="${Math.min(1000, maxAmount)}" min="1" max="${maxAmount}" />
                <button id="maxAmt" class="btn btn-ghost">Max</button>
              </div>`;
            document.getElementById('maxAmt').onclick = () => { const a=document.getElementById('amtInput'); a.value = String(maxAmount); };
          } else {
            fields.innerHTML = `
              <label class="text-sm">Units</label>
              <div class="flex gap-2 mt-1">
                <input id="unitInput" type="number" step="0.001" class="w-full card px-3 py-2" value="${Math.min(pos.units, 1).toFixed(3)}" min="0.001" max="${pos.units.toFixed(3)}" />
                <button id="maxUnits" class="btn btn-ghost">Max</button>
              </div>
              <div class="text-xs text-neutral-500 mt-1">Value is computed at current NAV</div>`;
            document.getElementById('maxUnits').onclick = () => { const u=document.getElementById('unitInput'); u.value = String(pos.units.toFixed(3)); };
          }
        };
        btnAmt.onclick = () => { mode='amount'; renderFields(); };
        btnUnits.onclick = () => { mode='units'; renderFields(); };
        renderFields();
        modalConfirm._redeemMode = () => mode;
      },
      onConfirm: () => {
        const mode = modalConfirm._redeemMode ? modalConfirm._redeemMode() : 'amount';
        if(mode==='amount'){
          const amt = parseInt(document.getElementById('amtInput').value);
          if(!amt || amt<=0) return false;
          if(amt > maxAmount){ showToast('Exceeds redeemable amount', 'error'); return false; }
          const units = Math.min(pos.units, round3(amt / nav));
          const newUnits = round3(pos.units - units);
          if(newUnits < MF_DUST){ delete State.mfHoldings[id]; } else { pos.units = newUnits; }
          State.balance += amt;
          logTx({ type:'redeem', assetType:'fund', id, name:f.name, nav, amount: amt, units });
        } else {
          const units = round3(parseFloat(document.getElementById('unitInput').value));
          if(!units || units<=0) return false;
          if(units > pos.units + 1e-9){ showToast('Exceeds available units', 'error'); return false; }
          const amt = units * nav;
          const newUnits = round3(pos.units - units);
          if(newUnits < MF_DUST){ delete State.mfHoldings[id]; } else { pos.units = newUnits; }
          State.balance += amt;
          logTx({ type:'redeem', assetType:'fund', id, name:f.name, nav, amount: amt, units });
        }
        saveState(); refreshTopline(); renderPortfolio(); renderFunds();
        showToast('Redeemed successfully', 'success');
      }
    });
  }
}

function renderMySips(){
  const wrap = document.getElementById('mySips');
  wrap.innerHTML = '';
  for(const s of State.sips){
    const f = funds.find(x=>x.id===s.fundId);
    const card = document.createElement('div');
    card.className = 'card p-4 flex flex-col gap-2';
    card.innerHTML = `
      <div class="font-medium">${f?.name ?? s.fundId}</div>
      <div class="text-sm text-neutral-500">₹${s.amount.toLocaleString('en-IN')} / month</div>
      <button class="btn btn-ghost text-rose-600" data-id="${s.id}"><i class="fa-solid fa-trash"></i> Stop SIP</button>
    `;
    card.querySelector('button')?.addEventListener('click', () => {
      const idx = State.sips.findIndex(x=>x.id===s.id);
      if(idx>=0) State.sips.splice(idx,1);
      saveState();
      renderMySips();
    });
    wrap.appendChild(card);
  }
}

function renderSipCalculator(){
  const amount = document.getElementById('sipAmount');
  const rate = document.getElementById('sipRate');
  const years = document.getElementById('sipYears');
  const amountSlider = document.getElementById('sipAmountSlider');
  const rateSlider = document.getElementById('sipRateSlider');
  const yearsSlider = document.getElementById('sipYearsSlider');

  const sync = () => {
    if(amount && amountSlider) amountSlider.value = amount.value || '0';
    if(rate && rateSlider) rateSlider.value = rate.value || '0';
    if(years && yearsSlider) yearsSlider.value = years.value || '0';
  };

  if(amount && amountSlider && !amountSlider._bound){
    amountSlider._bound = true;
    amountSlider.addEventListener('input', () => { amount.value = amountSlider.value; calcSip(); });
    amount.addEventListener('change', () => { amountSlider.value = amount.value || '0'; });
  }
  if(rate && rateSlider && !rateSlider._bound){
    rateSlider._bound = true;
    rateSlider.addEventListener('input', () => { rate.value = rateSlider.value; calcSip(); });
    rate.addEventListener('change', () => { rateSlider.value = rate.value || '0'; });
  }
  if(years && yearsSlider && !yearsSlider._bound){
    yearsSlider._bound = true;
    yearsSlider.addEventListener('input', () => { years.value = yearsSlider.value; calcSip(); });
    years.addEventListener('change', () => { yearsSlider.value = years.value || '0'; });
  }

  $('#calcSipBtn')?.addEventListener('click', calcSip);
  sync();
  calcSip();
}

function calcSip(){
  const P = Number($('#sipAmount').value || 0);
  const r = Number($('#sipRate').value || 0)/100;
  const y = Number($('#sipYears').value || 0);
  const n = 12 * y;
  const i = r/12;
  const invested = P * n;
  const fv = i === 0 ? invested : P * ((Math.pow(1+i, n)-1)/i) * (1+i);

  setText('sipInvested', rupee(invested));
  setText('sipExpected', rupee(fv));
  setText('sipGain', rupee(fv - invested));

  // growth per month
  const labels = Array.from({length: n}, (_,k)=> k+1);
  const values = labels.map(m => i === 0 ? P*m : P * ((Math.pow(1+i, m)-1)/i) * (1+i));
  const ctx = document.getElementById('sipChart').getContext('2d');

  const key = 'sip';
  const existing = charts.get(key);
  if(existing){
    existing.data.labels = labels;
    existing.data.datasets[0].data = values;
    existing.update('none');
  } else {
    charts.set(key, makeLineChart(ctx, labels, values, 'rgb(99 102 241)'));
  }

  // pie chart for invested vs gain
  const pieCtx = document.getElementById('sipPieChart')?.getContext('2d');
  if(pieCtx){
    const pieKey = 'sip-pie';
    const gain = Math.max(fv - invested, 0);
    const pieExisting = charts.get(pieKey);
    const data = {
      labels: ['Invested', 'Gain'],
      datasets: [{
        data: [invested, gain],
        backgroundColor: ['rgb(37 99 235)', 'rgb(16 185 129)'],
        borderWidth: 0
      }]
    };
    if(pieExisting){
      pieExisting.data = data;
      pieExisting.update('none');
    } else {
      const pie = new Chart(pieCtx, {
        type: 'doughnut',
        data,
        options: {
          responsive: true,
          cutout: '55%',
          animation: { animateRotate: true, animateScale: true, duration: 250 },
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } },
            tooltip: { enabled: true }
          }
        }
      });
      charts.set(pieKey, pie);
    }
  }

   const typeGroup = document.getElementById('sipChartTypeGroup');
   const lineWrap = document.getElementById('sipChartLineWrap');
   const pieWrap = document.getElementById('sipChartPieWrap');
   const currentType = State.sipChartType || 'line';
   function applyType(t){
     State.sipChartType = t;
     saveState();
     if(lineWrap) lineWrap.classList.toggle('hidden', t !== 'line');
     if(pieWrap) pieWrap.classList.toggle('hidden', t !== 'pie');
     if(typeGroup){
       typeGroup.querySelectorAll('button').forEach(b => {
         b.classList.toggle('tab-active', b.dataset.type === t);
       });
     }
   }
   applyType(currentType);
   if(typeGroup && !typeGroup._bound){
     typeGroup._bound = true;
     typeGroup.querySelectorAll('button').forEach(b => {
       const t = b.dataset.type;
       if(!t) return;
       b.addEventListener('click', () => applyType(t));
     });
   }
}

function renderPortfolio(){
  const sum = computePortfolio();
  setText('pfInvested', rupee(sum.invested));
  setText('pfValue', rupee(sum.value));
  const pfpl = document.getElementById('pfPL');
  if(pfpl){
    const pl = sum.value - sum.invested;
    pfpl.textContent = rupee(pl);
    pfpl.classList.toggle('up', pl>=0);
    pfpl.classList.toggle('down', pl<0);
  }

  const swrap = document.getElementById('portfolioStocks');
  const sempty = document.getElementById('portfolioStocksEmpty');
  if(swrap){ swrap.innerHTML = ''; }
  let scount = 0;
  for(const [id, pos] of Object.entries(State.holdings)){
    const s = stocks.find(x=>x.id===id);
    if(!s) continue;
    scount++;
    const price = latestPriceTF(s, State.stockTF);
    const value = pos.qty * price;
    const invested = pos.qty * pos.avg;
    const pl = value - invested;
    const card = document.createElement('div');
    card.className = 'card p-4';
    card.innerHTML = `
      <div class="flex items-center justify-between">
        <div>
          <div class="font-semibold">${s.name}</div>
          <div class="text-xs">Qty: ${pos.qty}</div>
        </div>
        <div class="text-right">
          <div class="text-sm">Value: ${rupee(value)}</div>
          <div class="text-xs ${pl>=0?'up':'down'}">P/L: ${rupee(pl)}</div>
        </div>
      </div>
      <div class="mt-3 flex justify-end">
        <button class="btn btn-ghost" data-sell="${id}">Sell</button>
      </div>`;
    swrap?.appendChild(card);
    const sellBtn = card.querySelector('button[data-sell]');
    if(sellBtn){ sellBtn.addEventListener('click', () => onStockAction('sell', id)); }
  }
  if(sempty){ sempty.classList.toggle('hidden', scount>0); }

  const fwrap = document.getElementById('portfolioFunds');
  const fempty = document.getElementById('portfolioFundsEmpty');
  if(fwrap){ fwrap.innerHTML = ''; }
  let fcount = 0;
  for(const [id, pos] of Object.entries(State.mfHoldings)){
    if(!pos || pos.units < MF_DUST) { continue; }
    const f = funds.find(x=>x.id===id);
    if(!f) continue;
    fcount++;
    const nav = latestPriceTF(f,'1D');
    const value = pos.units * nav;
    const invested = pos.units * pos.avg;
    const pl = value - invested;
    const card = document.createElement('div');
    card.className = 'card p-4';
    card.innerHTML = `
      <div class="flex items-center justify-between">
        <div>
          <div class="font-semibold">${f.name}</div>
          <div class="text-xs">Units: ${pos.units.toFixed(3)}</div>
        </div>
        <div class="text-right">
          <div class="text-sm">Value: ${rupee(value)}</div>
          <div class="text-xs ${pl>=0?'up':'down'}">P/L: ${rupee(pl)}</div>
        </div>
      </div>
      <div class="mt-3 flex justify-end">
        <button class="btn btn-ghost" data-redeem="${id}">Redeem</button>
      </div>`;
    fwrap?.appendChild(card);
    const btn = card.querySelector('button[data-redeem]');
    if(btn){ btn.addEventListener('click', () => onFundAction('redeem', id)); }
  }
  if(fempty){ fempty.classList.toggle('hidden', fcount>0); }
}

const symbolMap = {
  'TCS': 'TCS.NS',
  'INFY': 'INFY.NS',
  'RELI': 'RELIANCE.NS',
  'HDFCB': 'HDFCBANK.NS',
  'ICICI': 'ICICIBANK.NS',
  'SBIN': 'SBIN.NS',
  'LT': 'LT.NS',
  'ITC': 'ITC.NS',
  'BHARTI': 'BHARTIARTL.NS',
  'HINDUNIL': 'HINDUNILVR.NS',
};
let liveIndex = 0;
let lastLiveAt = 0;
const liveStamp = new Map();
async function fetchLiveOnce(){
  if(!State.liveEnabled || !State.finnhubKey) return;
  const now = Date.now();
  if(now - lastLiveAt < 5000) return;
  lastLiveAt = now;
  const s = stocks[liveIndex % stocks.length];
  liveIndex++;
  const sym = symbolMap[s.id] || s.id;
  try{
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(State.finnhubKey)}`;
    const res = await fetch(url);
    const data = await res.json();
    const price = data && typeof data.c !== 'undefined' ? Number(data.c) : NaN;
    if(!isNaN(price) && price > 0){
      const arr = s.tf['1D'];
      const last = arr[arr.length-1];
      arr.push(price);
      if(arr.length>40) arr.shift();
      s.price = price;
      s.change = last ? ((price-last)/last)*100 : 0;
      liveStamp.set(s.id, Date.now());
      updateChartsOnly();
      const liveBtn = document.getElementById('liveToggle');
      if(liveBtn){ const old = liveBtn.innerHTML; liveBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> Live ✓'; setTimeout(()=>{ liveBtn.innerHTML = old; }, 800); }
    }
  }catch(e){}
}

function startTicker(){
  let lastDemoAt = 0;
  let lastFullRenderAt = 0;
  setInterval(() => {
    try{
      const now = Date.now();
      if(State.liveEnabled){
        if(now - lastDemoAt > 4000){ stocks.forEach(randomWalkUpdate); lastDemoAt = now; }
      } else {
        stocks.forEach(randomWalkUpdate);
      }
      funds.forEach(randomWalkUpdate);
      refreshTopline();
      updateChartsOnly();
      if(now - lastFullRenderAt > 10000){ renderStocks(); renderWatchlist(); renderFunds(); lastFullRenderAt = now; }
      renderPortfolio();
    } catch(e){ console && console.warn && console.warn('ticker error', e); }
  }, 1000);
  setInterval(() => { try{ fetchLiveOnce(); } catch(e){} }, 1000);
  const heartbeat = () => { try{ updateChartsOnly(); } finally { requestAnimationFrame(heartbeat); } };
  requestAnimationFrame(heartbeat);
}

// ------- Init -------
function renderAll(){
  refreshTopline();
  renderDashboard();
  renderStocks();
  renderWatchlist();
  renderFunds();
  renderSipCalculator();
  renderTxHistory();
  renderPortfolio();
}

setupTabs();
setupAuth();
switchTab('auth');
refreshUserUI();
renderAll();
startTicker();
