/* Pocket Pilot — personal budget tracker (client-only, localStorage) */
(function () {
  'use strict';

  const STORAGE_KEY = 'pocket-pilot/v1';
  const API_BASE = 'https://pocket-pilot-api-634g.onrender.com';
  let currentUser = null;

  // ---------- API LAYER ----------
  const api = {
    async request(method, path, data) {
      const token = localStorage.getItem('pp-auth-token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      const opts = { method, headers };
      if (data !== undefined) opts.body = JSON.stringify(data);
      const res = await fetch(API_BASE + path, opts);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }
      return res.json();
    },
    get:  (path)       => api.request('GET',    path),
    post: (path, data) => api.request('POST',   path, data),
    put:  (path, data) => api.request('PUT',    path, data),
    del:  (path)       => api.request('DELETE', path),
  };

  async function loadFromAPI() {
    const [categories, transactions, budgets, goals, investments] = await Promise.all([
      api.get('/api/categories'),
      api.get('/api/transactions'),
      api.get('/api/budgets'),
      api.get('/api/goals'),
      api.get('/api/investments'),
    ]);
    // Convert budgets array [{month, categoryId, amount}] → {yyyymm: {catId: amount}}
    const budgetMap = {};
    budgets.forEach(b => {
      if (!budgetMap[b.month]) budgetMap[b.month] = {};
      budgetMap[b.month][b.categoryId] = b.amount;
    });
    // Seed default categories for new accounts
    let cats = categories;
    if (cats.length === 0) {
      for (const cat of DEFAULT_CATEGORIES) {
        await api.post('/api/categories', cat);
      }
      cats = DEFAULT_CATEGORIES.slice();
    }
    const savedSettings = JSON.parse(localStorage.getItem('pp-settings') || '{}');
    state = {
      categories: cats,
      transactions,
      budgets: budgetMap,
      goals,
      investments,
      settings: { currency: 'USD', ...savedSettings },
    };
  }

  const DEFAULT_CATEGORIES = [
    { id: 'cat-groceries',    name: 'Groceries',      type: 'expense', color: '#10b981', icon: '🛒' },
    { id: 'cat-dining',       name: 'Dining',         type: 'expense', color: '#f59e0b', icon: '🍔' },
    { id: 'cat-transport',    name: 'Transport',      type: 'expense', color: '#3b82f6', icon: '🚗' },
    { id: 'cat-housing',      name: 'Housing',        type: 'expense', color: '#8b5cf6', icon: '🏠' },
    { id: 'cat-utilities',    name: 'Utilities',      type: 'expense', color: '#06b6d4', icon: '💡' },
    { id: 'cat-entertainment',name: 'Entertainment',  type: 'expense', color: '#ec4899', icon: '🎬' },
    { id: 'cat-health',       name: 'Health',         type: 'expense', color: '#ef4444', icon: '❤️' },
    { id: 'cat-shopping',     name: 'Shopping',       type: 'expense', color: '#a855f7', icon: '🛍️' },
    { id: 'cat-subscriptions',name: 'Subscriptions',  type: 'expense', color: '#14b8a6', icon: '🔁' },
    { id: 'cat-other-exp',    name: 'Other',          type: 'expense', color: '#64748b', icon: '•' },
    { id: 'cat-salary',       name: 'Salary',         type: 'income',  color: '#22c55e', icon: '💼' },
    { id: 'cat-freelance',    name: 'Freelance',      type: 'income',  color: '#84cc16', icon: '💻' },
    { id: 'cat-other-inc',    name: 'Other income',   type: 'income',  color: '#0ea5e9', icon: '✨' },
  ];

  /** @typedef {{id:string,name:string,type:'expense'|'income',color:string,icon:string}} Category */
  /** @typedef {{id:string,date:string,amount:number,type:'expense'|'income',categoryId:string,description:string,notes?:string}} Transaction */
  /** @typedef {{[categoryId:string]: number}} BudgetMap */
  /** @typedef {{categories:Category[],transactions:Transaction[],budgets:{[yyyymm:string]:BudgetMap},settings:{currency:string}}} AppState */

  /** @type {AppState} */
  let state = { categories: [], transactions: [], budgets: {}, goals: [], investments: [], settings: { currency: 'USD' } };

  // Current month being viewed (YYYY-MM)
  let currentMonth = yyyymm(new Date());
  let currentView = 'dashboard';
  let categoryChart = null;

  // ---------- STORAGE ----------
  // State is now loaded from the API; only settings remain in localStorage.
  function saveState() {
    localStorage.setItem('pp-settings', JSON.stringify(state.settings));
  }

  // ---------- UTILS ----------
  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }
  function yyyymm(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }
  function parseYYYYMM(s) {
    const [y, m] = s.split('-').map(Number);
    return new Date(y, m - 1, 1);
  }
  function shiftMonth(s, delta) {
    const d = parseYYYYMM(s);
    d.setMonth(d.getMonth() + delta);
    return yyyymm(d);
  }
  function monthLabel(s) {
    return parseYYYYMM(s).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function fmtMoney(n, { signed = false } = {}) {
    const currency = state.settings.currency || 'USD';
    const amount = Math.abs(n);
    let formatted;
    try {
      formatted = new Intl.NumberFormat(undefined, {
        style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      formatted = `$${amount.toFixed(2)}`;
    }
    if (signed) return (n < 0 ? '-' : n > 0 ? '+' : '') + formatted;
    return (n < 0 ? '-' : '') + formatted;
  }
  function fmtDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function getCategory(id) {
    return state.categories.find(c => c.id === id);
  }
  function txMonth(t) { return t.date.slice(0, 7); }
  function txInMonth(month) {
    return state.transactions.filter(t => txMonth(t) === month);
  }

  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    // Restart animation
    el.style.animation = 'none';
    void el.offsetHeight;
    el.style.animation = '';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { el.hidden = true; }, 3000);
  }

  // ---------- RENDER: MONTH/NAV ----------
  function renderMonthLabel() {
    document.getElementById('current-month').textContent = monthLabel(currentMonth);
    document.getElementById('dashboard-subtitle').textContent = `Your ${monthLabel(currentMonth)} snapshot.`;
    document.getElementById('tx-subtitle').textContent = `Showing ${monthLabel(currentMonth)}.`;
  }

  function setView(view) {
    currentView = view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${view}`).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => {
      n.classList.toggle('active', n.dataset.view === view);
    });
    renderCurrentView();
  }

  function renderCurrentView() {
    renderMonthLabel();
    if (currentView === 'dashboard') renderDashboard();
    else if (currentView === 'transactions') renderTransactions();
    else if (currentView === 'cashflow') renderCashFlow();
    else if (currentView === 'budgets') renderBudgets();
    else if (currentView === 'goals') renderGoals();
    else if (currentView === 'investments') renderInvestments();
    else if (currentView === 'categories') renderCategories();
    else if (currentView === 'settings') renderSettings();
  }

  // ---------- RENDER: DASHBOARD ----------
  function renderDashboard() {
    const monthTx = txInMonth(currentMonth);
    const income = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expenses = monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const net = income - expenses;

    const budgetMap = state.budgets[currentMonth] ?? {};
    const totalBudget = Object.values(budgetMap).reduce((s, v) => s + (Number(v) || 0), 0);
    const remaining = totalBudget - expenses;

    document.getElementById('stat-income').textContent = fmtMoney(income);
    document.getElementById('stat-expenses').textContent = fmtMoney(expenses);
    const netEl = document.getElementById('stat-net');
    netEl.textContent = fmtMoney(net, { signed: true });
    netEl.classList.toggle('income', net > 0);
    netEl.classList.toggle('expense', net < 0);

    const remainingEl = document.getElementById('stat-remaining');
    if (totalBudget === 0) {
      remainingEl.textContent = '—';
      remainingEl.classList.remove('income', 'expense');
    } else {
      remainingEl.textContent = fmtMoney(remaining, { signed: true });
      remainingEl.classList.toggle('income', remaining >= 0);
      remainingEl.classList.toggle('expense', remaining < 0);
    }

    renderCategoryChart(monthTx);
    renderBudgetProgress(monthTx, budgetMap);
    renderRecentTransactions(monthTx);
  }

  function renderCategoryChart(monthTx) {
    const wrap = document.querySelector('#view-dashboard .chart-wrap');
    const byCat = new Map();
    monthTx.filter(t => t.type === 'expense').forEach(t => {
      byCat.set(t.categoryId, (byCat.get(t.categoryId) ?? 0) + t.amount);
    });
    const entries = [...byCat.entries()]
      .map(([id, amt]) => ({ cat: getCategory(id), amt }))
      .filter(e => e.cat)
      .sort((a, b) => b.amt - a.amt);

    if (entries.length === 0) {
      wrap.classList.add('empty');
      if (categoryChart) { categoryChart.destroy(); categoryChart = null; }
      return;
    }
    wrap.classList.remove('empty');

    const ctx = document.getElementById('chart-category').getContext('2d');
    const labels = entries.map(e => e.cat.name);
    const data = entries.map(e => e.amt);
    const colors = entries.map(e => e.cat.color);

    if (categoryChart) categoryChart.destroy();
    categoryChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data, backgroundColor: colors, borderColor: '#171a22', borderWidth: 2 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            position: 'right',
            labels: { color: '#9aa1b2', boxWidth: 12, padding: 10, font: { size: 12 } },
          },
          tooltip: {
            callbacks: {
              label: (c) => `${c.label}: ${fmtMoney(c.parsed)}`,
            },
          },
        },
      },
    });
  }

  function renderBudgetProgress(monthTx, budgetMap) {
    const container = document.getElementById('budget-progress');
    const budgetedCats = state.categories.filter(c => c.type === 'expense' && Number(budgetMap[c.id]) > 0);
    if (budgetedCats.length === 0) {
      container.innerHTML = `<div class="empty-state">No budgets set for ${monthLabel(currentMonth)}.<br><button class="link" data-view-link="budgets">Set budgets →</button></div>`;
      return;
    }
    const spentMap = new Map();
    monthTx.filter(t => t.type === 'expense').forEach(t => {
      spentMap.set(t.categoryId, (spentMap.get(t.categoryId) ?? 0) + t.amount);
    });

    container.innerHTML = budgetedCats.map(c => {
      const budget = Number(budgetMap[c.id]) || 0;
      const spent = spentMap.get(c.id) ?? 0;
      const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
      const over = spent > budget;
      const fillColor = over ? 'var(--danger)' : c.color;
      return `
        <div class="budget-row ${over ? 'over' : ''}">
          <div class="bp-head">
            <div class="bp-name">
              <span class="bp-dot" style="background:${c.color}"></span>
              ${escapeHTML(c.name)}
            </div>
            <div class="bp-amounts">${fmtMoney(spent)} / ${fmtMoney(budget)}</div>
          </div>
          <div class="bp-bar"><div class="bp-fill" style="width:${pct}%;background:${fillColor}"></div></div>
        </div>
      `;
    }).join('');
  }

  function renderRecentTransactions(monthTx) {
    const container = document.getElementById('recent-transactions');
    const recent = [...monthTx].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
    if (recent.length === 0) {
      container.innerHTML = `<div class="empty-state">No transactions yet this month.</div>`;
      return;
    }
    container.innerHTML = recent.map(renderTxRow).join('');
    bindTxRowClicks(container);
  }

  // ---------- RENDER: TRANSACTIONS ----------
  function renderTransactions() {
    const container = document.getElementById('transactions-list');
    const search = document.getElementById('tx-search').value.trim().toLowerCase();
    const filterCat = document.getElementById('tx-filter-category').value;
    const filterType = document.getElementById('tx-filter-type').value;

    let list = txInMonth(currentMonth);
    if (filterCat) list = list.filter(t => t.categoryId === filterCat);
    if (filterType) list = list.filter(t => t.type === filterType);
    if (search) {
      list = list.filter(t =>
        t.description.toLowerCase().includes(search) ||
        (t.notes ?? '').toLowerCase().includes(search)
      );
    }
    list.sort((a, b) => b.date.localeCompare(a.date));

    if (list.length === 0) {
      container.innerHTML = `<div class="empty-state">No transactions match. Try adding one with the button above.</div>`;
      return;
    }
    container.innerHTML = list.map(renderTxRow).join('');
    bindTxRowClicks(container);
  }

  function renderTxRow(t) {
    const cat = getCategory(t.categoryId) ?? { name: 'Unknown', color: '#64748b', icon: '?' };
    const sign = t.type === 'income' ? '+' : '−';
    const amtClass = t.type === 'income' ? 'income' : 'expense';
    return `
      <div class="tx-row" data-tx-id="${t.id}">
        <div class="tx-icon" style="background:${cat.color}">${escapeHTML(cat.icon || '•')}</div>
        <div class="tx-main">
          <div class="tx-desc">${escapeHTML(t.description)}</div>
          <div class="tx-sub">${escapeHTML(cat.name)}${t.notes ? ' · ' + escapeHTML(t.notes) : ''}</div>
        </div>
        <div class="tx-date">${fmtDate(t.date)}</div>
        <div class="tx-amount ${amtClass}">${sign} ${fmtMoney(t.amount)}</div>
      </div>
    `;
  }

  function bindTxRowClicks(container) {
    container.querySelectorAll('.tx-row').forEach(row => {
      row.addEventListener('click', () => {
        const tx = state.transactions.find(t => t.id === row.dataset.txId);
        if (tx) openTxModal(tx);
      });
    });
  }

  // ---------- RENDER: BUDGETS ----------
  function renderBudgets() {
    const container = document.getElementById('budgets-list');
    const monthTx = txInMonth(currentMonth);
    const budgetMap = state.budgets[currentMonth] ?? {};
    const expenseCats = state.categories.filter(c => c.type === 'expense');

    const spentMap = new Map();
    monthTx.filter(t => t.type === 'expense').forEach(t => {
      spentMap.set(t.categoryId, (spentMap.get(t.categoryId) ?? 0) + t.amount);
    });

    if (expenseCats.length === 0) {
      container.innerHTML = `<div class="empty-state">Create an expense category first.</div>`;
      return;
    }

    container.innerHTML = expenseCats.map(c => {
      const budget = Number(budgetMap[c.id]) || 0;
      const spent = spentMap.get(c.id) ?? 0;
      const over = budget > 0 && spent > budget;
      return `
        <div class="budget-edit-row" data-cat-id="${c.id}">
          <div class="tx-icon" style="background:${c.color}">${escapeHTML(c.icon || '•')}</div>
          <div class="bel-name">${escapeHTML(c.name)}</div>
          <div class="bel-spent ${over ? 'over' : ''}">Spent ${fmtMoney(spent)}</div>
          <div class="bel-input">
            <input type="number" min="0" step="0.01"
              value="${budget || ''}"
              data-budget-cat="${c.id}"
              placeholder="Monthly budget" />
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('input[data-budget-cat]').forEach(input => {
      input.addEventListener('change', async () => {
        const catId = input.dataset.budgetCat;
        const val = parseFloat(input.value);
        if (!state.budgets[currentMonth]) state.budgets[currentMonth] = {};
        try {
          if (!val || val <= 0) {
            delete state.budgets[currentMonth][catId];
          } else {
            await api.post('/api/budgets', { month: currentMonth, categoryId: catId, amount: val });
            state.budgets[currentMonth][catId] = val;
          }
          renderBudgets();
          showToast('Budget updated');
        } catch (err) { showToast('Error: ' + err.message); }
      });
    });
  }

  // ---------- RENDER: CATEGORIES ----------
  function renderCategories() {
    const container = document.getElementById('categories-list');
    if (state.categories.length === 0) {
      container.innerHTML = `<div class="empty-state">No categories yet.</div>`;
      return;
    }
    const sorted = [...state.categories].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'expense' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    container.innerHTML = sorted.map(c => `
      <div class="cat-row">
        <div class="cat-icon" style="background:${c.color}">${escapeHTML(c.icon || '•')}</div>
        <div>
          <div style="font-weight:500">${escapeHTML(c.name)}</div>
        </div>
        <div class="cat-type ${c.type === 'income' ? 'income' : ''}">${c.type}</div>
        <div class="cat-actions">
          <button class="btn" data-edit-cat="${c.id}">Edit</button>
        </div>
      </div>
    `).join('');
    container.querySelectorAll('[data-edit-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cat = getCategory(btn.dataset.editCat);
        if (cat) openCategoryModal(cat);
      });
    });
  }

  // ---------- RENDER: SETTINGS ----------
  function renderSettings() {
    document.getElementById('setting-currency').value = state.settings.currency || 'USD';
  }

  // ---------- MODALS: TRANSACTION ----------
  function openTxModal(tx = null) {
    const modal = document.getElementById('tx-modal');
    const form = document.getElementById('tx-form');
    const title = document.getElementById('tx-modal-title');
    const deleteBtn = document.getElementById('tx-delete');

    populateCategorySelect(form.elements.categoryId);

    if (tx) {
      title.textContent = 'Edit transaction';
      form.elements.id.value = tx.id;
      form.elements.amount.value = tx.amount;
      form.elements.description.value = tx.description;
      form.elements.date.value = tx.date;
      form.elements.categoryId.value = tx.categoryId;
      form.elements.notes.value = tx.notes ?? '';
      form.querySelector(`input[name="type"][value="${tx.type}"]`).checked = true;
      deleteBtn.hidden = false;
    } else {
      title.textContent = 'New transaction';
      form.reset();
      form.elements.id.value = '';
      form.elements.date.value = currentMonth === yyyymm(new Date())
        ? todayISO()
        : `${currentMonth}-01`;
      form.querySelector('input[name="type"][value="expense"]').checked = true;
      deleteBtn.hidden = true;
    }
    modal.hidden = false;
    setTimeout(() => form.elements.amount.focus(), 50);
  }

  function populateCategorySelect(select, { includeAll = false } = {}) {
    const prev = select.value;
    select.innerHTML = '';
    if (includeAll) {
      const opt = document.createElement('option');
      opt.value = ''; opt.textContent = 'All categories';
      select.appendChild(opt);
    }
    const grouped = {
      expense: state.categories.filter(c => c.type === 'expense').sort((a, b) => a.name.localeCompare(b.name)),
      income: state.categories.filter(c => c.type === 'income').sort((a, b) => a.name.localeCompare(b.name)),
    };
    for (const [group, cats] of Object.entries(grouped)) {
      if (cats.length === 0) continue;
      const og = document.createElement('optgroup');
      og.label = group === 'expense' ? 'Expense' : 'Income';
      cats.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.icon ? c.icon + ' ' : ''}${c.name}`;
        opt.dataset.type = c.type;
        og.appendChild(opt);
      });
      select.appendChild(og);
    }
    if (prev) select.value = prev;
  }

  function closeModals() {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.hidden = true);
  }

  async function handleTxSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const amount = parseFloat(data.amount);
    if (!amount || amount <= 0) return;

    const tx = {
      id: data.id || uid('tx'),
      date: data.date,
      amount,
      type: data.type,
      categoryId: data.categoryId,
      description: data.description.trim(),
      notes: (data.notes || '').trim() || undefined,
    };

    try {
      const idx = state.transactions.findIndex(t => t.id === tx.id);
      if (idx >= 0) {
        await api.put(`/api/transactions/${tx.id}`, tx);
        state.transactions[idx] = tx;
      } else {
        await api.post('/api/transactions', tx);
        state.transactions.push(tx);
      }
      closeModals();
      showToast(idx >= 0 ? 'Transaction updated' : 'Transaction added');
      currentMonth = txMonth(tx);
      renderCurrentView();
    } catch (err) { showToast('Error: ' + err.message); }
  }

  async function handleTxDelete() {
    const form = document.getElementById('tx-form');
    const id = form['id'].value;
    if (!id || !confirm('Delete this transaction?')) return;
    try {
      await api.del(`/api/transactions/${id}`);
      state.transactions = state.transactions.filter(t => t.id !== id);
      closeModals();
      showToast('Transaction deleted');
      renderCurrentView();
    } catch (err) { showToast('Error: ' + err.message); }
  }

  // ---------- MODALS: CATEGORY ----------
  function openCategoryModal(cat = null) {
    const modal = document.getElementById('cat-modal');
    const form = document.getElementById('cat-form');
    const title = document.getElementById('cat-modal-title');
    const deleteBtn = document.getElementById('cat-delete');

    if (cat) {
      title.textContent = 'Edit category';
      form.elements.id.value = cat.id;
      form.elements.name.value = cat.name;
      form.elements.type.value = cat.type;
      form.elements.color.value = cat.color;
      form.elements.icon.value = cat.icon ?? '';
      deleteBtn.hidden = false;
    } else {
      title.textContent = 'New category';
      form.reset();
      form.elements.id.value = '';
      form.elements.color.value = '#8b5cf6';
      deleteBtn.hidden = true;
    }
    modal.hidden = false;
    setTimeout(() => form.elements.name.focus(), 50);
  }

  async function handleCategorySubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const cat = {
      id: data.id || uid('cat'),
      name: data.name.trim(),
      type: data.type,
      color: data.color,
      icon: (data.icon || '').trim() || '•',
    };
    if (!cat.name) return;
    try {
      const idx = state.categories.findIndex(c => c.id === cat.id);
      if (idx >= 0) {
        await api.put(`/api/categories/${cat.id}`, cat);
        state.categories[idx] = cat;
      } else {
        await api.post('/api/categories', cat);
        state.categories.push(cat);
      }
      closeModals();
      showToast(idx >= 0 ? 'Category updated' : 'Category added');
      refreshCategoryFilter();
      renderCurrentView();
    } catch (err) { showToast('Error: ' + err.message); }
  }

  async function handleCategoryDelete() {
    const form = document.getElementById('cat-form');
    const id = form['id'].value;
    if (!id) return;
    const usedBy = state.transactions.filter(t => t.categoryId === id).length;
    const msg = usedBy
      ? `This category is used by ${usedBy} transaction(s). They will be moved to "Other". Continue?`
      : 'Delete this category?';
    if (!confirm(msg)) return;
    try {
      await api.del(`/api/categories/${id}`);
      const cat = getCategory(id);
      if (cat && usedBy) {
        const fallback =
          state.categories.find(c => c.type === cat.type && c.name.toLowerCase().startsWith('other') && c.id !== id) ||
          state.categories.find(c => c.type === cat.type && c.id !== id);
        if (fallback) state.transactions.forEach(t => { if (t.categoryId === id) t.categoryId = fallback.id; });
      }
      state.categories = state.categories.filter(c => c.id !== id);
      Object.values(state.budgets).forEach(m => { delete m[id]; });
      closeModals();
      showToast('Category deleted');
      refreshCategoryFilter();
      renderCurrentView();
    } catch (err) { showToast('Error: ' + err.message); }
  }

  // ---------- RENDER: CASH FLOW ----------
  let cashflowChart = null;

  function getMonthlyTotals(numMonths = 6) {
    const months = [];
    const now = new Date();
    for (let i = numMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(yyyymm(d));
    }
    return months.map(m => {
      const tx = txInMonth(m);
      const income = tx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
      const spend = tx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
      return { month: m, income, spend, net: income - spend };
    });
  }

  function renderCashFlow() {
    const months = getMonthlyTotals(6);
    const totalIncome = months.reduce((s, m) => s + m.income, 0);
    const totalSpend = months.reduce((s, m) => s + m.spend, 0);
    const totalNet = totalIncome - totalSpend;
    const savingsRate = totalIncome > 0 ? (totalNet / totalIncome) * 100 : null;

    document.getElementById('cf-income').textContent = fmtMoney(totalIncome);
    document.getElementById('cf-spend').textContent = fmtMoney(totalSpend);
    const netEl = document.getElementById('cf-net');
    netEl.textContent = fmtMoney(totalNet, { signed: true });
    netEl.classList.toggle('income', totalNet > 0);
    netEl.classList.toggle('expense', totalNet < 0);

    const rateEl = document.getElementById('cf-rate');
    if (savingsRate === null) {
      rateEl.textContent = '—';
      rateEl.classList.remove('income', 'expense');
    } else {
      rateEl.textContent = `${savingsRate.toFixed(0)}%`;
      rateEl.classList.toggle('income', savingsRate >= 0);
      rateEl.classList.toggle('expense', savingsRate < 0);
    }

    // Chart
    const wrap = document.querySelector('#view-cashflow .chart-wrap');
    const hasData = months.some(m => m.income > 0 || m.spend > 0);
    if (!hasData) {
      wrap.classList.add('empty');
      if (cashflowChart) { cashflowChart.destroy(); cashflowChart = null; }
    } else {
      wrap.classList.remove('empty');
      const ctx = document.getElementById('chart-cashflow').getContext('2d');
      const labels = months.map(m => parseYYYYMM(m.month).toLocaleDateString(undefined, { month: 'short' }));
      if (cashflowChart) cashflowChart.destroy();
      cashflowChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Income', data: months.map(m => m.income), backgroundColor: '#34d399', borderRadius: 4 },
            { label: 'Spend',  data: months.map(m => m.spend),  backgroundColor: '#f87171', borderRadius: 4 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: '#9aa1b2', boxWidth: 12, padding: 10 } },
            tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtMoney(c.parsed.y)}` } },
          },
          scales: {
            x: { ticks: { color: '#9aa1b2' }, grid: { color: '#242833' } },
            y: { ticks: { color: '#9aa1b2', callback: (v) => fmtMoney(v).replace(/\.\d+/, '') }, grid: { color: '#242833' } },
          },
        },
      });
    }

    // Breakdown table
    const headerRow = `
      <div class="cf-row cf-header">
        <div>Month</div><div>Income</div><div>Spend</div><div>Net</div><div>Savings rate</div>
      </div>`;
    const rows = [...months].reverse().map(m => {
      const rate = m.income > 0 ? (m.net / m.income) * 100 : null;
      return `
        <div class="cf-row">
          <div class="cf-month">${escapeHTML(monthLabel(m.month))}</div>
          <div class="cf-income-cell">${fmtMoney(m.income)}</div>
          <div class="cf-spend-cell">${fmtMoney(m.spend)}</div>
          <div class="cf-net-cell ${m.net >= 0 ? 'cf-income-cell' : 'cf-spend-cell'}">${fmtMoney(m.net, { signed: true })}</div>
          <div class="cf-rate-cell">${rate === null ? '—' : rate.toFixed(0) + '%'}</div>
        </div>`;
    }).join('');
    document.getElementById('cashflow-table').innerHTML = headerRow + rows;
  }

  // ---------- RENDER: GOALS ----------
  function renderGoals() {
    const goals = state.goals;
    const totalSaved = goals.reduce((s, g) => s + (g.currentAmount || 0), 0);
    const totalTarget = goals.reduce((s, g) => s + (g.targetAmount || 0), 0);
    const completeCount = goals.filter(g => g.currentAmount >= g.targetAmount && g.targetAmount > 0).length;

    document.getElementById('goal-saved').textContent = fmtMoney(totalSaved);
    document.getElementById('goal-target').textContent = fmtMoney(totalTarget);
    document.getElementById('goal-complete').textContent = `${completeCount} / ${goals.length}`;

    const container = document.getElementById('goals-list');
    if (goals.length === 0) {
      container.innerHTML = `<div class="empty-state">No goals yet. Create one to start tracking your savings.</div>`;
      return;
    }

    container.innerHTML = goals.map(g => {
      const target = Number(g.targetAmount) || 0;
      const current = Number(g.currentAmount) || 0;
      const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
      const remaining = Math.max(0, target - current);
      const done = target > 0 && current >= target;

      let paceText = '';
      let paceClass = '';
      if (done) {
        paceText = 'Goal reached!';
        paceClass = 'done';
      } else if (g.deadline) {
        const deadline = new Date(g.deadline);
        const now = new Date();
        const daysLeft = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));
        if (daysLeft <= 0) {
          paceText = `Past target date · ${fmtMoney(remaining)} short`;
          paceClass = 'behind';
        } else {
          const monthsLeft = Math.max(1, Math.round(daysLeft / 30));
          const perMonth = remaining / monthsLeft;
          paceText = `${fmtMoney(perMonth)}/mo for ${monthsLeft} more month${monthsLeft === 1 ? '' : 's'}`;
        }
      } else {
        paceText = `${fmtMoney(remaining)} to go`;
      }

      const deadlineLabel = g.deadline
        ? new Date(g.deadline).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
        : null;

      const ACCOUNT_LABELS = { hysa: 'HYSA', checking: 'Checking', savings: 'Savings', other: 'Other' };
      const accountLabel = ACCOUNT_LABELS[g.accountType] || 'Savings';
      const monthly = Number(g.monthlyContribution) || 0;
      const fillColor = done ? 'var(--success)' : (g.color || 'var(--accent)');

      return `
        <div class="goal-card" data-goal-id="${g.id}">
          <div class="goal-head">
            <div class="goal-icon" style="background:${g.color || '#8b5cf6'}">${escapeHTML(g.icon || '🏦')}</div>
            <div>
              <div class="goal-name">${escapeHTML(g.name)}</div>
              <span class="goal-account-badge">${escapeHTML(accountLabel)}</span>
              ${monthly > 0 ? `<div class="goal-contribution">${fmtMoney(monthly)}/mo contribution target</div>` : ''}
            </div>
            <div class="goal-amounts">
              <div class="goal-current">${fmtMoney(current)}</div>
              <div class="goal-target">of ${fmtMoney(target)}${deadlineLabel ? ' · ' + escapeHTML(deadlineLabel) : ''}</div>
            </div>
          </div>
          <div class="goal-bar"><div class="goal-fill" style="width:${pct}%;background:${fillColor}"></div></div>
          <div class="goal-meta">
            <span>${pct.toFixed(0)}% complete</span>
            <span class="goal-pace ${paceClass}">${escapeHTML(paceText)}</span>
          </div>
        </div>`;
    }).join('');

    container.querySelectorAll('.goal-card').forEach(card => {
      card.addEventListener('click', () => {
        const goal = state.goals.find(g => g.id === card.dataset.goalId);
        if (goal) openGoalModal(goal);
      });
    });
  }

  // ---------- RENDER: INVESTMENTS ----------
  function renderInvestments() {
    const list = state.investments;
    const totalValue = list.reduce((s, i) => s + (Number(i.currentValue) || 0), 0);
    const totalCost = list.reduce((s, i) => s + (Number(i.costBasis) || 0), 0);
    const gain = totalValue - totalCost;
    const ret = totalCost > 0 ? (gain / totalCost) * 100 : null;

    document.getElementById('inv-value').textContent = fmtMoney(totalValue);
    document.getElementById('inv-cost').textContent = fmtMoney(totalCost);

    const gainEl = document.getElementById('inv-gain');
    gainEl.textContent = fmtMoney(gain, { signed: true });
    gainEl.classList.toggle('income', gain > 0);
    gainEl.classList.toggle('expense', gain < 0);

    const retEl = document.getElementById('inv-return');
    if (ret === null) {
      retEl.textContent = '—';
      retEl.classList.remove('income', 'expense');
    } else {
      retEl.textContent = `${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%`;
      retEl.classList.toggle('income', ret >= 0);
      retEl.classList.toggle('expense', ret < 0);
    }

    const container = document.getElementById('investments-list');
    if (list.length === 0) {
      container.innerHTML = `<div class="empty-state">No holdings yet. Add one to start tracking your portfolio.</div>`;
      return;
    }

    const headerRow = `
      <div class="inv-row inv-header">
        <div>Symbol</div><div>Name</div><div>Shares</div>
        <div>Cost basis</div><div>Value</div><div>Gain / loss</div>
      </div>`;

    const rows = list.map(i => {
      const cost = Number(i.costBasis) || 0;
      const val = Number(i.currentValue) || 0;
      const g = val - cost;
      const pct = cost > 0 ? (g / cost) * 100 : 0;
      const dir = g > 0 ? 'up' : g < 0 ? 'down' : '';
      return `
        <div class="inv-row" data-inv-id="${i.id}">
          <div class="inv-ticker">${escapeHTML((i.ticker || '—').toUpperCase())}</div>
          <div>
            <div class="inv-name">${escapeHTML(i.name || '')}</div>
            ${i.account ? `<div class="inv-account">${escapeHTML(i.account)}</div>` : ''}
          </div>
          <div>${i.shares ? Number(i.shares).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'}</div>
          <div>${fmtMoney(cost)}</div>
          <div>${fmtMoney(val)}</div>
          <div class="inv-gain ${dir}">${fmtMoney(g, { signed: true })}<br><span style="font-size:11px;font-weight:500">${cost > 0 ? (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%' : ''}</span></div>
        </div>`;
    }).join('');

    container.innerHTML = headerRow + rows;
    container.querySelectorAll('.inv-row[data-inv-id]').forEach(row => {
      row.addEventListener('click', () => {
        const inv = state.investments.find(i => i.id === row.dataset.invId);
        if (inv) openInvestmentModal(inv);
      });
    });
  }

  // ---------- MODALS: GOAL ----------
  function showFormError(errorElId, msg) {
    const el = document.getElementById(errorElId);
    if (!el) return;
    if (msg) { el.textContent = msg; el.hidden = false; }
    else el.hidden = true;
  }

  function openGoalModal(goal = null) {
    const modal = document.getElementById('goal-modal');
    const form = document.getElementById('goal-form');
    const title = document.getElementById('goal-modal-title');
    const deleteBtn = document.getElementById('goal-delete');

    showFormError('goal-form-error', '');
    if (goal) {
      title.textContent = 'Edit goal';
      form['id'].value = goal.id;
      form['name'].value = goal.name;
      form['accountType'].value = goal.accountType || 'savings';
      form['targetAmount'].value = goal.targetAmount || '';
      form['currentAmount'].value = goal.currentAmount || '';
      form['monthlyContribution'].value = goal.monthlyContribution || '';
      form['deadline'].value = goal.deadline || '';
      form['color'].value = goal.color || '#8b5cf6';
      form['icon'].value = goal.icon || '';
      deleteBtn.hidden = false;
    } else {
      title.textContent = 'New goal';
      form.reset();
      form['id'].value = '';
      form['color'].value = '#8b5cf6';
      deleteBtn.hidden = true;
    }
    modal.hidden = false;
    setTimeout(() => form['name'].focus(), 50);
  }

  async function handleGoalSubmit(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const name = (data.name || '').trim();
    const targetAmount = parseFloat(data.targetAmount);

    if (!name) { showFormError('goal-form-error', 'Please enter a goal name.'); return; }
    if (!targetAmount || targetAmount <= 0) { showFormError('goal-form-error', 'Please enter a target amount greater than 0.'); return; }

    showFormError('goal-form-error', '');
    const goal = {
      id: data.id || uid('goal'),
      name,
      accountType: data.accountType || 'savings',
      targetAmount,
      currentAmount: parseFloat(data.currentAmount) || 0,
      monthlyContribution: parseFloat(data.monthlyContribution) || 0,
      deadline: data.deadline || null,
      color: data.color || '#8b5cf6',
      icon: (data.icon || '').trim() || '🏦',
    };
    try {
      const idx = state.goals.findIndex(g => g.id === goal.id);
      if (idx >= 0) {
        await api.put(`/api/goals/${goal.id}`, goal);
        state.goals[idx] = goal;
      } else {
        await api.post('/api/goals', goal);
        state.goals.push(goal);
      }
      closeModals();
      showToast(idx >= 0 ? 'Goal updated' : 'Goal created');
      renderCurrentView();
    } catch (err) { showFormError('goal-form-error', err.message); }
  }

  async function handleGoalDelete() {
    const id = document.getElementById('goal-form')['id'].value;
    if (!id || !confirm('Delete this goal?')) return;
    try {
      await api.del(`/api/goals/${id}`);
      state.goals = state.goals.filter(g => g.id !== id);
      closeModals();
      showToast('Goal deleted');
      renderCurrentView();
    } catch (err) { showToast('Error: ' + err.message); }
  }

  // ---------- MODALS: INVESTMENT ----------
  function openInvestmentModal(inv = null) {
    const modal = document.getElementById('inv-modal');
    const form = document.getElementById('inv-form');
    const title = document.getElementById('inv-modal-title');
    const deleteBtn = document.getElementById('inv-delete');

    showFormError('inv-form-error', '');
    if (inv) {
      title.textContent = 'Edit holding';
      form['id'].value = inv.id;
      form['ticker'].value = inv.ticker || '';
      form['account'].value = inv.account || '';
      form['name'].value = inv.name || '';
      form['shares'].value = inv.shares || '';
      form['costBasis'].value = inv.costBasis || '';
      form['currentValue'].value = inv.currentValue || '';
      deleteBtn.hidden = false;
    } else {
      title.textContent = 'Add holding';
      form.reset();
      form['id'].value = '';
      deleteBtn.hidden = true;
    }
    modal.hidden = false;
    setTimeout(() => form['ticker'].focus(), 50);
  }

  async function handleInvestmentSubmit(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const name = (data.name || '').trim();
    const costBasis = parseFloat(data.costBasis);
    const currentValue = parseFloat(data.currentValue);

    if (!name) { showFormError('inv-form-error', 'Please enter a name or description for this holding.'); return; }
    if (!costBasis || costBasis <= 0) { showFormError('inv-form-error', 'Please enter what you paid (cost basis).'); return; }
    if (!currentValue || currentValue <= 0) { showFormError('inv-form-error', 'Please enter the current value of this holding.'); return; }

    showFormError('inv-form-error', '');
    const inv = {
      id: data.id || uid('inv'),
      ticker: (data.ticker || '').trim().toUpperCase(),
      account: (data.account || '').trim(),
      name,
      shares: parseFloat(data.shares) || 0,
      costBasis,
      currentValue,
    };
    try {
      const idx = state.investments.findIndex(i => i.id === inv.id);
      if (idx >= 0) {
        await api.put(`/api/investments/${inv.id}`, inv);
        state.investments[idx] = inv;
      } else {
        await api.post('/api/investments', inv);
        state.investments.push(inv);
      }
      closeModals();
      showToast(idx >= 0 ? 'Holding updated' : 'Holding added');
      renderCurrentView();
    } catch (err) { showFormError('inv-form-error', err.message); }
  }

  async function handleInvestmentDelete() {
    const id = document.getElementById('inv-form')['id'].value;
    if (!id || !confirm('Delete this holding?')) return;
    try {
      await api.del(`/api/investments/${id}`);
      state.investments = state.investments.filter(i => i.id !== id);
      closeModals();
      showToast('Holding deleted');
      renderCurrentView();
    } catch (err) { showToast('Error: ' + err.message); }
  }

  // ---------- CSV IMPORT — bank detection + mapping modal ----------

  const BANK_FORMATS = [
    {
      name: 'Chase',
      detect: h => h.includes('transaction date') && h.includes('post date'),
      map: { date: 'transaction date', description: 'description', amount: 'amount', notes: 'memo' },
      amountMode: 'single',
    },
    {
      name: 'Bank of America',
      detect: h => h.some(c => c.includes('running bal')),
      map: { date: 'date', description: 'description', amount: 'amount' },
      amountMode: 'single',
    },
    {
      name: 'Wells Fargo',
      detect: h => h.length <= 5 && h.includes('date') && h.includes('amount') && h.some(c => c === '*' || c === ''),
      map: { date: 'date', description: 'description', amount: 'amount' },
      amountMode: 'single',
    },
    {
      name: 'Citi',
      detect: h => h.includes('debit') && h.includes('credit') && !h.includes('card no.'),
      map: { date: 'date', description: 'description', debit: 'debit', credit: 'credit' },
      amountMode: 'debitcredit',
    },
    {
      name: 'Capital One',
      detect: h => h.includes('card no.') || (h.includes('transaction date') && h.includes('debit') && h.includes('credit')),
      map: { date: 'transaction date', description: 'description', debit: 'debit', credit: 'credit', notes: 'category' },
      amountMode: 'debitcredit',
    },
  ];

  // Holds parsed CSV state while the mapping modal is open
  let csvImportState = null;

  function openCSVImportModal(file) {
    file.text().then(text => {
      const rows = parseCSV(text);
      if (rows.length < 2) { alert('CSV appears to be empty or has only a header.'); return; }

      const rawHeaders = rows[0];
      const headers = rawHeaders.map(s => s.trim().toLowerCase());
      const dataRows = rows.slice(1).filter(r => r.some(c => c.trim() !== ''));

      // Detect bank format
      const detected = BANK_FORMATS.find(f => f.detect(headers));

      csvImportState = { headers, rawHeaders, dataRows, detected, amountMode: detected?.amountMode ?? 'single' };

      // Populate column selects
      const none = '<option value="">— skip —</option>';
      const opts = rawHeaders.map((h, i) => `<option value="${i}">${escapeHTML(h) || `Column ${i + 1}`}</option>`).join('');

      ['map-date', 'map-description', 'map-amount', 'map-debit', 'map-credit', 'map-notes'].forEach(id => {
        document.getElementById(id).innerHTML = none + opts;
      });

      // Apply detected mappings
      if (detected) {
        applyFormatMap(headers, detected.map);
        setAmountMode(detected.amountMode);
      }

      document.getElementById('csv-format-badge').textContent = detected ? detected.name + ' detected' : '';

      document.getElementById('csv-modal').hidden = false;
      updateCSVPreview();
    }).catch(e => alert('Could not read file: ' + e.message));
  }

  function applyFormatMap(headers, map) {
    for (const [field, colName] of Object.entries(map)) {
      const colIdx = headers.indexOf(colName);
      if (colIdx < 0) continue;
      const elId = field === 'debit' ? 'map-debit'
        : field === 'credit' ? 'map-credit'
        : field === 'notes' ? 'map-notes'
        : `map-${field}`;
      const el = document.getElementById(elId);
      if (el) el.value = String(colIdx);
    }
  }

  function setAmountMode(mode) {
    csvImportState.amountMode = mode;
    document.getElementById('am-single').checked = mode === 'single';
    document.getElementById('am-debitcredit').checked = mode === 'debitcredit';
    document.getElementById('map-single-row').hidden = mode !== 'single';
    document.getElementById('map-dc-row').hidden = mode !== 'debitcredit';
    document.getElementById('map-cr-row').hidden = mode !== 'debitcredit';
  }

  function getMapping() {
    const v = id => { const s = document.getElementById(id).value; return s !== '' ? Number(s) : null; };
    return {
      date: v('map-date'),
      description: v('map-description'),
      amount: v('map-amount'),
      debit: v('map-debit'),
      credit: v('map-credit'),
      notes: v('map-notes'),
      amountMode: csvImportState.amountMode,
    };
  }

  function parseCSVRow(row, m) {
    const get = idx => (idx !== null && row[idx] !== undefined ? row[idx].trim() : '');
    const dateStr = get(m.date);
    const date = normalizeDate(dateStr);
    const description = get(m.description) || 'Imported';
    let amount, type;

    if (m.amountMode === 'debitcredit') {
      const debitStr = get(m.debit).replace(/[^0-9.\-]/g, '');
      const creditStr = get(m.credit).replace(/[^0-9.\-]/g, '');
      const debit = parseFloat(debitStr);
      const credit = parseFloat(creditStr);
      if (debit > 0) { amount = debit; type = 'expense'; }
      else if (credit > 0) { amount = credit; type = 'income'; }
      else return null;
    } else {
      const raw = get(m.amount).replace(/[^0-9.\-]/g, '');
      const val = parseFloat(raw);
      if (!val) return null;
      amount = Math.abs(val);
      type = val < 0 ? 'expense' : 'income';
    }

    return { date, description, amount, type, notes: get(m.notes) || undefined };
  }

  function updateCSVPreview() {
    if (!csvImportState) return;
    const m = getMapping();
    const previewRows = csvImportState.dataRows.slice(0, 5);
    const existingHashes = buildExistingHashes();

    const tbody = previewRows.map(row => {
      const parsed = (m.date !== null && m.description !== null) ? parseCSVRow(row, m) : null;
      if (!parsed || !parsed.date) {
        return `<tr><td class="td-skip" colspan="4">— cannot parse row —</td></tr>`;
      }
      const dupe = existingHashes.has(txHash(parsed));
      const sign = parsed.type === 'income' ? '+' : '−';
      const amtClass = parsed.type === 'income' ? 'td-income' : 'td-expense';
      return `<tr>
        <td>${escapeHTML(parsed.date)}</td>
        <td title="${escapeHTML(parsed.description)}">${escapeHTML(parsed.description.slice(0, 30))}${parsed.description.length > 30 ? '…' : ''}</td>
        <td class="td-amount ${amtClass}">${sign} ${fmtMoney(parsed.amount)}</td>
        <td>${dupe ? '<span style="color:var(--text-faint)">duplicate</span>' : escapeHTML(parsed.type)}</td>
      </tr>`;
    }).join('');

    document.getElementById('csv-preview-table').innerHTML = tbody
      ? `<table class="preview-table"><thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Type</th></tr></thead><tbody>${tbody}</tbody></table>`
      : `<div class="preview-empty">Map the required columns to see a preview.</div>`;

    const total = csvImportState.dataRows.length;
    document.getElementById('csv-preview-count').textContent = `(first 5 of ${total} rows)`;

    // Count importable
    const importable = csvImportState.dataRows.reduce((n, row) => {
      const p = parseCSVRow(row, m);
      return p && p.date && !existingHashes.has(txHash(p)) ? n + 1 : n;
    }, 0);
    const dupes = csvImportState.dataRows.reduce((n, row) => {
      const p = parseCSVRow(row, m);
      return p && p.date && existingHashes.has(txHash(p)) ? n + 1 : n;
    }, 0);
    document.getElementById('btn-do-import').textContent = `Import ${importable} transaction${importable === 1 ? '' : 's'}`;
    document.getElementById('csv-import-summary').textContent =
      dupes > 0 ? `${dupes} duplicate${dupes === 1 ? '' : 's'} will be skipped` : '';
  }

  function buildExistingHashes() {
    const s = new Set();
    state.transactions.forEach(t => s.add(txHash(t)));
    return s;
  }

  function txHash(t) {
    return `${t.date}|${t.amount}|${t.description.toLowerCase()}`;
  }

  function doCSVImport() {
    if (!csvImportState) return;
    const m = getMapping();
    if (m.date === null || m.description === null) {
      alert('Please map at least the Date and Description columns.'); return;
    }
    if (m.amountMode === 'single' && m.amount === null) {
      alert('Please map the Amount column.'); return;
    }
    if (m.amountMode === 'debitcredit' && m.debit === null && m.credit === null) {
      alert('Please map at least one of Debit or Credit columns.'); return;
    }

    const existingHashes = buildExistingHashes();
    let added = 0, skipped = 0;

    csvImportState.dataRows.forEach(row => {
      const parsed = parseCSVRow(row, m);
      if (!parsed || !parsed.date) { skipped++; return; }
      if (existingHashes.has(txHash(parsed))) { skipped++; return; }

      const catName = '';
      let cat = state.categories.find(c => c.type === parsed.type && c.name.toLowerCase().startsWith('other'));
      if (!cat) cat = state.categories.find(c => c.type === parsed.type);
      if (!cat) { skipped++; return; }

      state.transactions.push({
        id: uid('tx'),
        date: parsed.date,
        amount: parsed.amount,
        type: parsed.type,
        categoryId: cat.id,
        description: parsed.description,
        notes: parsed.notes,
      });
      added++;
    });

    saveState();
    closeModals();
    csvImportState = null;
    showToast(`Imported ${added} transaction${added === 1 ? '' : 's'}${skipped ? ` · ${skipped} skipped` : ''}`);
    renderCurrentView();
  }

  // ---------- IMPORT / EXPORT ----------
  function exportJSON() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pocket-pilot-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Backup downloaded');
  }

  async function importJSON(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.categories || !Array.isArray(data.categories)) throw new Error('Invalid format');
      if (!confirm('This replaces all your current data. Continue?')) return;
      state = {
        categories: data.categories,
        transactions: data.transactions ?? [],
        budgets: data.budgets ?? {},
        goals: data.goals ?? [],
        investments: data.investments ?? [],
        settings: { currency: 'USD', ...(data.settings ?? {}) },
      };
      saveState();
      refreshCategoryFilter();
      renderCurrentView();
      renderSettings();
      showToast('Data imported');
    } catch (e) {
      alert('Could not import file: ' + e.message);
    }
  }

  function importCSV(file) {
    openCSVImportModal(file);
  }

  function normalizeDate(s) {
    if (!s) return null;
    // Accept YYYY-MM-DD or MM/DD/YYYY or M/D/YYYY
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) {
      let [, mo, d, y] = m;
      if (y.length === 2) y = (Number(y) < 70 ? '20' : '19') + y;
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    const parsed = new Date(s);
    if (!isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
    }
    return null;
  }

  function parseCSV(text) {
    const rows = [];
    let cur = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { cur.push(field); field = ''; }
        else if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && text[i + 1] === '\n') i++;
          cur.push(field); rows.push(cur);
          cur = []; field = '';
        } else field += ch;
      }
    }
    if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
    return rows;
  }

  async function resetAll() {
    if (!confirm('Delete ALL transactions, budgets, categories, and settings?')) return;
    if (!confirm('Are you sure? This cannot be undone.')) return;
    try {
      // Delete everything via API then reload fresh
      await Promise.all([
        ...state.transactions.map(t => api.del(`/api/transactions/${t.id}`)),
        ...state.goals.map(g => api.del(`/api/goals/${g.id}`)),
        ...state.investments.map(i => api.del(`/api/investments/${i.id}`)),
        ...state.categories.map(c => api.del(`/api/categories/${c.id}`)),
      ]);
      localStorage.removeItem('pp-settings');
      await loadFromAPI();
      refreshCategoryFilter();
      renderCurrentView();
      renderSettings();
      showToast('Everything reset');
    } catch (err) { showToast('Error: ' + err.message); }
  }

  // ---------- MISC ----------
  function refreshCategoryFilter() {
    const sel = document.getElementById('tx-filter-category');
    const prev = sel.value;
    sel.innerHTML = '<option value="">All categories</option>';
    const grouped = {
      expense: state.categories.filter(c => c.type === 'expense').sort((a, b) => a.name.localeCompare(b.name)),
      income: state.categories.filter(c => c.type === 'income').sort((a, b) => a.name.localeCompare(b.name)),
    };
    for (const [group, cats] of Object.entries(grouped)) {
      if (cats.length === 0) continue;
      const og = document.createElement('optgroup');
      og.label = group === 'expense' ? 'Expense' : 'Income';
      cats.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        og.appendChild(opt);
      });
      sel.appendChild(og);
    }
    if (prev) sel.value = prev;
  }

  function escapeHTML(s) {
    return String(s ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[ch]);
  }

  // ---------- BOOTSTRAP ----------

  function showLoginScreen() {
    document.getElementById('login-screen').style.display = 'grid';
  }
  function hideLoginScreen() {
    document.getElementById('login-screen').style.display = 'none';
  }

  function setLoginError(msg) {
    const el = document.getElementById('login-error');
    el.textContent = msg; el.hidden = !msg;
  }

  function showLoginTab(tab) {
    document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.login-tab[data-tab="${tab}"]`).classList.add('active');
    document.getElementById('login-form').style.display    = tab === 'login'    ? '' : 'none';
    document.getElementById('register-form').style.display = tab === 'register' ? '' : 'none';
    setLoginError('');
  }

  async function handleLogin(e) {
    e.preventDefault();
    setLoginError('');
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    try {
      const res = await api.post('/api/login', { email, password });
      if (res.token) localStorage.setItem('pp-auth-token', res.token);
      currentUser = res;
      hideLoginScreen();
      await loadFromAPI();
      initApp();
    } catch (err) { setLoginError(err.message); }
  }

  async function handleRegister(e) {
    e.preventDefault();
    setLoginError('');
    const email    = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;
    if (password.length < 8) { setLoginError('Password must be at least 8 characters.'); return; }
    try {
      const res = await api.post('/api/register', { email, password });
      if (res.token) localStorage.setItem('pp-auth-token', res.token);
      currentUser = res;
      hideLoginScreen();
      await loadFromAPI();
      initApp();
    } catch (err) { setLoginError(err.message); }
  }

  async function handleLogout() {
    localStorage.removeItem('pp-auth-token');
    currentUser = null;
    state = { categories: [], transactions: [], budgets: {}, goals: [], investments: [], settings: { currency: 'USD' } };
    showLoginScreen();
    showLoginTab('login');
  }

  async function init() {
    document.querySelectorAll('.login-tab').forEach(tab => {
      tab.addEventListener('click', () => showLoginTab(tab.dataset.tab));
    });
    showLoginTab('login');
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('register-form').addEventListener('submit', handleRegister);
    document.getElementById('btn-logout').addEventListener('click', handleLogout);

    if (!localStorage.getItem('pp-auth-token')) { showLoginScreen(); return; }
    try {
      currentUser = await api.get('/api/me');
      hideLoginScreen();
      await loadFromAPI();
      initApp();
    } catch (_) {
      localStorage.removeItem('pp-auth-token');
      showLoginScreen();
    }
  }

  function initApp() {
    // Nav buttons
    document.querySelectorAll('.nav-item:not(#btn-logout)').forEach(btn => {
      btn.addEventListener('click', () => setView(btn.dataset.view));
    });
    // "View all" style links inside panels
    document.addEventListener('click', (e) => {
      const viewLink = e.target.closest('[data-view-link]');
      if (viewLink) setView(viewLink.dataset.viewLink);
    });

    // Month nav
    document.getElementById('prev-month').addEventListener('click', () => {
      currentMonth = shiftMonth(currentMonth, -1);
      renderCurrentView();
    });
    document.getElementById('next-month').addEventListener('click', () => {
      currentMonth = shiftMonth(currentMonth, 1);
      renderCurrentView();
    });

    // Quick add / add category
    document.querySelectorAll('[data-action="quick-add"]').forEach(btn => {
      btn.addEventListener('click', () => openTxModal());
    });
    document.querySelectorAll('[data-action="add-category"]').forEach(btn => {
      btn.addEventListener('click', () => openCategoryModal());
    });
    document.querySelectorAll('[data-action="add-goal"]').forEach(btn => {
      btn.addEventListener('click', () => openGoalModal());
    });
    document.querySelectorAll('[data-action="add-investment"]').forEach(btn => {
      btn.addEventListener('click', () => openInvestmentModal());
    });

    // Modal close
    document.querySelectorAll('[data-close-modal]').forEach(el => {
      el.addEventListener('click', closeModals);
    });
    document.querySelectorAll('.modal-backdrop').forEach(bd => {
      bd.addEventListener('click', (e) => { if (e.target === bd) closeModals(); });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModals();
    });

    // Forms
    document.getElementById('tx-form').addEventListener('submit', handleTxSubmit);
    document.getElementById('tx-delete').addEventListener('click', handleTxDelete);
    document.getElementById('cat-form').addEventListener('submit', handleCategorySubmit);
    document.getElementById('cat-delete').addEventListener('click', handleCategoryDelete);
    document.getElementById('goal-form').addEventListener('submit', handleGoalSubmit);
    document.getElementById('goal-delete').addEventListener('click', handleGoalDelete);
    document.getElementById('inv-form').addEventListener('submit', handleInvestmentSubmit);
    document.getElementById('inv-delete').addEventListener('click', handleInvestmentDelete);

    // Filters
    ['tx-search', 'tx-filter-category', 'tx-filter-type'].forEach(id => {
      document.getElementById(id).addEventListener('input', renderTransactions);
    });

    // Settings
    document.getElementById('setting-currency').addEventListener('change', (e) => {
      state.settings.currency = e.target.value;
      saveState();
      renderCurrentView();
      showToast('Currency updated');
    });
    document.getElementById('btn-export').addEventListener('click', exportJSON);
    document.getElementById('file-import').addEventListener('change', (e) => {
      if (e.target.files[0]) importJSON(e.target.files[0]);
      e.target.value = '';
    });
    document.getElementById('file-import-csv').addEventListener('change', (e) => {
      if (e.target.files[0]) importCSV(e.target.files[0]);
      e.target.value = '';
    });
    document.getElementById('btn-reset').addEventListener('click', resetAll);

    // CSV mapping modal interactions
    document.getElementById('btn-do-import').addEventListener('click', doCSVImport);
    document.querySelectorAll('input[name="amount-mode"]').forEach(radio => {
      radio.addEventListener('change', () => {
        if (!csvImportState) return;
        setAmountMode(radio.value);
        updateCSVPreview();
      });
    });
    ['map-date', 'map-description', 'map-amount', 'map-debit', 'map-credit', 'map-notes'].forEach(id => {
      document.getElementById(id).addEventListener('change', updateCSVPreview);
    });

    // Drag-and-drop CSV onto the whole app
    let dragCounter = 0;
    const overlay = document.getElementById('drop-overlay');
    document.addEventListener('dragenter', (e) => {
      if ([...e.dataTransfer.items].some(i => i.kind === 'file')) {
        dragCounter++;
        overlay.hidden = false;
      }
    });
    document.addEventListener('dragleave', () => {
      dragCounter--;
      if (dragCounter <= 0) { dragCounter = 0; overlay.hidden = true; }
    });
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      overlay.hidden = true;
      const file = e.dataTransfer.files[0];
      if (!file) return;
      if (file.name.endsWith('.csv') || file.type === 'text/csv') {
        importCSV(file);
      } else if (file.name.endsWith('.json') || file.type === 'application/json') {
        importJSON(file);
      } else {
        showToast('Drop a .csv or .json file');
      }
    });

    refreshCategoryFilter();
    renderSettings();
    renderCurrentView();
  }

  // Called after successful login/register to finish app setup
  const _initApp = initApp;
  let appInitialized = false;
  initApp = function () {
    if (!appInitialized) { appInitialized = true; _initApp(); }
    else { refreshCategoryFilter(); renderSettings(); renderCurrentView(); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
