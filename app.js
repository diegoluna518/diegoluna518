/* Pocket Pilot — personal budget tracker (client-only, localStorage) */
(function () {
  'use strict';

  const STORAGE_KEY = 'pocket-pilot/v1';

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
  let state = loadState();

  // Current month being viewed (YYYY-MM)
  let currentMonth = yyyymm(new Date());
  let currentView = 'dashboard';
  let categoryChart = null;

  // ---------- STORAGE ----------
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          categories: parsed.categories ?? DEFAULT_CATEGORIES.slice(),
          transactions: parsed.transactions ?? [],
          budgets: parsed.budgets ?? {},
          settings: { currency: 'USD', ...(parsed.settings ?? {}) },
        };
      }
    } catch (e) {
      console.warn('Failed to load state', e);
    }
    return {
      categories: DEFAULT_CATEGORIES.slice(),
      transactions: [],
      budgets: {},
      settings: { currency: 'USD' },
    };
  }
  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
    else if (currentView === 'budgets') renderBudgets();
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
      input.addEventListener('change', () => {
        const catId = input.dataset.budgetCat;
        const val = parseFloat(input.value);
        if (!state.budgets[currentMonth]) state.budgets[currentMonth] = {};
        if (!val || val <= 0) {
          delete state.budgets[currentMonth][catId];
        } else {
          state.budgets[currentMonth][catId] = val;
        }
        saveState();
        renderBudgets();
        showToast('Budget updated');
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

  function handleTxSubmit(e) {
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

    const idx = state.transactions.findIndex(t => t.id === tx.id);
    if (idx >= 0) state.transactions[idx] = tx;
    else state.transactions.push(tx);

    saveState();
    closeModals();
    showToast(idx >= 0 ? 'Transaction updated' : 'Transaction added');

    // Jump view to the month of this tx so user sees it
    currentMonth = txMonth(tx);
    renderCurrentView();
  }

  function handleTxDelete() {
    const form = document.getElementById('tx-form');
    const id = form.elements.id.value;
    if (!id) return;
    if (!confirm('Delete this transaction?')) return;
    state.transactions = state.transactions.filter(t => t.id !== id);
    saveState();
    closeModals();
    showToast('Transaction deleted');
    renderCurrentView();
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

  function handleCategorySubmit(e) {
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
    const idx = state.categories.findIndex(c => c.id === cat.id);
    if (idx >= 0) state.categories[idx] = cat;
    else state.categories.push(cat);
    saveState();
    closeModals();
    showToast(idx >= 0 ? 'Category updated' : 'Category added');
    refreshCategoryFilter();
    renderCurrentView();
  }

  function handleCategoryDelete() {
    const form = document.getElementById('cat-form');
    const id = form.elements.id.value;
    if (!id) return;
    const usedBy = state.transactions.filter(t => t.categoryId === id).length;
    const msg = usedBy
      ? `This category is used by ${usedBy} transaction(s). They will be moved to "Other". Continue?`
      : 'Delete this category?';
    if (!confirm(msg)) return;

    // Reassign transactions to "Other" of same type or first of same type
    const cat = getCategory(id);
    if (cat && usedBy) {
      const fallback =
        state.categories.find(c => c.type === cat.type && c.name.toLowerCase().startsWith('other') && c.id !== id) ||
        state.categories.find(c => c.type === cat.type && c.id !== id);
      if (fallback) {
        state.transactions.forEach(t => { if (t.categoryId === id) t.categoryId = fallback.id; });
      }
    }
    state.categories = state.categories.filter(c => c.id !== id);
    // Remove any budgets for this category
    Object.values(state.budgets).forEach(m => { delete m[id]; });
    saveState();
    closeModals();
    showToast('Category deleted');
    refreshCategoryFilter();
    renderCurrentView();
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

  function resetAll() {
    if (!confirm('Delete ALL transactions, budgets, categories, and settings?')) return;
    if (!confirm('Are you sure? This cannot be undone.')) return;
    localStorage.removeItem(STORAGE_KEY);
    state = loadState();
    refreshCategoryFilter();
    renderCurrentView();
    renderSettings();
    showToast('Everything reset');
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
  function init() {
    // Nav buttons
    document.querySelectorAll('.nav-item').forEach(btn => {
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
