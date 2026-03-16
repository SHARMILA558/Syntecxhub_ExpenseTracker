/* ══════════════════════════════════════════════════════════════════════════
   LEDGER v2 — app.js
   Features: Login/Register/Logout · Per-user expense history · Currency switch
   ══════════════════════════════════════════════════════════════════════════ */

const API = '/api';

/* ── Currency config ─────────────────────────────────────────────────────── */
const CURRENCIES = {
  USD:{symbol:'$',locale:'en-US'},   EUR:{symbol:'€',locale:'de-DE'},
  GBP:{symbol:'£',locale:'en-GB'},   JPY:{symbol:'¥',locale:'ja-JP'},
  INR:{symbol:'₹',locale:'en-IN'},   CAD:{symbol:'CA$',locale:'en-CA'},
  AUD:{symbol:'A$',locale:'en-AU'},  CHF:{symbol:'Fr',locale:'de-CH'},
  CNY:{symbol:'¥',locale:'zh-CN'},   BRL:{symbol:'R$',locale:'pt-BR'},
  MXN:{symbol:'MX$',locale:'es-MX'}, SGD:{symbol:'S$',locale:'en-SG'},
};

let currentCurrency = 'USD';

function fmt(n) {
  const c = CURRENCIES[currentCurrency] || CURRENCIES.USD;
  return new Intl.NumberFormat(c.locale, {style:'currency', currency: currentCurrency, maximumFractionDigits: currentCurrency==='JPY'?0:2}).format(n);
}

/* ── Categories ──────────────────────────────────────────────────────────── */
const CATEGORIES = ['Food','Utilities','Entertainment','Health','Transport','Shopping','Other'];
const CAT_COLORS  = {
  Food:'#f97316', Utilities:'#3b82f6', Entertainment:'#a855f7',
  Health:'#22c55e', Transport:'#eab308', Shopping:'#ec4899', Other:'#6b7280'
};

/* ── App state ───────────────────────────────────────────────────────────── */
let expenses      = [];
let filterCat     = 'All';
let sortBy        = 'date';
let addCategory   = 'Food';
let editCategory  = 'Food';
let historyOpen   = false;
let currentUser   = null;

/* ── DOM shortcuts ───────────────────────────────────────────────────────── */
const $  = id => document.getElementById(id);
const authScreen    = $('authScreen');
const appScreen     = $('appScreen');
const expenseList   = $('expenseList');
const breakdown     = $('breakdown');
const filterRow     = $('filterRow');
const totalValue    = $('totalValue');
const addCard       = $('addCard');
const historyPanel  = $('historyPanel');
const historyList   = $('historyList');
const modalOverlay  = $('modalOverlay');
const inpDesc       = $('inpDesc');
const inpAmount     = $('inpAmount');
const inpDate       = $('inpDate');
const addBtn        = $('addBtn');
const formError     = $('formError');

/* ══════════════════════════════════════════════════════════════════════════
   UTILITY
   ══════════════════════════════════════════════════════════════════════════ */
function showToast(msg, type='success') {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className='toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2800);
}

function setErr(id, msg) { $(id).textContent = msg; }
function clearErr(id)    { $(id).textContent = ''; }
function todayStr()      { return new Date().toISOString().slice(0,10); }
function escHtml(s)      { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function updateAmountLabels() {
  const sym = CURRENCIES[currentCurrency]?.symbol || currentCurrency;
  $('amountLabel').textContent     = `Amount (${sym})`;
  $('editAmountLabel').textContent = `Amount (${sym})`;
}

function setCurrencyUI(code) {
  currentCurrency = code;
  const sel = $('currencySelect');
  if (sel) sel.value = code;
  updateAmountLabels();
}

/* ══════════════════════════════════════════════════════════════════════════
   AUTH
   ══════════════════════════════════════════════════════════════════════════ */
function switchTab(tab) {
  const isLogin = tab === 'login';
  $('loginForm').style.display    = isLogin ? '' : 'none';
  $('registerForm').style.display = isLogin ? 'none' : '';
  $('tabLogin').classList.toggle('active', isLogin);
  $('tabReg').classList.toggle('active', !isLogin);
  clearErr('loginError'); clearErr('regError');
  setTimeout(() => (isLogin ? $('loginUser') : $('regUser')).focus(), 50);
}

async function doLogin() {
  const username = $('loginUser').value.trim();
  const password = $('loginPass').value;
  clearErr('loginError');
  if (!username || !password) return setErr('loginError','Enter username and password.');
  const btn = document.querySelector('#loginForm .add-btn');
  btn.textContent = '…'; btn.disabled = true;
  try {
    const res = await fetch(`${API}/auth/login`, {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({username, password})
    });
    const data = await res.json();
    if (!res.ok) return setErr('loginError', data.detail || 'Login failed.');
    currentUser = data.username;
    setCurrencyUI(data.currency);
    enterApp();
  } catch { setErr('loginError','Network error. Is the server running?'); }
  finally { btn.textContent='SIGN IN →'; btn.disabled=false; }
}

async function doRegister() {
  const username = $('regUser').value.trim();
  const password = $('regPass').value;
  const currency = $('regCurrency').value;
  clearErr('regError');
  if (!username || !password) return setErr('regError','Fill all fields.');
  if (username.length < 3) return setErr('regError','Username must be 3+ characters.');
  if (password.length < 4) return setErr('regError','Password must be 4+ characters.');
  const btn = document.querySelector('#registerForm .add-btn');
  btn.textContent = '…'; btn.disabled = true;
  try {
    const res = await fetch(`${API}/auth/register`, {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({username, password, currency})
    });
    const data = await res.json();
    if (!res.ok) return setErr('regError', data.detail || 'Registration failed.');
    currentUser = data.username;
    setCurrencyUI(data.currency);
    showToast(`✓ Welcome, ${data.username}!`, 'success');
    enterApp();
  } catch { setErr('regError','Network error.'); }
  finally { btn.textContent='CREATE ACCOUNT →'; btn.disabled=false; }
}

async function doLogout() {
  await fetch(`${API}/auth/logout`, {method:'POST', credentials:'include'});
  currentUser = null;
  expenses = [];
  historyOpen = false;
  historyPanel.classList.remove('open');
  appScreen.style.display  = 'none';
  authScreen.style.display = '';
  $('loginUser').value = '';
  $('loginPass').value = '';
  switchTab('login');
  showToast('Logged out', 'info');
}

async function checkSession() {
  try {
    const res = await fetch(`${API}/auth/me`, {credentials:'include'});
    const data = await res.json();
    if (data.authenticated) {
      currentUser = data.username;
      setCurrencyUI(data.currency);
      enterApp();
    } else {
      showAuthScreen();
    }
  } catch {
    showAuthScreen();
  }
}

function showAuthScreen() {
  authScreen.style.display = '';
  appScreen.style.display  = 'none';
  setTimeout(() => $('loginUser').focus(), 200);
}

function enterApp() {
  authScreen.style.display = 'none';
  appScreen.style.display  = '';
  $('userLabel').textContent = currentUser;
  buildCatGrid('catGrid', addCategory, v => { addCategory = v; });
  inpDate.value = todayStr();
  loadExpenses();
  setTimeout(() => inpDesc.focus(), 200);
}

/* ══════════════════════════════════════════════════════════════════════════
   CURRENCY
   ══════════════════════════════════════════════════════════════════════════ */
async function changeCurrency(code) {
  setCurrencyUI(code);
  try {
    await fetch(`${API}/settings/currency`, {
      method:'PUT', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({currency: code})
    });
    showToast(`Currency → ${code}`, 'info');
    // Re-render with new format (amounts stored server-side, just re-render)
    renderList();
    loadSummary();
  } catch { showToast('Could not save currency', 'error'); }
}

/* ══════════════════════════════════════════════════════════════════════════
   EXPENSE API
   ══════════════════════════════════════════════════════════════════════════ */
async function loadExpenses() {
  expenseList.innerHTML = `
    <div class="loading-wrap">
      <div class="spinner"></div>
      <div class="loading-text">FETCHING RECORDS…</div>
    </div>`;
  try {
    const res = await fetch(`${API}/expenses?category=${filterCat}&sort_by=${sortBy}`, {credentials:'include'});
    if (res.status === 401) { doLogout(); return; }
    const data = await res.json();
    expenses = data.expenses;
    if (data.currency) setCurrencyUI(data.currency);
    renderList();
    loadSummary();
  } catch {
    expenseList.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠</div>Failed to load</div>`;
  }
}

async function loadSummary() {
  try {
    const res = await fetch(`${API}/summary`, {credentials:'include'});
    if (!res.ok) return;
    const data = await res.json();
    if (data.currency) setCurrencyUI(data.currency);
    totalValue.textContent = fmt(data.total);
    renderBreakdown(data.by_category, data.total);
    renderFilterButtons(data.categories);
  } catch {}
}

async function addExpense() {
  clearErr('formError');
  const desc   = inpDesc.value.trim();
  const amount = parseFloat(inpAmount.value);
  const date   = inpDate.value;
  if (!desc)             return setErr('formError','Description is required.');
  if (!amount||amount<=0)return setErr('formError','Enter a valid amount > 0.');
  if (!date)             return setErr('formError','Date is required.');

  addBtn.textContent = '…'; addBtn.disabled = true;
  try {
    const res = await fetch(`${API}/expenses`, {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({description:desc, amount, category:addCategory, date})
    });
    if (!res.ok) throw new Error();
    inpDesc.value=''; inpAmount.value=''; inpDate.value=todayStr();
    addCategory='Food'; buildCatGrid('catGrid', addCategory, v=>{addCategory=v;});
    inpDesc.focus();
    addCard.classList.add('pulse');
    setTimeout(()=>addCard.classList.remove('pulse'),600);
    showToast('✓ Expense added');
    loadExpenses();
    if (historyOpen) loadHistory();
  } catch { setErr('formError','Failed to add. Try again.'); }
  finally { addBtn.textContent='+ ADD EXPENSE'; addBtn.disabled=false; }
}

async function deleteExpense(id) {
  const row = document.querySelector(`[data-id="${id}"]`);
  if (row) row.classList.add('deleting');
  await new Promise(r=>setTimeout(r,350));
  try {
    await fetch(`${API}/expenses/${id}`, {method:'DELETE', credentials:'include'});
    showToast('Expense deleted');
    loadExpenses();
    if (historyOpen) loadHistory();
  } catch {
    showToast('Delete failed','error');
    if (row) row.classList.remove('deleting');
  }
}

async function saveEdit() {
  const id     = $('editId').value;
  const desc   = $('editDesc').value.trim();
  const amount = parseFloat($('editAmount').value);
  const date   = $('editDate').value;
  if (!desc||!amount||!date) return showToast('Fill all fields','error');
  try {
    const res = await fetch(`${API}/expenses/${id}`, {
      method:'PUT', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({description:desc, amount, category:editCategory, date})
    });
    if (!res.ok) throw new Error();
    closeModal();
    showToast('✓ Expense updated');
    loadExpenses();
    if (historyOpen) loadHistory();
  } catch { showToast('Update failed','error'); }
}

/* ══════════════════════════════════════════════════════════════════════════
   HISTORY
   ══════════════════════════════════════════════════════════════════════════ */
async function loadHistory() {
  historyList.innerHTML = `<div class="loading-wrap" style="padding:30px"><div class="spinner"></div></div>`;
  try {
    const res  = await fetch(`${API}/history?limit=80`, {credentials:'include'});
    const data = await res.json();
    renderHistory(data.history);
  } catch { historyList.innerHTML = '<div style="color:var(--dim);font-size:11px;padding:12px">Failed to load</div>'; }
}

function renderHistory(items) {
  if (!items.length) {
    historyList.innerHTML = '<div class="empty-breakdown">No activity yet</div>';
    return;
  }
  historyList.innerHTML = items.map(h => `
    <div class="history-item">
      <div class="history-action action-${h.action}">${h.action}</div>
      <div class="history-detail">${escHtml(h.detail)}</div>
      <div class="history-time">${h.timestamp} UTC</div>
    </div>`).join('');
}

function toggleHistory() {
  historyOpen = !historyOpen;
  historyPanel.classList.toggle('open', historyOpen);
  document.querySelector('.hdr-btn')?.classList.toggle('active', historyOpen);
  if (historyOpen) loadHistory();
}

/* ══════════════════════════════════════════════════════════════════════════
   RENDER
   ══════════════════════════════════════════════════════════════════════════ */
function renderList() {
  if (!expenses.length) {
    expenseList.innerHTML = `<div class="empty-state"><div class="empty-icon">◈</div>No expenses found</div>`;
    return;
  }
  expenseList.innerHTML = expenses.map(e => `
    <div class="expense-row" data-id="${e.id}">
      <div class="exp-accent" style="background:${CAT_COLORS[e.category]||'#6b7280'}"></div>
      <div class="exp-info">
        <div class="exp-desc">${escHtml(e.description)}</div>
        <div class="exp-meta">
          <span class="exp-cat-tag" style="color:${CAT_COLORS[e.category]||'#6b7280'}">${e.category}</span>
          <span class="exp-date">${e.date}</span>
        </div>
      </div>
      <div class="exp-amount">${fmt(e.amount)}</div>
      <div class="exp-actions">
        <button class="icon-btn edit-btn" onclick="openEdit('${e.id}')" title="Edit">✎</button>
        <button class="icon-btn del-btn"  onclick="deleteExpense('${e.id}')" title="Delete">×</button>
      </div>
    </div>`).join('');
}

function renderBreakdown(byCat, total) {
  if (!Object.keys(byCat).length) {
    breakdown.innerHTML = '<div class="empty-breakdown">No data yet</div>';
    return;
  }
  breakdown.innerHTML = Object.entries(byCat)
    .sort(([,a],[,b])=>b-a)
    .map(([cat,amount]) => {
      const pct = total ? (amount/total*100).toFixed(1) : 0;
      return `
        <div class="breakdown-row">
          <div class="breakdown-meta">
            <span class="dot" style="background:${CAT_COLORS[cat]||'#6b7280'}"></span>
            <span class="breakdown-cat">${cat}</span>
            <span class="breakdown-amt">${fmt(amount)}</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${pct}%;background:${CAT_COLORS[cat]||'#6b7280'}"></div>
          </div>
        </div>`;
    }).join('');
}

function renderFilterButtons(categories) {
  const allCats = ['All',...categories];
  const existing = [...filterRow.querySelectorAll('.fbtn')].map(b=>b.dataset.cat);
  if (JSON.stringify(existing)===JSON.stringify(allCats.map(String))) {
    filterRow.querySelectorAll('.fbtn').forEach(b=>b.classList.toggle('active',b.dataset.cat===filterCat));
    return;
  }
  const label = filterRow.querySelector('.ctrl-label');
  filterRow.innerHTML = '';
  filterRow.appendChild(label);
  allCats.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'fbtn'+(cat===filterCat?' active':'');
    btn.textContent = cat;
    btn.dataset.cat = cat;
    btn.onclick = ()=>{ filterCat=cat; loadExpenses(); };
    filterRow.appendChild(btn);
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   CATEGORY GRID BUILDER
   ══════════════════════════════════════════════════════════════════════════ */
function buildCatGrid(containerId, selected, onChange) {
  const grid = $(containerId);
  grid.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'cat-btn'+(cat===selected?' selected':'');
    btn.textContent = cat;
    btn.style.borderColor = cat===selected ? CAT_COLORS[cat] : '';
    btn.style.color       = cat===selected ? CAT_COLORS[cat] : '';
    btn.onclick = ()=>{ onChange(cat); buildCatGrid(containerId,cat,onChange); };
    grid.appendChild(btn);
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   MODAL
   ══════════════════════════════════════════════════════════════════════════ */
function openEdit(id) {
  const e = expenses.find(x=>x.id===id);
  if (!e) return;
  $('editId').value     = e.id;
  $('editDesc').value   = e.description;
  $('editAmount').value = e.amount;
  $('editDate').value   = e.date;
  editCategory = e.category;
  buildCatGrid('editCatGrid', editCategory, v=>{editCategory=v;});
  modalOverlay.classList.add('open');
  setTimeout(()=>$('editDesc').focus(),100);
}
function closeModal() { modalOverlay.classList.remove('open'); }

/* ══════════════════════════════════════════════════════════════════════════
   EVENT WIRING
   ══════════════════════════════════════════════════════════════════════════ */
addBtn.onclick = addExpense;
inpDesc.addEventListener('keydown',   e=>e.key==='Enter'&&addExpense());
inpAmount.addEventListener('keydown', e=>e.key==='Enter'&&addExpense());

// Enter key on auth forms
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const lf = $('loginForm');
    if (lf && lf.style.display !== 'none' && authScreen.style.display !== 'none') doLogin();
    const rf = $('registerForm');
    if (rf && rf.style.display !== 'none' && authScreen.style.display !== 'none') doRegister();
  }
  if (e.key === 'Escape') closeModal();
});

document.querySelectorAll('[data-sort]').forEach(btn => {
  btn.onclick = ()=>{
    sortBy = btn.dataset.sort;
    document.querySelectorAll('[data-sort]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    loadExpenses();
  };
});

$('cancelEdit').onclick = closeModal;
$('saveEdit').onclick   = saveEdit;
modalOverlay.addEventListener('click', e=>{ if(e.target===modalOverlay) closeModal(); });

/* ══════════════════════════════════════════════════════════════════════════
   BOOT — check if already logged in
   ══════════════════════════════════════════════════════════════════════════ */
checkSession();
