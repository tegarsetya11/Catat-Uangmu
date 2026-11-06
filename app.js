(() => {
  "use strict";

  const STORAGE_KEY = "catatan-keuangan-v1";
  const APP_NAME = "Catat Uangmu";
  const currency = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
  const today = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  };
  const isValidISODate = value => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00`);
    return !Number.isNaN(date.getTime()) && date.getFullYear() === Number(value.slice(0, 4)) && date.getMonth() + 1 === Number(value.slice(5, 7)) && date.getDate() === Number(value.slice(8, 10));
  };
  const isValidTime = value => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  const timeNow = () => `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`;
  const makeId = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const defaults = () => ({
    settings: { userName: "", theme: "light", dateFormat: "id-ID", timeFormat: "24h", pin: "" },
    accounts: [{ id: makeId(), name: "Uang Tunai", type: "Tunai", openingBalance: 0, color: "#1769e0" }],
    categories: [
      { id: makeId(), name: "Uang saku", type: "income" }, { id: makeId(), name: "Gaji", type: "income" },
      { id: makeId(), name: "Bonus", type: "income" }, { id: makeId(), name: "Pendapatan lainnya", type: "income" },
      { id: makeId(), name: "Makan", type: "expense" }, { id: makeId(), name: "Minuman", type: "expense" },
      { id: makeId(), name: "Transportasi", type: "expense" }, { id: makeId(), name: "Kebutuhan pribadi", type: "expense" },
      { id: makeId(), name: "Pendidikan", type: "expense" }, { id: makeId(), name: "Tagihan", type: "expense" },
      { id: makeId(), name: "Hiburan", type: "expense" }, { id: makeId(), name: "Lainnya", type: "expense" }
    ],
    transactions: [], trash: [], notes: []
  });
  let needsUserName = false;
  let state = loadState();
  let page = "home";
  let period = "all";
  let searchTerm = "";
  let reportFilters = { from: "", to: "", account: "", type: "" };
  let selectedDate = today();
  let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let calcValue = "0";
  let calcPending = null;
  let calcStored = null;
  let calcJustEvaluated = false;
  let timePickerTarget = "";
  let timePickerForm = "";
  let timePickerFormClass = "";
  let timePickerValue = { hours: 0, minutes: 0 };
  let timePickerStage = "hour";
  let timePickerFormValues = {};
  let transactionItems = [];
  let transactionReceipt = "";
  let unlocked = true;
  let deferredInstallPrompt = null;

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) { needsUserName = true; return defaults(); }
      const data = JSON.parse(saved);
      if (!data || !Array.isArray(data.accounts) || !Array.isArray(data.transactions)) throw new Error("Struktur data tidak valid.");
      const base = defaults();
      const loaded = { ...base, ...data, settings: { ...base.settings, ...data.settings }, accounts: data.accounts, categories: Array.isArray(data.categories) ? data.categories : base.categories, transactions: data.transactions, trash: Array.isArray(data.trash) ? data.trash : [], notes: Array.isArray(data.notes) ? data.notes : [] };
      if (loaded.settings.userName === "Tegar") loaded.settings.userName = "";
      needsUserName = !loaded.settings.userName?.trim();
      return loaded;
    } catch (error) {
      console.error("Gagal membaca data Catat Uangmu:", error);
      needsUserName = true;
      return defaults();
    }
  }
  function persist(message) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (error) { notify(`Data tidak dapat disimpan: ${error.message}`, true); throw error; }
    updateBrand();
    updateTrashCount();
    render();
    if (message) notify(message);
  }
  const fmt = value => currency.format(Math.round(Number(value) || 0));
  const groupedInteger = value => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const parseMoneyInput = value => Number(String(value).replace(/\D/g, ""));
  function formatMoneyField(input) {
    const raw=input.value,caret=input.selectionStart??raw.length,digitCaret=raw.slice(0,caret).replace(/\D/g,"").length,digits=raw.replace(/\D/g,"");
    const formatted=groupedInteger(digits);
    input.value=formatted;
    let nextCaret=0,count=0;
    while(nextCaret<formatted.length&&count<digitCaret){if(/\d/.test(formatted[nextCaret]))count++;nextCaret++;}
    input.setSelectionRange(nextCaret,nextCaret);
  }
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const accountById = id => state.accounts.find(account => account.id === id);
  const accountName = id => accountById(id)?.name || "Akun dihapus";
  const dateTimeValue = tx => new Date(`${tx.date}T${tx.time || "00:00"}:00`).getTime();
  const chronologicalTransactions = list => [...list].sort((a, b) => dateTimeValue(a) - dateTimeValue(b) || String(a.id).localeCompare(String(b.id)));
  const sortedTransactions = list => [...list].sort((a, b) => dateTimeValue(b) - dateTimeValue(a) || String(b.id).localeCompare(String(a.id)));
  const activeTransactions = () => state.transactions.filter(tx => tx.type !== "transfer");
  function accountBalances() {
    const balances = Object.fromEntries(state.accounts.map(account => [account.id, Number(account.openingBalance) || 0]));
    for (const tx of chronologicalTransactions(state.transactions)) {
      if (tx.type === "income" && balances[tx.accountId] !== undefined) balances[tx.accountId] += Number(tx.amount);
      if (tx.type === "expense" && balances[tx.accountId] !== undefined) balances[tx.accountId] -= Number(tx.amount);
      if (tx.type === "transfer") {
        if (balances[tx.fromAccountId] !== undefined) balances[tx.fromAccountId] -= Number(tx.amount);
        if (balances[tx.toAccountId] !== undefined) balances[tx.toAccountId] += Number(tx.amount);
      }
    }
    return balances;
  }
  function balancesAfter() {
    const balances = Object.fromEntries(state.accounts.map(account => [account.id, Number(account.openingBalance) || 0]));
    const result = {};
    for (const tx of chronologicalTransactions(state.transactions)) {
      if (tx.type === "income" && balances[tx.accountId] !== undefined) balances[tx.accountId] += Number(tx.amount);
      else if (tx.type === "expense" && balances[tx.accountId] !== undefined) balances[tx.accountId] -= Number(tx.amount);
      else if (tx.type === "transfer") {
        if (balances[tx.fromAccountId] !== undefined) balances[tx.fromAccountId] -= Number(tx.amount);
        if (balances[tx.toAccountId] !== undefined) balances[tx.toAccountId] += Number(tx.amount);
        result[tx.id] = balances[tx.toAccountId];
        continue;
      }
      result[tx.id] = balances[tx.accountId];
    }
    return result;
  }
  function totals(list = activeTransactions()) {
    return list.reduce((sum, tx) => {
      if (tx.type === "income") sum.income += Number(tx.amount);
      if (tx.type === "expense") sum.expense += Number(tx.amount);
      return sum;
    }, { income: 0, expense: 0 });
  }
  function periodTransactions() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === "week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    if (period === "month") start.setDate(1);
    if (period === "year") start.setMonth(0, 1);
    const end = new Date(start);
    if (period === "day") end.setDate(end.getDate() + 1);
    else if (period === "week") end.setDate(end.getDate() + 7);
    else if (period === "month") end.setMonth(end.getMonth() + 1);
    else if (period === "year") end.setFullYear(end.getFullYear() + 1);
    else return state.transactions;
    return state.transactions.filter(tx => {
      const txDate = new Date(`${tx.date}T00:00:00`);
      return txDate >= start && txDate < end;
    });
  }
  function formatDate(date, options = { weekday: "long", day: "2-digit", month: "long", year: "numeric" }) {
    const d = new Date(`${date}T00:00:00`);
    return Number.isNaN(d.getTime()) ? date : new Intl.DateTimeFormat(state.settings.dateFormat || "id-ID", options).format(d);
  }
  function formatTime(time) {
    if (!isValidTime(time) || state.settings.timeFormat !== "12h") return time;
    const [hours, minutes] = time.split(":").map(Number);
    return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
  }
  function notify(message, error = false) {
    const toast = document.createElement("div");
    toast.className = `toast${error ? " error" : ""}`;
    toast.textContent = message;
    document.getElementById("toast-region").append(toast);
    setTimeout(() => toast.remove(), 3200);
  }
  function updateBrand() {
    document.title = APP_NAME;
    document.querySelectorAll(".brand-name").forEach(element => { element.textContent = APP_NAME; });
    const avatar=document.getElementById("user-avatar");
    if(state.settings.profilePhoto)avatar.innerHTML=`<img src="${esc(state.settings.profilePhoto)}" alt="">`;
    else avatar.textContent=(state.settings.userName||"N").trim().charAt(0).toUpperCase();
    document.body.classList.toggle("dark-theme", state.settings.theme === "dark");
  }
  function updateTrashCount() { document.getElementById("trash-count").textContent = state.trash.length || ""; }
  const pageTitles = { home: "Lihat Uangmu", reports: "Ringkasan", accounts: "Akun", "account-summary": "Ringkasan akun", transfers: "Transfer", "all-reports": "Laporan semua akun", categories: "Nama transaksi", notes: "Buku catatan", calendar: "Kalender", calculator: "Kalkulator kas", trash: "Transaksi dihapus", backup: "Cadangkan dan pulihkan", settings: "Pengaturan" };

  function render() {
    updateBrand();
    updateTrashCount();
    const navPage = page === "transfers" ? "transfers" : page;
    document.querySelectorAll(".nav-link").forEach(button => button.classList.toggle("active", button.dataset.page === navPage));
    document.querySelectorAll(".mobile-dock [data-page]").forEach(button => button.classList.toggle("active", button.dataset.page === (["home", "reports", "accounts", "notes", "settings"].includes(page) ? page : "settings")));
    document.getElementById("page-title").textContent = pageTitles[page] || "Lihat Uangmu";
    document.getElementById("page-content").innerHTML = (renderers[page] || renderHome)();
    document.getElementById("search-input").value = searchTerm;
    if (window.lucide) window.lucide.createIcons();
    if (page === "reports" || page === "all-reports") drawChart();
  }
  const heading = (title, description, action = "") => `<div class="page-heading"><div><span class="eyebrow">RUANG KEUANGAN</span><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
  const empty = (icon, title, description) => `<div class="empty-state"><span><i data-lucide="${icon}"></i></span><strong>${title}</strong><p>${description}</p></div>`;
  const summaryCard = (title, value, icon, tone = "", detail = "") => `<article class="summary-card ${tone === "balance" ? "balance-card" : ""}"><div class="summary-top">${title}<span class="summary-icon ${tone}"><i data-lucide="${icon}"></i></span></div><h2 class="${tone === "income" ? "income-text" : tone === "expense" ? "expense-text" : ""}">${fmt(value)}</h2>${detail ? `<div class="subdued">${detail}</div>` : ""}</article>`;
  const countCard = (title, value, icon) => `<article class="summary-card"><div class="summary-top">${title}<span class="summary-icon"><i data-lucide="${icon}"></i></span></div><h2>${value}</h2></article>`;

  function transactionRow(tx, after = balancesAfter()[tx.id]) {
    const incoming = tx.type === "income";
    const transfer = tx.type === "transfer";
    const sign = incoming ? "+" : transfer ? "" : "−";
    const title = transfer ? `${accountName(tx.fromAccountId)} → ${accountName(tx.toAccountId)}` : tx.name;
    const meta = transfer ? `Transfer · ${formatTime(tx.time)}` : `${tx.category || (incoming ? "Pemasukan" : "Pengeluaran")} · ${formatTime(tx.time)} · ${accountName(tx.accountId)}`;
    return `<div class="transaction-row" data-transaction="${esc(tx.id)}" tabindex="0" role="button" aria-label="${esc(title)} ${fmt(tx.amount)}"><span class="transaction-icon ${incoming ? "income" : transfer ? "" : "expense"}"><i data-lucide="${incoming ? "arrow-down-left" : transfer ? "arrow-left-right" : "arrow-up-right"}"></i></span><span class="transaction-copy"><strong>${esc(title)}</strong><span>${esc(meta)}</span></span><span class="transaction-money"><strong class="${incoming ? "income-text" : transfer ? "" : "expense-text"}">${sign}${fmt(tx.amount)}</strong><span>Saldo ${fmt(after)}</span></span></div>`;
  }
  function renderHome() {
    const query = searchTerm.trim().toLocaleLowerCase();
    const visible = sortedTransactions(periodTransactions().filter(tx => {
      if (!query) return true;
      const searchable = tx.type === "transfer"
        ? `${accountName(tx.fromAccountId)} ${accountName(tx.toAccountId)} transfer ${tx.note || ""}`
        : `${tx.name || ""} ${tx.category || ""} ${accountName(tx.accountId)} ${tx.note || ""}`;
      return searchable.toLocaleLowerCase().includes(query);
    }));
    const sums = totals(periodTransactions());
    const grouped = visible.reduce((result, tx) => { (result[tx.date] ||= []).push(tx); return result; }, {});
    const groups = Object.entries(grouped).map(([date, txs]) => `<section class="transaction-group"><div class="group-date"><strong>${esc(formatDate(date))}</strong><span>${txs.length} transaksi</span></div>${txs.map(tx => transactionRow(tx)).join("")}</section>`).join("");
    return `${heading(`Halo, ${esc(state.settings.userName || "Namamu")} 👋`, "Ini ringkasan kondisi keuanganmu hari ini.", `<button class="button button-outline" data-page="all-reports"><i data-lucide="file-chart-column"></i> Lihat laporan</button>`)}
      <div class="summary-grid">${summaryCard("Total menerima", sums.income, "arrow-down-left", "income", "Pemasukan tercatat")}${summaryCard("Total membayar", sums.expense, "arrow-up-right", "expense", "Pengeluaran tercatat")}${summaryCard("Saldo saat ini", Object.values(accountBalances()).reduce((a,b)=>a+b,0), "wallet", "balance", "Seluruh akun")}</div>
      <div class="transaction-actions"><button class="money-button income" data-action="add-income"><i data-lucide="plus"></i> KAMU MENERIMA</button><button class="money-button expense" data-action="add-expense"><i data-lucide="minus"></i> KAMU MEMBAYAR</button></div>
      <div class="panel"><div class="panel-header"><h2>Riwayat transaksi</h2><div class="period-tabs">${[["all","Semua"],["day","Harian"],["week","Mingguan"],["month","Bulanan"],["year","Tahunan"]].map(([key,label])=>`<button class="period-tab ${period===key?"active":""}" data-period="${key}">${label}</button>`).join("")}</div></div>
      ${groups || empty("receipt-text","Belum ada transaksi","Catat pemasukan atau pengeluaran pertama Anda.")}</div>`;
  }
  function renderAccounts() {
    const cards = state.accounts.map(account => `<article class="panel account-card"><div class="account-card-top"><span class="account-dot"><i data-lucide="${account.type === "Bank" ? "landmark" : "wallet"}"></i></span><div class="table-actions"><button data-action="edit-account" data-id="${esc(account.id)}" aria-label="Edit akun"><i data-lucide="pencil"></i></button><button data-action="delete-account" data-id="${esc(account.id)}" aria-label="Hapus akun"><i data-lucide="trash-2"></i></button></div></div><h3>${esc(account.name)}</h3><div class="account-balance">${fmt(accountBalances()[account.id])}</div><div class="account-card-footer"><span>${esc(account.type)}</span><span>Saldo awal ${fmt(account.openingBalance)}</span></div></article>`).join("");
    return `${heading("Akun keuangan","Kelola saldo dan rekening yang Anda gunakan.",`<button class="button button-primary" data-action="add-account"><i data-lucide="plus"></i> Tambah akun</button>`)}<div class="account-grid">${cards || empty("wallet","Belum ada akun","Buat akun untuk mulai mencatat keuangan.")}</div>`;
  }
  function renderAccountSummary() {
    const total = Object.values(accountBalances()).reduce((a,b)=>a+b,0);
    return `${heading("Ringkasan akun","Lihat saldo gabungan dan rincian setiap akun.")}<div class="summary-grid">${summaryCard("Total seluruh saldo",total,"wallet","balance")}${countCard("Jumlah akun",state.accounts.length,"landmark")}${countCard("Transaksi aktif",state.transactions.length,"receipt-text")}</div><div class="panel"><div class="panel-header"><h2>Saldo per akun</h2></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Nama akun</th><th>Jenis akun</th><th>Saldo awal</th><th>Saldo saat ini</th><th>Transaksi</th></tr></thead><tbody>${state.accounts.map(a=>`<tr><td><strong>${esc(a.name)}</strong></td><td>${esc(a.type)}</td><td>${fmt(a.openingBalance)}</td><td><strong>${fmt(accountBalances()[a.id])}</strong></td><td>${state.transactions.filter(t=>t.accountId===a.id||t.fromAccountId===a.id||t.toAccountId===a.id).length}</td></tr>`).join("")}</tbody></table></div></div>`;
  }
  function renderTransfers() {
    const transfers = sortedTransactions(state.transactions.filter(tx=>tx.type==="transfer"));
    return `${heading("Transfer antar akun","Pindahkan uang tanpa mengubah total pemasukan dan pengeluaran.",`<button class="button button-primary" data-action="add-transfer"><i data-lucide="arrow-left-right"></i> Transfer baru</button>`)}<div class="summary-grid">${summaryCard("Total saldo",Object.values(accountBalances()).reduce((a,b)=>a+b,0),"wallet","balance")}${countCard("Jumlah akun",state.accounts.length,"landmark")}${countCard("Transfer tercatat",transfers.length,"arrow-left-right")}</div><div class="panel"><div class="panel-header"><h2>Riwayat transfer</h2></div>${transfers.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Tanggal</th><th>Dari akun</th><th>Ke akun</th><th>Nominal</th><th>Keterangan</th><th></th></tr></thead><tbody>${transfers.map(t=>`<tr><td>${formatDate(t.date,{day:"2-digit",month:"short",year:"numeric"})} · ${formatTime(t.time)}</td><td>${esc(accountName(t.fromAccountId))}</td><td>${esc(accountName(t.toAccountId))}</td><td><strong>${fmt(t.amount)}</strong></td><td>${esc(t.note||"—")}</td><td><div class="table-actions"><button data-action="edit-transfer" data-id="${esc(t.id)}" aria-label="Edit transfer"><i data-lucide="pencil"></i></button><button data-action="trash-transaction" data-id="${esc(t.id)}" aria-label="Hapus transfer"><i data-lucide="trash-2"></i></button></div></td></tr>`).join("")}</tbody></table></div>`:empty("arrow-left-right","Belum ada transfer","Transfer antar akun akan tampil di sini.")}</div>`;
  }
  function filterByPeriod(list, key) {
    const now=new Date(),start=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    if(key==="day"){} else if(key==="week")start.setDate(start.getDate()-((start.getDay()+6)%7)); else if(key==="month")start.setDate(1); else if(key==="year")start.setMonth(0,1); else return list;
    const end=new Date(start); if(key==="day")end.setDate(end.getDate()+1);if(key==="week")end.setDate(end.getDate()+7);if(key==="month")end.setMonth(end.getMonth()+1);if(key==="year")end.setFullYear(end.getFullYear()+1);
    return list.filter(tx=>new Date(`${tx.date}T00:00:00`)>=start&&new Date(`${tx.date}T00:00:00`)<end);
  }
  function reportControls() {
    return `<div class="toolbar"><label class="report-filter-field"><span class="field-label">Dari tanggal</span><input class="field-input report-filter" id="filter-from" type="date" value="${esc(reportFilters.from)}"></label><label class="report-filter-field"><span class="field-label">Sampai tanggal</span><input class="field-input report-filter" id="filter-to" type="date" value="${esc(reportFilters.to)}"></label><label class="report-filter-field"><span class="field-label">Akun</span><select class="field-select report-filter" id="filter-account"><option value="">Semua akun</option>${state.accounts.map(a=>`<option value="${esc(a.id)}" ${a.id===reportFilters.account?"selected":""}>${esc(a.name)}</option>`).join("")}</select></label><label class="report-filter-field"><span class="field-label">Jenis transaksi</span><select class="field-select report-filter" id="filter-type"><option value="">Semua jenis</option><option value="income" ${reportFilters.type==="income"?"selected":""}>Pemasukan</option><option value="expense" ${reportFilters.type==="expense"?"selected":""}>Pengeluaran</option></select></label><button class="button button-outline report-reset" data-action="reset-report-filter">Atur ulang</button></div>`;
  }
  function getReportTransactions() {
    const {from,to,account,type}=reportFilters;
    return sortedTransactions(state.transactions.filter(tx=>(!from||tx.date>=from)&&(!to||tx.date<=to)&&(!account||(tx.type==="transfer"?tx.fromAccountId===account||tx.toAccountId===account:tx.accountId===account))&&(!type||tx.type===type)));
  }
  function renderReports(all = false) {
    const list=all?getReportTransactions():filterByPeriod(activeTransactions(),"month"),sum=totals(list),balance=Object.values(accountBalances()).reduce((a,b)=>a+b,0);
    const rows=sortedTransactions(list).map(t=>`<tr><td>${formatDate(t.date,{day:"2-digit",month:"short",year:"numeric"})} · ${formatTime(t.time)}</td><td>${esc(t.type==="transfer"?"Transfer antar akun":t.name)}</td><td>${esc(t.type==="transfer"?`${accountName(t.fromAccountId)} → ${accountName(t.toAccountId)}`:accountName(t.accountId))}</td><td>${esc(t.category||"—")}</td><td class="${t.type==="income"?"income-text":t.type==="expense"?"expense-text":""}">${t.type==="income"?"Pemasukan":t.type==="expense"?"Pengeluaran":"Transfer"}</td><td><strong>${fmt(t.amount)}</strong></td></tr>`).join("");
    return `${heading(all?"Laporan semua akun":"Ringkasan keuangan",all?"Analisis, filter, dan ekspor transaksi seluruh akun.":"Gambaran pemasukan dan pengeluaran bulan ini.")}<div class="stat-inline"><div class="panel"><span>Total pemasukan</span><strong class="income-text">${fmt(sum.income)}</strong></div><div class="panel"><span>Total pengeluaran</span><strong class="expense-text">${fmt(sum.expense)}</strong></div><div class="panel"><span>Saldo saat ini</span><strong>${fmt(balance)}</strong></div><div class="panel"><span>Jumlah transaksi</span><strong>${list.length}</strong></div></div><div class="report-grid" style="margin-top:15px"><div class="panel"><div class="panel-header"><h2>Arus kas enam bulan terakhir</h2></div><div class="chart-box"><canvas id="finance-chart" aria-label="Grafik pemasukan dan pengeluaran"></canvas></div></div><div class="panel"><div class="panel-header"><h2>Ringkasan periode</h2></div>${[["Harian","day"],["Mingguan","week"],["Bulanan","month"],["Tahunan","year"]].map(([name,key])=>{const s=totals(filterByPeriod(activeTransactions(),key));return `<div class="account-mini"><span class="account-mini-copy"><strong>${name}</strong><span>Menerima ${fmt(s.income)} · Membayar ${fmt(s.expense)}</span></span><strong>${fmt(s.income-s.expense)}</strong></div>`}).join("")}</div></div>${all?`<div class="panel"><div class="panel-header"><h2>Filter laporan</h2></div>${reportControls()}</div>`:""}<div class="panel" style="margin-top:15px"><div class="panel-header"><h2>Riwayat transaksi</h2><span class="muted" style="font-size:9px">${rows?list.length+" transaksi":"Tidak ada transaksi"}</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Tanggal</th><th>Nama transaksi</th><th>Akun</th><th>Kategori</th><th>Jenis</th><th>Nominal</th></tr></thead><tbody>${rows||`<tr><td colspan="6">${empty("chart-no-axes-combined","Belum ada data laporan","Transaksi akan dirangkum di sini.")}</td></tr>`}</tbody></table></div></div>`;
  }
  function renderCategories() {
    return `${heading("Nama transaksi","Kelola kategori untuk transaksi pemasukan dan pengeluaran.",`<button class="button button-primary" data-action="add-category"><i data-lucide="plus"></i> Tambah kategori</button>`)}<div class="report-grid">${["income","expense"].map(type=>`<div class="panel"><div class="panel-header"><h2 class="${type==="income"?"income-text":"expense-text"}">${type==="income"?"Pemasukan":"Pengeluaran"}</h2><span class="category-badge">${state.categories.filter(c=>c.type===type).length} kategori</span></div>${state.categories.filter(c=>c.type===type).map(c=>`<div class="category-line"><span>${esc(c.name)}</span><div class="table-actions"><button data-action="edit-category" data-id="${esc(c.id)}" aria-label="Edit kategori"><i data-lucide="pencil"></i></button><button data-action="delete-category" data-id="${esc(c.id)}" aria-label="Hapus kategori"><i data-lucide="trash-2"></i></button></div></div>`).join("")||empty("tags","Belum ada kategori","Tambahkan kategori untuk memulai.")}</div>`).join("")}</div>`;
  }
  function renderNotes() {
    return `${heading("Buku catatan","Simpan pengingat dan catatan kecil seputar keuangan.",`<button class="button button-primary" data-action="add-note"><i data-lucide="plus"></i> Tulis catatan</button>`)}${state.notes.length?`<div class="account-grid">${[...state.notes].sort((a,b)=>b.date.localeCompare(a.date)).map(n=>`<article class="panel note-card"><h3>${esc(n.title)}</h3><p>${esc(n.body)}</p><footer><span>${formatDate(n.date,{day:"2-digit",month:"long",year:"numeric"})}</span><div class="table-actions"><button data-action="edit-note" data-id="${esc(n.id)}" aria-label="Edit catatan"><i data-lucide="pencil"></i></button><button data-action="delete-note" data-id="${esc(n.id)}" aria-label="Hapus catatan"><i data-lucide="trash-2"></i></button></div></footer></article>`).join("")}</div>`:empty("notebook-pen","Belum ada catatan","Catatan keuangan Anda akan disimpan di sini.")}`;
  }
  function renderCalendar() {
    const year=calendarMonth.getFullYear(),month=calendarMonth.getMonth(),first=new Date(year,month,1),startOffset=(first.getDay()+6)%7,days=new Date(year,month+1,0).getDate();
    const cells=Array.from({length:42},(_,i)=>{
      const cellDate=new Date(year,month,i-startOffset+1);
      const iso=`${cellDate.getFullYear()}-${String(cellDate.getMonth()+1).padStart(2,"0")}-${String(cellDate.getDate()).padStart(2,"0")}`;
      const isOutsideMonth=cellDate.getMonth()!==month;
      const txs=activeTransactions().filter(t=>t.date===iso),inc=txs.some(t=>t.type==="income"),exp=txs.some(t=>t.type==="expense");
      return `<button class="calendar-day ${isOutsideMonth?"muted":""} ${iso===selectedDate?"selected":""} ${inc?"has-income":""} ${exp?"has-expense":""}" data-date="${iso}">${cellDate.getDate()}</button>`;
    }).join("");
    const selected=sortedTransactions(state.transactions.filter(t=>t.date===selectedDate));
    return `${heading("Kalender aktivitas","Jelajahi transaksi berdasarkan tanggal.")}<div class="calendar-layout"><div class="panel"><div class="calendar-head"><button data-action="calendar-prev" aria-label="Bulan sebelumnya">‹</button><strong>${new Intl.DateTimeFormat("id-ID",{month:"long",year:"numeric"}).format(calendarMonth)}</strong><button data-action="calendar-next" aria-label="Bulan berikutnya">›</button></div><div class="calendar-grid">${["Sen","Sel","Rab","Kam","Jum","Sab","Min"].map(d=>`<div class="calendar-weekday">${d}</div>`).join("")}${cells}</div><hr class="divider"><div class="muted" style="font-size:9px"><span class="income-text">● Pemasukan</span> &nbsp; <span class="expense-text">● Pengeluaran</span></div></div><div class="panel"><div class="panel-header"><h2>${formatDate(selectedDate,{day:"2-digit",month:"long",year:"numeric"})}</h2></div>${selected.map(tx=>transactionRow(tx)).join("")||empty("calendar-days","Tidak ada transaksi","Belum ada aktivitas pada tanggal ini.")}</div></div>`;
  }
  function renderCalculator() {
    return `${heading("Kalkulator kas","Gunakan kalkulator untuk perhitungan.")}<div class="calc-layout"><div class="panel"><div class="panel-header"><h2>Kalkulator</h2></div><div class="calc-display" id="calc-display">${esc(calcValue)}</div><div class="calc-grid">${["C","±","%","÷","7","8","9","×","4","5","6","−","1","2","3","+","0",".","="].map(key=>`<button class="calc-key ${["÷","×","−","+","="].includes(key)?"op ":""}${key==="="?"equal ":""}${key==="0"?"zero-key":""}" data-calc="${key}">${key}</button>`).join("")}</div></div></div>`;
  }
  function renderTrash() {
    return `${heading("Transaksi dihapus","Pulihkan transaksi atau hapus secara permanen.")}<div class="panel">${state.trash.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Tanggal</th><th>Nama transaksi</th><th>Jenis</th><th>Nominal</th><th>Akun</th><th></th></tr></thead><tbody>${sortedTransactions(state.trash).map(t=>`<tr><td>${formatDate(t.date,{day:"2-digit",month:"short",year:"numeric"})}</td><td>${esc(t.name||`${accountName(t.fromAccountId)} → ${accountName(t.toAccountId)}`)}</td><td>${t.type==="income"?"Pemasukan":t.type==="expense"?"Pengeluaran":"Transfer"}</td><td>${fmt(t.amount)}</td><td>${esc(t.type==="transfer"?accountName(t.fromAccountId):accountName(t.accountId))}</td><td><div class="table-actions"><button data-action="restore-transaction" data-id="${esc(t.id)}" aria-label="Pulihkan"><i data-lucide="undo-2"></i></button><button data-action="delete-permanently" data-id="${esc(t.id)}" aria-label="Hapus permanen"><i data-lucide="trash-2"></i></button></div></td></tr>`).join("")}</tbody></table></div>`:empty("trash-2","Tempat sampah kosong","Transaksi yang dihapus akan muncul di sini.")}</div>`;
  }
  function renderBackup() {
    return `${heading("Cadangkan dan pulihkan","Simpan salinan semua data atau pulihkan cadangan sebelumnya.")}<div class="report-grid"><div class="panel"><div class="panel-header"><h2>Cadangkan data</h2><span class="summary-icon"><i data-lucide="download"></i></span></div><p class="muted" style="font-size:10px;line-height:1.7">Unduh seluruh akun, transaksi aktif dan terhapus, kategori, catatan, serta pengaturan dalam berkas JSON.</p><button class="button button-primary" data-action="export-backup"><i data-lucide="download"></i> Unduh cadangan JSON</button></div><div class="panel"><div class="panel-header"><h2>Pulihkan data</h2><span class="summary-icon"><i data-lucide="upload"></i></span></div><p class="muted" style="font-size:10px;line-height:1.7">Impor berkas cadangan JSON valid. Data saat ini akan digantikan setelah konfirmasi.</p><label class="button button-outline"><i data-lucide="file-up"></i> Pilih berkas JSON<input id="restore-file" type="file" accept=".json,application/json" hidden></label></div></div><div class="panel"><div class="panel-header"><h2>Penyimpanan lokal</h2></div><p class="muted" style="font-size:10px">Data tersimpan di penyimpanan browser pada perangkat ini. Cadangkan data sebelum menghapus data situs dari browser.</p><div class="account-mini"><span class="account-mini-copy"><strong>Akun</strong></span><strong>${state.accounts.length}</strong></div><div class="account-mini"><span class="account-mini-copy"><strong>Transaksi aktif</strong></span><strong>${state.transactions.length}</strong></div><div class="account-mini"><span class="account-mini-copy"><strong>Catatan</strong></span><strong>${state.notes.length}</strong></div><button class="button button-danger button-small" data-action="clear-all-data">Hapus seluruh data aplikasi</button></div>`;
  }
  function renderSettings() {
    const profilePhoto=state.settings.profilePhoto;
    return `${heading("Pengaturan","Sesuaikan aplikasi dengan preferensi Anda.")}<div class="panel"><section class="settings-section"><h3>Profil dan tampilan</h3><div class="settings-profile-photo"><div class="settings-profile-preview">${profilePhoto?`<img src="${esc(profilePhoto)}" alt="Foto profil">`:`<span>${esc((state.settings.userName||"N").trim().charAt(0).toUpperCase())}</span>`}</div><div class="settings-profile-actions"><label class="button button-outline" for="setting-profile-photo"><i data-lucide="camera"></i> ${profilePhoto?"Ganti foto profil":"Tambah foto profil"}<input id="setting-profile-photo" type="file" accept="image/*" hidden></label>${profilePhoto?`<button class="button button-ghost" type="button" data-action="remove-profile-photo">Hapus foto</button>`:""}</div></div><label class="settings-row"><span>Nama pengguna</span><input class="field-input" id="setting-user" value="${esc(state.settings.userName)}"></label><label class="settings-row"><span>Tema gelap</span><input class="switch" id="setting-theme" type="checkbox" ${state.settings.theme==="dark"?"checked":""}></label><label class="settings-row"><span>Format tanggal</span><select class="field-select" id="setting-date"><option value="id-ID" ${state.settings.dateFormat==="id-ID"?"selected":""}>Indonesia (DD/MM/YYYY)</option><option value="en-GB" ${state.settings.dateFormat==="en-GB"?"selected":""}>Internasional (DD/MM/YYYY)</option></select></label><label class="settings-row"><span>Format waktu</span><select class="field-select" id="setting-time"><option value="12h" ${state.settings.timeFormat==="12h"?"selected":""}>12 jam (AM/PM)</option><option value="24h" ${state.settings.timeFormat!=="12h"?"selected":""}>24 jam</option></select></label></section><section class="settings-section"><h3>Keamanan dasar</h3><label class="settings-row"><span>PIN pembuka (opsional)</span><input class="field-input" id="setting-pin" type="password" inputmode="numeric" maxlength="8" placeholder="Kosongkan untuk menonaktifkan" value="${esc(state.settings.pin||"")}"></label><p class="muted" style="font-size:9px">PIN tersimpan secara lokal dan tidak mengenkripsi data browser.</p></section><section class="settings-section"><h3>Format dan pengelolaan</h3><div class="settings-row"><span>Mata uang</span><strong style="font-size:10px">Rupiah Indonesia (Rp)</strong></div><div class="settings-row"><span>Lokasi data</span><strong style="font-size:10px">Penyimpanan browser lokal</strong></div></section><div class="settings-actions"><button class="button button-primary" data-action="save-settings"><i data-lucide="save"></i> Simpan pengaturan</button><button class="button button-outline settings-back-button" data-page="home">Kembali lihat uangmu</button></div></div>`;
  }
  const renderers = { home: renderHome, reports: () => renderReports(false), accounts: renderAccounts, "account-summary": renderAccountSummary, transfers: renderTransfers, "all-reports": () => renderReports(true), categories: renderCategories, notes: renderNotes, calendar: renderCalendar, calculator: renderCalculator, trash: renderTrash, backup: renderBackup, settings: renderSettings };

  function options(list, selected = "") { return list.map(item => `<option value="${esc(item.id)}" ${item.id===selected?"selected":""}>${esc(item.name)}</option>`).join(""); }
  function timeField(id, value) {
    const time = value || timeNow();
    return `<div class="time-picker-control"><input type="hidden" name="time" id="${id}" value="${esc(time)}"><button class="field-input time-picker-button" type="button" data-action="open-time-picker" data-time-input="${id}" aria-label="Pilih waktu"><span id="${id}-label">${esc(formatTime(time))}</span><i data-lucide="clock-3"></i></button></div>`;
  }
  function openModal(title, subtitle, content, wide = false) {
    const modal = document.getElementById("modal");
    modal.className = `modal${wide?" modal-wide":""}`;
    modal.innerHTML = `<div class="modal-header"><div><h2 id="modal-title">${title}</h2><p>${subtitle}</p></div><button class="modal-close" data-action="close-modal" aria-label="Tutup"><i data-lucide="x"></i></button></div>${content}`;
    document.getElementById("modal-layer").classList.add("open");
    document.getElementById("modal-layer").setAttribute("aria-hidden","false");
    if(window.lucide)window.lucide.createIcons();
    modal.querySelector("input,select,textarea")?.focus();
  }
  function closeModal() { document.getElementById("modal-layer").classList.remove("open");document.getElementById("modal-layer").setAttribute("aria-hidden","true"); }
  function showTimePicker(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    timePickerTarget = inputId;
    timePickerForm = document.getElementById("modal").innerHTML;
    timePickerFormClass = document.getElementById("modal").className;
    timePickerFormValues = Object.fromEntries([...document.querySelectorAll("#modal form [name]")].map(field => [field.name, field.value]));
    [timePickerValue.hours, timePickerValue.minutes] = (input.value || timeNow()).split(":").map(Number);
    timePickerStage = "hour";
    renderTimePicker();
  }
  function restoreTimePickerForm(saveTime = false) {
    const modal = document.getElementById("modal");
    modal.className = timePickerFormClass;
    modal.innerHTML = timePickerForm;
    for (const [name, value] of Object.entries(timePickerFormValues)) {
      const field = modal.querySelector(`[name="${CSS.escape(name)}"]`);
      if (field) field.value = value;
    }
    if (saveTime) {
      const input = document.getElementById(timePickerTarget);
      if (input) {
        input.value = `${String(timePickerValue.hours).padStart(2, "0")}:${String(timePickerValue.minutes).padStart(2, "0")}`;
        document.getElementById(`${timePickerTarget}-label`).textContent = formatTime(input.value);
      }
    }
    if (window.lucide) window.lucide.createIcons();
    timePickerTarget = "";
    timePickerForm = "";
    timePickerFormClass = "";
    timePickerFormValues = {};
    if (document.getElementById("receipt-preview")) renderReceiptPreview();
  }
  function renderTimePicker() {
    const is12Hour = state.settings.timeFormat === "12h";
    const hour12 = timePickerValue.hours % 12 || 12;
    const displayHour = is12Hour ? hour12 : String(timePickerValue.hours).padStart(2, "0");
    const displayMinute = String(timePickerValue.minutes).padStart(2, "0");
    const markers = timePickerStage === "hour"
      ? (is12Hour
        ? Array.from({length: 12}, (_, index) => ({label: index + 1, value: index + 1, radius: 42, selected: hour12 === index + 1}))
        : [...Array.from({length: 12}, (_, index) => ({label: index + 1, value: index + 1, radius: 42, selected: timePickerValue.hours === index + 1})), ...Array.from({length: 12}, (_, index) => ({label: index === 0 ? "00" : index + 12, value: index === 0 ? 0 : index + 12, radius: 27, selected: timePickerValue.hours === (index === 0 ? 0 : index + 12)}))])
      : Array.from({length: 12}, (_, index) => ({label: String(index * 5).padStart(2, "0"), value: index * 5, radius: 42, selected: timePickerValue.minutes === index * 5}));
    const dial = markers.map(marker => {
      const value = timePickerStage === "hour" ? marker.value : marker.value;
      const angle = (timePickerStage === "hour" ? (is12Hour ? (marker.value % 12) : marker.value % 12) : marker.value / 5) * 30;
      const radians = angle * Math.PI / 180;
      const left = 50 + Math.sin(radians) * marker.radius;
      const top = 50 - Math.cos(radians) * marker.radius;
      return `<button type="button" class="clock-dial-number${marker.selected ? " selected" : ""}${marker.radius < 40 ? " inner" : ""}" style="left:${left}%;top:${top}%" data-action="clock-select-${timePickerStage}" data-clock-value="${value}">${marker.label}</button>`;
    }).join("");
    const handValue = timePickerStage === "hour" ? (is12Hour ? hour12 % 12 : timePickerValue.hours % 12) : timePickerValue.minutes / 5;
    const handLength = timePickerStage === "hour" && !is12Hour && (timePickerValue.hours === 0 || timePickerValue.hours > 12) ? 27 : 42;
    const handAngle = handValue * 30;
    const meridiem = timePickerValue.hours < 12 ? "AM" : "PM";
    const minuteTicks = timePickerStage === "minute" ? Array.from({length: 60}, (_, minute) => {
      const radians = minute * Math.PI / 30;
      return `<span class="clock-minute-tick" style="left:${50 + Math.sin(radians) * 46}%;top:${50 - Math.cos(radians) * 46}%"></span>`;
    }).join("") : "";
    openModal("Pilih waktu", "Pilih jam lalu menit pada tampilan jam.", `<div class="clock-picker"><div class="clock-display"><button type="button" class="${timePickerStage==="hour"?"active":""}" data-action="clock-stage-hour">${displayHour}</button><span>:</span><button type="button" class="${timePickerStage==="minute"?"active":""}" data-action="clock-stage-minute">${displayMinute}</button>${is12Hour?`<span class="clock-meridiem"><button type="button" class="${meridiem==="AM"?"active":""}" data-action="clock-meridiem" data-clock-value="AM">AM</button><button type="button" class="${meridiem==="PM"?"active":""}" data-action="clock-meridiem" data-clock-value="PM">PM</button></span>`:""}</div><div class="clock-face">${minuteTicks}<span class="clock-hand" style="--hand-angle:${handAngle}deg;--hand-length:${handLength}%"></span><span class="clock-center"></span>${dial}</div><div class="modal-actions"><button type="button" class="button button-outline" data-action="clock-cancel">Batal</button><button type="button" class="button button-primary" data-action="clock-confirm">Oke</button></div></div>`);
    document.querySelector("#modal .modal-close").dataset.action = "clock-cancel";
  }
  function selectClockHour(hour) {
    const value = Number(hour);
    if (state.settings.timeFormat === "12h") timePickerValue.hours = value % 12 + (timePickerValue.hours >= 12 ? 12 : 0);
    else timePickerValue.hours = value;
    timePickerStage = "minute";
    renderTimePicker();
  }
  function promptForUserName() {
    openModal("Beri nama kamu", "Masukkan nama Anda untuk mulai menggunakan Catat Uangmu.", `<form id="onboarding-form"><label><span class="field-label">Nama pengguna</span><input class="field-input" name="userName" required maxlength="60" autocomplete="name" placeholder="Namamu"></label><label><span class="field-label">Nama catatan (akun)</span><input class="field-input" name="accountName" required maxlength="60" placeholder="Contoh: Uang Tunai" value="${esc(state.accounts[0]?.name||"")}"></label><div class="modal-actions"><button class="button button-primary">Mulai mencatat</button></div></form>`);
    document.querySelector("#modal .modal-close")?.remove();
  }
  function lockApp() {
    unlocked = false;
    openModal("Aplikasi terkunci", "Masukkan PIN untuk membuka Catat Uangmu.", `<form id="unlock-form"><label><span class="field-label">PIN pembuka</span><input class="field-input" type="password" name="pin" inputmode="numeric" maxlength="8" required autofocus></label><div class="modal-actions"><button class="button button-primary">Buka aplikasi</button></div></form>`);
    document.querySelector("#modal .modal-close")?.remove();
    document.getElementById("modal-layer").dataset.locked = "true";
  }
  function transactionForm(type = "expense", id = "") {
    const tx=state.transactions.find(item=>item.id===id);
    if(tx?.type==="transfer"){transferForm(id);return;}
    const actualType=tx?.type||type;
    transactionItems=(tx?.items||[]).map(item=>({...item}));
    transactionReceipt=tx?.receipt||"";
    openModal(id?"Edit transaksi":actualType==="income"?"Tambah pemasukan":"Tambah pengeluaran","Catat nominal dan detail transaksi.",`<form id="transaction-form"><input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="type" value="${actualType}"><div class="transaction-layout"><div class="transaction-type-tabs"><button type="button" class="transaction-type-tab income ${actualType==="income"?"active":""}" data-action="transaction-type" data-type="income">Kamu Menerima</button><button type="button" class="transaction-type-tab expense ${actualType==="expense"?"active":""}" data-action="transaction-type" data-type="expense">Kamu Membayar</button></div><label class="transaction-account"><span class="field-label">Akun</span><select class="field-select" name="accountId" required>${options(state.accounts,tx?.accountId)}</select></label><div class="transaction-datetime"><label class="form-field"><span class="field-label">Tanggal *</span><input class="field-input" type="date" name="date" required value="${esc(tx?.date||today())}"></label><label class="form-field"><span class="field-label">Jam *</span>${timeField("transaction-time",tx?.time)}</label></div><label class="transaction-amount"><span class="field-label transaction-amount-label">${actualType==="income"?"Kamu Menerima":"Kamu Membayar"} *</span><input class="field-input" name="amount" type="text" data-money-input inputmode="numeric" autocomplete="off" required placeholder="0" value="${tx?groupedInteger(tx.amount):""}"></label><label class="transaction-note"><span class="field-label">Nama transaksi atau catatan *</span><textarea class="field-textarea" name="note" maxlength="500" required placeholder="Catatan">${esc(tx?.note||"")}</textarea></label><label class="transaction-name"><span class="field-label">Nama transaksi (opsional)</span><input class="field-input" name="name" maxlength="80" placeholder="Contoh: Belanja bulanan" value="${esc(tx?.name||"")}"></label><div class="transaction-tools"><label class="transaction-tool"><i data-lucide="camera"></i><span>${transactionReceipt?"Bukti terlampir":"Tambah tagihan"}</span><input id="receipt-file" type="file" accept="image/*" capture="environment" hidden></label><button id="items-button" class="transaction-tool" type="button" data-action="open-items"><i data-lucide="list"></i><span>Tambah Barang${transactionItems.length?` (${transactionItems.length})`:""}</span></button></div><div id="receipt-preview">${renderReceiptPreviewMarkup()}</div></div><div id="transaction-items-panel" hidden></div><div class="transaction-form-footer"><button type="button" class="button button-outline" data-action="close-modal">Batal</button><button type="submit" class="button button-outline" data-continue="true">Simpan dan lanjutkan</button><button type="submit" class="button button-primary">Simpan dan keluar</button></div></form>`,true);
  }
  function renderReceiptPreviewMarkup() {
    return transactionReceipt ? `<div class="receipt-preview"><img src="${transactionReceipt}" alt="Pratinjau bukti transaksi"><button class="button button-ghost" type="button" data-action="remove-receipt">Hapus bukti</button></div>` : "";
  }
  function renderReceiptPreview() {
    const preview=document.getElementById("receipt-preview");
    if(preview)preview.innerHTML=renderReceiptPreviewMarkup();
    const tool=document.querySelector(".transaction-tool input#receipt-file")?.closest(".transaction-tool");
    if(tool)tool.querySelector("span").textContent=transactionReceipt?"Bukti terlampir":"Tambah tagihan";
    if(window.lucide)window.lucide.createIcons();
  }
  function renderItemsEditor() {
    const panel=document.getElementById("transaction-items-panel");
    if(!panel)return;
    panel.innerHTML=`<div class="items-editor"><h3>Daftar barang</h3>${transactionItems.map((item,index)=>`<div class="item-editor-row" data-item-index="${index}"><input class="field-input" data-item-field="name" aria-label="Nama barang" placeholder="Nama barang" value="${esc(item.name)}"><input class="field-input" data-item-field="quantity" aria-label="Jumlah" type="number" min="1" step="1" value="${item.quantity}"><input class="field-input" data-item-field="price" data-money-input inputmode="numeric" autocomplete="off" aria-label="Harga satuan" value="${groupedInteger(item.price)}"><button type="button" class="table-actions" data-action="remove-item" data-index="${index}" aria-label="Hapus barang"><i data-lucide="trash-2"></i></button></div>`).join("")}<button type="button" class="button button-outline" data-action="add-item-row"><i data-lucide="plus"></i> Tambah barang</button><div class="items-editor-footer"><strong>Total barang</strong><strong id="item-total">${fmt(transactionItems.reduce((sum,item)=>sum+item.quantity*item.price,0))}</strong></div><div class="modal-actions"><button type="button" class="button button-outline" data-action="cancel-items">Batal</button><button type="button" class="button button-primary" data-action="save-items">Simpan barang</button></div></div>`;
    if(window.lucide)window.lucide.createIcons();
  }
  function compressReceipt(file) {
    if(!file.type.startsWith("image/"))return Promise.reject(new Error("Pilih berkas gambar untuk bukti transaksi."));
    if(file.size>15*1024*1024)return Promise.reject(new Error("Ukuran gambar maksimal 15 MB."));
    return createImageBitmap(file).then(bitmap=>{
      const scale=Math.min(1,1280/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement("canvas");
      canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
      canvas.getContext("2d").drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
      return new Promise((resolve,reject)=>canvas.toBlob(blob=>{
        if(!blob){reject(new Error("Gambar bukti tidak dapat diproses."));return;}
        const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error("Gambar bukti tidak dapat dibaca."));reader.readAsDataURL(blob);
      },"image/jpeg",.72));
    });
  }
  function transferForm(id="") {
    const tx=state.transactions.find(t=>t.id===id);
    if(state.accounts.length<2){notify("Tambahkan minimal dua akun untuk melakukan transfer.",true);return;}
    openModal(id?"Edit transfer":"Transfer antar akun","Transfer tidak dihitung sebagai pemasukan atau pengeluaran.",`<form id="transfer-form"><input type="hidden" name="id" value="${esc(id)}"><div class="form-grid"><label class="form-field"><span class="field-label">Akun asal *</span><select class="field-select" name="fromAccountId" required>${options(state.accounts,tx?.fromAccountId)}</select></label><label class="form-field"><span class="field-label">Akun tujuan *</span><select class="field-select" name="toAccountId" required>${options(state.accounts,tx?.toAccountId||state.accounts[1]?.id)}</select></label><label class="form-field full"><span class="field-label">Nominal (Rp) *</span><input class="field-input" name="amount" type="text" data-money-input inputmode="numeric" autocomplete="off" required value="${tx?groupedInteger(tx.amount):""}"></label><label class="form-field"><span class="field-label">Tanggal *</span><input class="field-input" type="date" name="date" required value="${esc(tx?.date||today())}"></label><label class="form-field"><span class="field-label">Jam *</span>${timeField("transfer-time",tx?.time)}</label><label class="form-field full"><span class="field-label">Keterangan</span><input class="field-input" name="note" maxlength="300" value="${esc(tx?.note||"")}" placeholder="Opsional"></label></div><div class="modal-actions"><button type="button" class="button button-outline" data-action="close-modal">Batal</button><button class="button button-primary" type="submit"><i data-lucide="arrow-left-right"></i> Simpan transfer</button></div></form>`);
  }
  function accountForm(id="") {
    const account=state.accounts.find(a=>a.id===id);
    openModal(id?"Edit akun":"Tambah akun","Tentukan nama, jenis, dan saldo awal akun.",`<form id="account-form"><input type="hidden" name="id" value="${esc(id)}"><label class="form-field"><span class="field-label">Nama akun *</span><input class="field-input" name="name" required maxlength="50" value="${esc(account?.name||"")}" placeholder="Contoh: Dompet harian"></label><div class="form-grid" style="margin-top:14px"><label><span class="field-label">Jenis akun *</span><select class="field-select" name="type"><option ${account?.type==="Tunai"?"selected":""}>Tunai</option><option ${account?.type==="Bank"?"selected":""}>Bank</option><option ${account?.type==="E-wallet"?"selected":""}>E-wallet</option><option ${account?.type==="Tabungan"?"selected":""}>Tabungan</option><option ${account?.type==="Lainnya"?"selected":""}>Lainnya</option></select></label><label><span class="field-label">Saldo awal (Rp) *</span><input class="field-input" name="openingBalance" type="text" data-money-input inputmode="numeric" autocomplete="off" required value="${groupedInteger(account?.openingBalance??0)}"></label></div><div class="modal-actions"><button type="button" class="button button-outline" data-action="close-modal">Batal</button><button class="button button-primary" type="submit">Simpan akun</button></div></form>`);
  }
  function categoryForm(id="") {
    const cat=state.categories.find(c=>c.id===id);
    openModal(id?"Edit kategori":"Tambah kategori","Kategori membantu mengelompokkan transaksi.",`<form id="category-form"><input type="hidden" name="id" value="${esc(id)}"><label><span class="field-label">Nama kategori *</span><input class="field-input" name="name" maxlength="50" required value="${esc(cat?.name||"")}" placeholder="Contoh: Kesehatan"></label><label style="display:block;margin-top:14px"><span class="field-label">Jenis transaksi *</span><select class="field-select" name="type"><option value="income" ${cat?.type==="income"?"selected":""}>Pemasukan</option><option value="expense" ${cat?.type!=="income"?"selected":""}>Pengeluaran</option></select></label><div class="modal-actions"><button type="button" class="button button-outline" data-action="close-modal">Batal</button><button class="button button-primary">Simpan kategori</button></div></form>`);
  }
  function noteForm(id="") {
    const note=state.notes.find(n=>n.id===id);
    openModal(id?"Edit catatan":"Tulis catatan","Catatan disimpan di perangkat ini.",`<form id="note-form"><input type="hidden" name="id" value="${esc(id)}"><label><span class="field-label">Judul *</span><input class="field-input" name="title" maxlength="80" required value="${esc(note?.title||"")}" placeholder="Judul catatan"></label><label style="display:block;margin-top:13px"><span class="field-label">Tanggal *</span><input class="field-input" type="date" name="date" required value="${esc(note?.date||today())}"></label><label style="display:block;margin-top:13px"><span class="field-label">Isi catatan *</span><textarea class="field-textarea" name="body" required maxlength="3000" placeholder="Tulis catatan...">${esc(note?.body||"")}</textarea></label><div class="modal-actions"><button type="button" class="button button-outline" data-action="close-modal">Batal</button><button class="button button-primary">Simpan catatan</button></div></form>`);
  }

  function deleteTransaction(id) {
    const tx=state.transactions.find(t=>t.id===id);if(!tx)return;
    if(!confirm("Pindahkan transaksi ini ke tempat sampah? Saldo akun akan diperbarui."))return;
    state.transactions=state.transactions.filter(t=>t.id!==id);state.trash.push({...tx,deletedAt:new Date().toISOString()});persist("Transaksi dipindahkan ke tempat sampah.");
  }
  function renderTransactionDetail(id) {
    const tx=state.transactions.find(t=>t.id===id);if(!tx)return;
    const typeLabel=tx.type==="income"?"Pemasukan":tx.type==="expense"?"Pengeluaran":"Transfer";
    const items=Array.isArray(tx.items)&&tx.items.length?`<div class="transaction-detail-items"><strong>Barang</strong>${tx.items.map(item=>`<div><span>${esc(item.name)} × ${item.quantity}</span><span>${fmt(item.quantity*item.price)}</span></div>`).join("")}</div>`:"";
    const receipt=tx.receipt?`<div class="receipt-detail"><strong>Bukti transaksi</strong><img src="${esc(tx.receipt)}" alt="Bukti transaksi"></div>`:"";
    openModal("Detail transaksi",`${typeLabel} · ${formatDate(tx.date,{day:"2-digit",month:"long",year:"numeric"})}`,`<div class="account-mini"><span class="account-mini-copy"><strong>${esc(tx.name||"Transfer antar akun")}</strong><span>${esc(tx.category||typeLabel)} · ${esc(formatTime(tx.time))}</span></span><strong class="${tx.type==="income"?"income-text":tx.type==="expense"?"expense-text":""}">${fmt(tx.amount)}</strong></div><div class="account-mini"><span class="account-mini-copy"><strong>${tx.type==="transfer"?"Dari akun":"Akun"}</strong></span><strong>${esc(accountName(tx.type==="transfer"?tx.fromAccountId:tx.accountId))}</strong></div>${tx.type==="transfer"?`<div class="account-mini"><span class="account-mini-copy"><strong>Ke akun</strong></span><strong>${esc(accountName(tx.toAccountId))}</strong></div>`:""}<div class="account-mini"><span class="account-mini-copy"><strong>Saldo setelah transaksi</strong></span><strong>${fmt(balancesAfter()[tx.id])}</strong></div>${tx.note?`<p class="muted" style="font-size:10px;line-height:1.6">${esc(tx.note)}</p>`:""}${items}${receipt}<div class="modal-actions"><button class="button button-danger" data-action="trash-transaction" data-id="${esc(tx.id)}"><i data-lucide="trash-2"></i> Hapus</button><button class="button button-outline" data-action="close-modal">Tutup</button><button class="button button-primary" data-action="${tx.type==="transfer"?"edit-transfer":"edit-transaction"}" data-id="${esc(tx.id)}"><i data-lucide="pencil"></i> Edit</button></div>`);
  }
  function exportRows() {
    const list=page==="all-reports"?getReportTransactions():sortedTransactions(activeTransactions());
    return [["Tanggal","Waktu","Jenis","Nama transaksi","Kategori","Akun","Nominal","Keterangan"],...list.map(t=>[t.date,formatTime(t.time),t.type==="income"?"Pemasukan":t.type==="expense"?"Pengeluaran":"Transfer",t.name||"Transfer antar akun",t.category||"",t.type==="transfer"?`${accountName(t.fromAccountId)} → ${accountName(t.toAccountId)}`:accountName(t.accountId),Number(t.amount),t.note||""])];
  }
  function download(blob,name) {
    const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function crc32(bytes) {
    let crc=-1;
    for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    return (crc^-1)>>>0;
  }
  function makeZip(files) {
    const encoder=new TextEncoder(),parts=[],central=[];let offset=0;
    for(const [name,content] of files){
      const nameBytes=encoder.encode(name),data=encoder.encode(content),crc=crc32(data),local=new Uint8Array(30+nameBytes.length+data.length),v=new DataView(local.buffer);
      v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x0800,true);v.setUint16(8,0,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,nameBytes.length,true);local.set(nameBytes,30);local.set(data,30+nameBytes.length);parts.push(local);
      const entry=new Uint8Array(46+nameBytes.length),e=new DataView(entry.buffer);e.setUint32(0,0x02014b50,true);e.setUint16(4,20,true);e.setUint16(6,20,true);e.setUint16(8,0x0800,true);e.setUint16(10,0,true);e.setUint32(16,crc,true);e.setUint32(20,data.length,true);e.setUint32(24,data.length,true);e.setUint16(28,nameBytes.length,true);e.setUint32(42,offset,true);entry.set(nameBytes,46);central.push(entry);offset+=local.length;
    }
    const centralSize=central.reduce((n,a)=>n+a.length,0),end=new Uint8Array(22),d=new DataView(end.buffer);d.setUint32(0,0x06054b50,true);d.setUint16(8,files.length,true);d.setUint16(10,files.length,true);d.setUint32(12,centralSize,true);d.setUint32(16,offset,true);
    return new Blob([...parts,...central,end],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  }
  function exportXLSX() {
    const rows=exportRows(),xmlRows=rows.map((row,ri)=>`<row r="${ri+1}">${row.map((value,ci)=>{const ref=`${String.fromCharCode(65+ci)}${ri+1}`;return typeof value==="number"?`<c r="${ref}"><v>${value}</v></c>`:`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`}).join("")}</row>`).join("");
    const files=[
      ["[Content_Types].xml",'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
      ["_rels/.rels",'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ["xl/workbook.xml",'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Laporan" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ["xl/_rels/workbook.xml.rels",'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
      ["xl/worksheets/sheet1.xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlRows}</sheetData></worksheet>`]
    ];
    download(makeZip(files),`laporan-keuangan-${today()}.xlsx`);notify("Laporan Excel berhasil diunduh.");
  }
  function exportPDF() {
    const rows=exportRows().slice(1);
    const popup=window.open("","_blank");
    if(!popup){notify("Izinkan pop-up browser untuk mencetak laporan PDF.",true);return;}
    const body=rows.map(r=>`<tr>${r.map((v,i)=>`<td>${esc(i===6?fmt(v):v)}</td>`).join("")}</tr>`).join("");
    popup.document.write(`<!doctype html><html lang="id"><meta charset="utf-8"><title>Laporan ${APP_NAME}</title><style>body{font:12px Arial;padding:24px;color:#253247}h1{font-size:20px}p{color:#637087}table{border-collapse:collapse;width:100%}td,th{border:1px solid #dfe5ec;padding:7px;text-align:left}th{background:#eef3fa}@media print{button{display:none}}</style><h1>Laporan ${APP_NAME}</h1><p>Diekspor ${formatDate(today(),{day:"2-digit",month:"long",year:"numeric"})}</p><table><thead><tr>${exportRows()[0].map(x=>`<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table><script>window.onload=()=>window.print()<\\/script></html>`);
    popup.document.close();
  }
  function exportBackup() {
    const data={...state,exportedAt:new Date().toISOString(),format:"catatan-keuangan-backup-v1"};
    download(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),`cadangan-catatan-keuangan-${today()}.json`);notify("Cadangan data berhasil diunduh.");
  }
  function validateBackup(data) {
    if(!data||data.format!=="catatan-keuangan-backup-v1"||!Array.isArray(data.accounts)||!data.accounts.length||!Array.isArray(data.transactions)||!Array.isArray(data.categories)||!Array.isArray(data.notes)||!Array.isArray(data.trash)||!data.settings||typeof data.settings!=="object")return false;
    if(typeof data.settings.userName!=="string"||!data.settings.userName.trim()||!["light","dark"].includes(data.settings.theme)||!["id-ID","en-GB"].includes(data.settings.dateFormat)||(data.settings.timeFormat!==undefined&&!["12h","24h"].includes(data.settings.timeFormat))||typeof data.settings.pin!=="string"||(data.settings.pin&&!/^\d{4,8}$/.test(data.settings.pin)))return false;
    if(data.settings.profilePhoto!==undefined&&(typeof data.settings.profilePhoto!=="string"||data.settings.profilePhoto.length>5_000_000||!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(data.settings.profilePhoto)))return false;
    const validId = id => typeof id === "string" && id.trim().length > 0;
    if(data.accounts.some(a=>!a||!validId(a.id)||typeof a.name!=="string"||!a.name.trim()||typeof a.type!=="string"||!Number.isSafeInteger(Number(a.openingBalance))||Number(a.openingBalance)<0))return false;
    const accountIds=new Set(data.accounts.map(a=>a.id));
    if(accountIds.size!==data.accounts.length)return false;
    const transactionIds=new Set();
    const validTx=tx=>{
      if(!tx||!validId(tx.id)||transactionIds.has(tx.id)||!["income","expense","transfer"].includes(tx.type)||!Number.isSafeInteger(Number(tx.amount))||Number(tx.amount)<=0||!isValidISODate(tx.date)||(tx.time&&!isValidTime(tx.time)))return false;
      if(tx.type==="transfer"?(!accountIds.has(tx.fromAccountId)||!accountIds.has(tx.toAccountId)||tx.fromAccountId===tx.toAccountId):(!accountIds.has(tx.accountId)||typeof tx.name!=="string"||!tx.name.trim()))return false;
      if(tx.receipt!==undefined&&(typeof tx.receipt!=="string"||tx.receipt.length>5_000_000||!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(tx.receipt)))return false;
      if(tx.items!==undefined&&(!Array.isArray(tx.items)||tx.items.some(item=>!item||typeof item.name!=="string"||!item.name.trim()||!Number.isSafeInteger(item.quantity)||item.quantity<1||!Number.isSafeInteger(item.price)||item.price<0||!Number.isSafeInteger(item.quantity*item.price))))return false;
      transactionIds.add(tx.id);
      return true;
    };
    const categoryIds=new Set();
    const validCategories=data.categories.every(c=>{
      if(!c||!validId(c.id)||categoryIds.has(c.id)||typeof c.name!=="string"||!c.name.trim()||!["income","expense"].includes(c.type))return false;
      categoryIds.add(c.id);
      return true;
    });
    const noteIds=new Set();
    const validNotes=data.notes.every(n=>{
      if(!n||!validId(n.id)||noteIds.has(n.id)||typeof n.title!=="string"||!n.title.trim()||typeof n.body!=="string"||!isValidISODate(n.date))return false;
      noteIds.add(n.id);
      return true;
    });
    return data.transactions.every(validTx)&&data.trash.every(validTx)&&validCategories&&validNotes;
  }
  function drawChart() {
    const canvas=document.getElementById("finance-chart");if(!canvas)return;
    const rect=canvas.getBoundingClientRect(),ratio=window.devicePixelRatio||1;canvas.width=Math.max(1,rect.width*ratio);canvas.height=Math.max(1,rect.height*ratio);
    const ctx=canvas.getContext("2d");ctx.scale(ratio,ratio);const w=rect.width,h=rect.height,pad={l:42,r:10,t:14,b:32},cw=w-pad.l-pad.r,ch=h-pad.t-pad.b;
    const months=Array.from({length:6},(_,i)=>{const date=new Date();date.setDate(1);date.setMonth(date.getMonth()-5+i);const key=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`;const ts=activeTransactions().filter(t=>t.date.startsWith(key));return {label:new Intl.DateTimeFormat("id-ID",{month:"short"}).format(date),...totals(ts)};});
    const max=Math.max(1,...months.flatMap(m=>[m.income,m.expense]));ctx.font="9px DM Sans, sans-serif";ctx.textAlign="right";ctx.fillStyle="#98a3b1";ctx.strokeStyle=getComputedStyle(document.body).getPropertyValue("--line");
    for(let i=0;i<4;i++){const y=pad.t+ch*i/3;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();ctx.fillText(i===0?fmt(max).replace("Rp",""):i===3?"0":fmt(max*(1-i/3)).replace("Rp",""),pad.l-6,y+3);}
    const slot=cw/months.length,bw=Math.min(13,slot*.28);
    let tooltip=canvas.parentElement.querySelector(".chart-tooltip");
    if(!tooltip){tooltip=document.createElement("div");tooltip.className="chart-tooltip";canvas.parentElement.append(tooltip);}
    const slots=months.map((m,i)=>({x:pad.l+slot*(i+.5),month:m}));
    canvas.onmousemove=event=>{const box=canvas.getBoundingClientRect(),x=event.clientX-box.left,y=event.clientY-box.top,hit=slots.find(item=>Math.abs(item.x-x)<slot/2&&y>=pad.t&&y<=pad.t+ch);if(!hit){tooltip.hidden=true;return;}tooltip.innerHTML=`<strong>${esc(hit.month.label)}</strong><br><span class="income-text">Menerima ${fmt(hit.month.income)}</span><br><span class="expense-text">Membayar ${fmt(hit.month.expense)}</span>`;tooltip.hidden=false;tooltip.style.left=`${Math.min(box.width-150,Math.max(4,x+10))}px`;tooltip.style.top=`${Math.max(0,y-18)}px`;};
    canvas.onmouseleave=()=>{tooltip.hidden=true;};
    months.forEach((m,i)=>{const x=pad.l+slot*(i+.5);const hi=ch*m.income/max,he=ch*m.expense/max;ctx.fillStyle="#19a879";ctx.beginPath();ctx.roundRect(x-bw-2,pad.t+ch-hi,bw,hi,3);ctx.fill();ctx.fillStyle="#e3636d";ctx.beginPath();ctx.roundRect(x+2,pad.t+ch-he,bw,he,3);ctx.fill();ctx.textAlign="center";ctx.fillStyle="#8793a2";ctx.fillText(m.label,x,h-8);});
  }

  document.addEventListener("click",event=>{
    const pageButton=event.target.closest("[data-page]");
    if(pageButton){event.preventDefault();page=pageButton.dataset.page;document.getElementById("sidebar").classList.remove("open");render();return;}
    const periodButton=event.target.closest("[data-period]");
    if(periodButton){period=periodButton.dataset.period;render();return;}
    const txRow=event.target.closest("[data-transaction]");
    if(txRow){renderTransactionDetail(txRow.dataset.transaction);return;}
    const dayButton=event.target.closest("[data-date]");
    if(dayButton){selectedDate=dayButton.dataset.date;const date=new Date(`${selectedDate}T00:00:00`);if(date.getMonth()!==calendarMonth.getMonth()||date.getFullYear()!==calendarMonth.getFullYear())calendarMonth=new Date(date.getFullYear(),date.getMonth(),1);render();return;}
    const key=event.target.closest("[data-calc]");
    if(key){calculatorKey(key.dataset.calc);return;}
    const clockFace=event.target.closest(".clock-face");
    if(clockFace&&timePickerStage==="minute"){
      const bounds=clockFace.getBoundingClientRect(),dx=event.clientX-(bounds.left+bounds.width/2),dy=(bounds.top+bounds.height/2)-event.clientY;
      timePickerValue.minutes=Math.round((Math.atan2(dx,dy)*30/Math.PI+60)%60);
      renderTimePicker();return;
    }
    const action=event.target.closest("[data-action]");if(!action)return;
    const id=action.dataset.id;
    switch(action.dataset.action){
      case "close-modal":closeModal();break;
      case "open-time-picker":showTimePicker(action.dataset.timeInput);break;
      case "clock-stage-hour":timePickerStage="hour";renderTimePicker();break;
      case "clock-stage-minute":timePickerStage="minute";renderTimePicker();break;
      case "clock-select-hour":selectClockHour(action.dataset.clockValue);break;
      case "clock-select-minute":timePickerValue.minutes=Number(action.dataset.clockValue);renderTimePicker();break;
      case "clock-meridiem":timePickerValue.hours=timePickerValue.hours%12+(action.dataset.clockValue==="PM"?12:0);renderTimePicker();break;
      case "clock-confirm":restoreTimePickerForm(true);break;
      case "clock-cancel":restoreTimePickerForm();break;
      case "transaction-type":{
        const form=document.getElementById("transaction-form");
        form.elements.type.value=action.dataset.type;
        form.querySelectorAll(".transaction-type-tab").forEach(button=>button.classList.toggle("active",button.dataset.type===action.dataset.type));
        form.querySelector(".transaction-amount-label").textContent=`${action.dataset.type==="income"?"Kamu Menerima":"Kamu Membayar"} *`;
        break;
      }
      case "open-items":{
        document.querySelector(".transaction-layout").hidden=true;
        const panel=document.getElementById("transaction-items-panel");panel.hidden=false;renderItemsEditor();break;
      }
      case "add-item-row":transactionItems.push({name:"",quantity:1,price:0});renderItemsEditor();break;
      case "remove-item":transactionItems.splice(Number(action.dataset.index),1);renderItemsEditor();break;
      case "cancel-items":document.getElementById("transaction-items-panel").hidden=true;document.querySelector(".transaction-layout").hidden=false;break;
      case "save-items":{
        if(!transactionItems.length||transactionItems.some(item=>!item.name.trim()||!Number.isSafeInteger(item.quantity)||item.quantity<1||!Number.isSafeInteger(item.price)||item.price<0)){
          notify("Isi nama barang, jumlah, dan harga dengan benar.",true);break;
        }
        const total=transactionItems.reduce((sum,item)=>sum+item.quantity*item.price,0);
        if(!Number.isSafeInteger(total)){notify("Total barang melebihi batas angka yang didukung.",true);break;}
        document.querySelector('#transaction-form [name="amount"]').value=total?groupedInteger(total):"";
        document.getElementById("transaction-items-panel").hidden=true;document.querySelector(".transaction-layout").hidden=false;
        document.querySelector("#items-button span").textContent=`Tambah Barang (${transactionItems.length})`;
        break;
      }
      case "remove-receipt":transactionReceipt="";renderReceiptPreview();break;
      case "remove-profile-photo":
        delete state.settings.profilePhoto;
        persist("Foto profil berhasil dihapus.");
        break;
      case "install-app":installApp();break;
      case "add-income":transactionForm("income");break;
      case "add-expense":transactionForm("expense");break;
      case "add-account":accountForm();break;
      case "edit-account":accountForm(id);break;
      case "delete-account":removeAccount(id);break;
      case "add-transfer":transferForm();break;
      case "edit-transfer":closeModal();transferForm(id);break;
      case "edit-transaction":closeModal();transactionForm("expense",id);break;
      case "trash-transaction":closeModal();deleteTransaction(id);break;
      case "add-category":categoryForm();break;
      case "edit-category":categoryForm(id);break;
      case "delete-category":removeCategory(id);break;
      case "add-note":noteForm();break;
      case "edit-note":noteForm(id);break;
      case "delete-note":removeNote(id);break;
      case "restore-transaction":restoreTransaction(id);break;
      case "delete-permanently":permanentlyDelete(id);break;
      case "calendar-prev":calendarMonth.setMonth(calendarMonth.getMonth()-1);selectedDate=today();if(new Date(`${selectedDate}T00:00:00`).getMonth()!==calendarMonth.getMonth())selectedDate=`${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth()+1).padStart(2,"0")}-01`;render();break;
      case "calendar-next":calendarMonth.setMonth(calendarMonth.getMonth()+1);selectedDate=`${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth()+1).padStart(2,"0")}-01`;render();break;
      case "save-settings":saveSettings();break;
      case "export-xlsx":exportXLSX();break;
      case "export-pdf":exportPDF();break;
      case "export-backup":exportBackup();break;
      case "clear-all-data":clearAllData();break;
      case "reset-report-filter":reportFilters={from:"",to:"",account:"",type:""};render();break;
    }
  });
  document.addEventListener("submit",event=>{
    const form=event.target;if(!(form instanceof HTMLFormElement))return;
    event.preventDefault();const data=Object.fromEntries(new FormData(form).entries());
    const formType=form.getAttribute("id");
    if(formType==="unlock-form"){
      if(data.pin!==state.settings.pin){notify("PIN tidak cocok.",true);form.reset();form.elements.pin.focus();return;}
      unlocked=true;delete document.getElementById("modal-layer").dataset.locked;closeModal();return;
    }
    if(formType==="onboarding-form"){
      const userName=String(data.userName||"").trim();
      const accountName=String(data.accountName||"").trim();
      if(!userName||!accountName){notify("Nama pengguna dan nama akun wajib diisi.",true);form.elements[!userName?"userName":"accountName"].focus();return;}
      state.settings={...state.settings,userName};
      if(state.accounts[0])state.accounts[0].name=accountName;
      needsUserName=false;
      persist();
      closeModal();
      if(state.settings.pin)lockApp();
      return;
    }
    if(formType==="transaction-form"){
      const type=data.type,amount=parseMoneyInput(data.amount);
      if(!["income","expense"].includes(type)){notify("Pilih jenis transaksi yang valid.",true);return;}
      if(!document.getElementById("transaction-items-panel").hidden){notify("Simpan atau batalkan daftar barang terlebih dahulu.",true);return;}
      if(!data.note.trim()){notify("Nama transaksi atau catatan wajib diisi.",true);form.elements.note.focus();return;}
      if(!Number.isSafeInteger(amount)||amount<=0){notify("Nominal harus berupa angka Rupiah positif.",true);return;}
      if(!accountById(data.accountId)){notify("Pilih akun yang masih tersedia.",true);return;}
      if(!isValidISODate(data.date)||!isValidTime(data.time)){notify("Tanggal atau jam transaksi tidak valid.",true);return;}
      const existing=state.transactions.find(t=>t.id===data.id);
      const itemName=transactionItems[0]?.name.trim();
      const name=data.name.trim()||itemName||data.note.trim().slice(0,80)|| (type==="income"?"Pemasukan":"Pengeluaran");
      const tx={id:data.id||makeId(),type,name,amount,accountId:data.accountId,date:data.date,time:data.time,note:data.note.trim(),...(transactionItems.length?{items:transactionItems.map(item=>({...item}))}:{}),...(transactionReceipt?{receipt:transactionReceipt}:{})};
      if(existing)state.transactions=state.transactions.map(t=>t.id===tx.id?tx:t);else state.transactions.push(tx);
      const continueAfterSave=event.submitter?.dataset.continue==="true";
      closeModal();persist(existing?"Transaksi berhasil diperbarui.":"Transaksi berhasil disimpan.");
      if(continueAfterSave)transactionForm(type);
      return;
    }
    if(formType==="transfer-form"){
      const amount=parseMoneyInput(data.amount);if(!Number.isSafeInteger(amount)||amount<=0){notify("Nominal transfer harus angka Rupiah positif.",true);return;}
      if(data.fromAccountId===data.toAccountId){notify("Akun asal dan tujuan harus berbeda.",true);return;}
      if(!accountById(data.fromAccountId)||!accountById(data.toAccountId)||!isValidISODate(data.date)||!isValidTime(data.time)){notify("Akun, tanggal, atau jam transfer tidak valid.",true);return;}
      const existing=state.transactions.find(t=>t.id===data.id),tx={id:data.id||makeId(),type:"transfer",fromAccountId:data.fromAccountId,toAccountId:data.toAccountId,amount,date:data.date,time:data.time,note:data.note.trim()};
      if(existing)state.transactions=state.transactions.map(t=>t.id===tx.id?tx:t);else state.transactions.push(tx);
      closeModal();persist(existing?"Transfer berhasil diperbarui.":"Transfer berhasil dicatat.");return;
    }
    if(formType==="account-form"){
      const openingBalance=parseMoneyInput(data.openingBalance);if(!Number.isSafeInteger(openingBalance)||openingBalance<0){notify("Saldo awal harus angka Rupiah nol atau lebih.",true);return;}
      if(!data.name.trim()){notify("Nama akun wajib diisi.",true);return;}
      const existing=state.accounts.find(a=>a.id===data.id),account={id:data.id||makeId(),name:data.name.trim(),type:data.type,openingBalance};
      if(existing)state.accounts=state.accounts.map(a=>a.id===account.id?account:a);else state.accounts.push(account);
      closeModal();persist(existing?"Akun berhasil diperbarui.":"Akun berhasil ditambahkan.");return;
    }
    if(formType==="category-form"){
      if(!data.name.trim()){notify("Nama kategori wajib diisi.",true);return;}
      const existing=state.categories.find(c=>c.id===data.id),category={id:data.id||makeId(),name:data.name.trim(),type:data.type};
      if(existing){state.categories=state.categories.map(c=>c.id===category.id?category:c);state.transactions=state.transactions.map(t=>t.category===existing.name&&t.type===existing.type?{...t,category:category.name}:t);}
      else state.categories.push(category);
      closeModal();persist(existing?"Kategori berhasil diperbarui.":"Kategori berhasil ditambahkan.");return;
    }
    if(formType==="note-form"){
      if(!data.title.trim()||!data.body.trim()||!isValidISODate(data.date)){notify("Judul, isi, dan tanggal catatan wajib diisi dengan benar.",true);return;}
      const existing=state.notes.find(n=>n.id===data.id),note={id:data.id||makeId(),title:data.title.trim(),body:data.body.trim(),date:data.date};
      if(existing)state.notes=state.notes.map(n=>n.id===note.id?note:n);else state.notes.push(note);
      closeModal();persist(existing?"Catatan berhasil diperbarui.":"Catatan berhasil disimpan.");
    }
  });
  function removeAccount(id) {
    const account=accountById(id);if(!account)return;
    if(state.accounts.length===1){notify("Minimal satu akun harus tersedia.",true);return;}
    const used=state.transactions.some(t=>t.accountId===id||t.fromAccountId===id||t.toAccountId===id)||state.trash.some(t=>t.accountId===id||t.fromAccountId===id||t.toAccountId===id);
    if(used){notify("Akun memiliki riwayat transaksi. Pindahkan atau hapus transaksinya sebelum menghapus akun.",true);return;}
    if(!confirm(`Hapus akun "${account.name}"?`))return;
    state.accounts=state.accounts.filter(a=>a.id!==id);persist("Akun berhasil dihapus.");
  }
  function removeCategory(id) {
    const category=state.categories.find(c=>c.id===id);if(!category)return;
    if(!confirm(`Hapus kategori "${category.name}"?`))return;
    state.categories=state.categories.filter(c=>c.id!==id);persist("Kategori berhasil dihapus.");
  }
  function removeNote(id) {
    if(!confirm("Hapus catatan ini?"))return;
    state.notes=state.notes.filter(n=>n.id!==id);persist("Catatan berhasil dihapus.");
  }
  function restoreTransaction(id) {
    const tx=state.trash.find(t=>t.id===id);if(!tx)return;
    if(tx.type==="transfer"&&(!accountById(tx.fromAccountId)||!accountById(tx.toAccountId))){notify("Akun transfer tidak ditemukan. Buat kembali akun terkait sebelum memulihkan.",true);return;}
    if(tx.type!=="transfer"&&!accountById(tx.accountId)){notify("Akun transaksi tidak ditemukan. Buat kembali akun terkait sebelum memulihkan.",true);return;}
    state.trash=state.trash.filter(t=>t.id!==id);const restored={...tx};delete restored.deletedAt;state.transactions.push(restored);persist("Transaksi berhasil dipulihkan.");
  }
  function permanentlyDelete(id) {
    if(!confirm("Hapus transaksi ini secara permanen? Tindakan ini tidak dapat dibatalkan."))return;
    state.trash=state.trash.filter(t=>t.id!==id);persist("Transaksi dihapus permanen.");
  }
  function clearAllData() {
    if(!confirm("Hapus semua data aplikasi secara permanen? Disarankan unduh cadangan terlebih dahulu."))return;
    state=defaults();needsUserName=true;persist("Data aplikasi berhasil dikosongkan.");promptForUserName();
  }
  function saveSettings() {
    const userName=document.getElementById("setting-user").value.trim(),pin=document.getElementById("setting-pin").value;
    if(!userName){notify("Nama pengguna wajib diisi.",true);return;}
    if(pin&&!/^\d{4,8}$/.test(pin)){notify("PIN harus terdiri dari 4 sampai 8 angka.",true);return;}
    state.settings={...state.settings,userName,pin,theme:document.getElementById("setting-theme").checked?"dark":"light",dateFormat:document.getElementById("setting-date").value,timeFormat:document.getElementById("setting-time").value};persist("Pengaturan berhasil disimpan.");
    if(pin)lockApp();
  }
  function calculatorKey(key) {
    const calculate = (operator, left, right) => {
      if (operator === "+") return left + right;
      if (operator === "−") return left - right;
      if (operator === "×") return left * right;
      return right === 0 ? NaN : left / right;
    };
    if(key==="C"){calcValue="0";calcPending=null;calcStored=null;calcJustEvaluated=false;}
    else if(key==="±"&&calcValue!=="Error"){calcValue=String(Number(calcValue)*-1);}
    else if(key==="%"&&calcValue!=="Error"){calcValue=String(Number(calcValue)/100);}
    else if(["+","−","×","÷"].includes(key)){
      if(calcValue==="Error"){calcValue="0";calcPending=null;calcStored=null;}
      if(calcPending){
        const result=calculate(calcPending,calcStored,Number(calcValue));
        if(!Number.isFinite(result)){calcValue="Error";calcPending=null;calcStored=null;}
        else{calcValue=String(Number(result.toFixed(8)));calcStored=Number(calcValue);calcPending=key;calcValue="0";}
      }else{calcPending=key;calcStored=Number(calcValue);calcValue="0";}
      calcJustEvaluated=false;
    }
    else if(key==="="&&calcPending){const result=calculate(calcPending,calcStored,Number(calcValue));calcValue=Number.isFinite(result)?String(Number(result.toFixed(8))):"Error";calcPending=null;calcStored=null;calcJustEvaluated=true;}
    else if(key==="."){if(calcJustEvaluated||calcValue==="Error")calcValue="0.";else if(!calcValue.includes("."))calcValue+=".";calcJustEvaluated=false;}
    else if(/^\d$/.test(key)){calcValue=calcJustEvaluated||calcValue==="Error"||calcValue==="0"?key:calcValue.length<16?calcValue+key:calcValue;calcJustEvaluated=false;}
    const display=document.getElementById("calc-display");if(display)display.textContent=calcValue;
  }
  document.addEventListener("input",event=>{
    if(event.target.matches("[data-money-input]"))formatMoneyField(event.target);
    if(event.target.id==="search-input"){searchTerm=event.target.value;if(page==="home"){const position=event.target.selectionStart;render();const input=document.getElementById("search-input");input.value=searchTerm;input.focus();input.setSelectionRange(position,position);} }
    if(event.target.matches("[data-item-field]")){
      const row=event.target.closest("[data-item-index]"),item=transactionItems[Number(row.dataset.itemIndex)];
      if(!item)return;
      const field=event.target.dataset.itemField;
      item[field]=field==="name"?event.target.value:field==="price"?parseMoneyInput(event.target.value):Number(event.target.value);
      const total=transactionItems.reduce((sum,current)=>sum+current.quantity*current.price,0),display=document.getElementById("item-total");
      if(display)display.textContent=Number.isSafeInteger(total)?fmt(total):"—";
    }
  });
  document.addEventListener("change",async event=>{
    if(event.target.matches(".report-filter")){
      reportFilters={from:document.getElementById("filter-from").value,to:document.getElementById("filter-to").value,account:document.getElementById("filter-account").value,type:document.getElementById("filter-type").value};
      render();return;
    }
    if(event.target.id==="restore-file"){
      const file=event.target.files?.[0];if(!file)return;
      const reader=new FileReader();reader.onload=()=>{try{const data=JSON.parse(String(reader.result));if(!validateBackup(data))throw new Error("Struktur cadangan tidak valid.");if(!confirm("Pulihkan cadangan ini? Data aplikasi saat ini akan digantikan."))return;const {exportedAt,format,...rest}=data;state=rest;persist("Cadangan berhasil dipulihkan.");}catch(error){notify(`Cadangan gagal dipulihkan: ${error.message}`,true);}finally{event.target.value="";}};reader.onerror=()=>notify("Berkas cadangan tidak dapat dibaca.",true);reader.readAsText(file);
      return;
    }
    if(event.target.id==="receipt-file"){
      const file=event.target.files?.[0];if(!file)return;
      try{transactionReceipt=await compressReceipt(file);renderReceiptPreview();}
      catch(error){notify(`Bukti transaksi gagal ditambahkan: ${error.message}`,true);}
      finally{event.target.value="";}
    }
    if(event.target.id==="setting-profile-photo"){
      const file=event.target.files?.[0];if(!file)return;
      try{
        state.settings.profilePhoto=await compressReceipt(file);
        persist("Foto profil berhasil diperbarui.");
      }catch(error){notify(`Foto profil gagal ditambahkan: ${error.message}`,true);}
      finally{event.target.value="";}
    }
  });
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape"&&unlocked&&!needsUserName){if(timePickerForm)restoreTimePickerForm();else closeModal();}
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="k"){event.preventDefault();document.getElementById("search-input").focus();}
    if(event.target.matches("[data-transaction]")&&(event.key==="Enter"||event.key===" ")){event.preventDefault();renderTransactionDetail(event.target.dataset.transaction);}
  });
  document.getElementById("menu-toggle").addEventListener("click",()=>document.getElementById("sidebar").classList.toggle("open"));
  document.getElementById("sidebar-close").addEventListener("click",()=>document.getElementById("sidebar").classList.remove("open"));
  document.getElementById("modal-layer").addEventListener("click",event=>{if(event.target.getAttribute("id")==="modal-layer"&&unlocked&&!needsUserName){if(timePickerForm)restoreTimePickerForm();else closeModal();}});
  window.addEventListener("beforeinstallprompt",event=>{
    event.preventDefault();
    deferredInstallPrompt=event;
  });
  window.addEventListener("appinstalled",()=>{
    deferredInstallPrompt=null;
    notify("Catat Uangmu berhasil dipasang.");
  });
  async function installApp() {
    if(deferredInstallPrompt){
      const promptEvent=deferredInstallPrompt;
      deferredInstallPrompt=null;
      await promptEvent.prompt();
      const choice=await promptEvent.userChoice;
      if(choice.outcome==="accepted")notify("Proses pemasangan Catat Uangmu dimulai.");
      return;
    }
    if(window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone){
      notify("Catat Uangmu sudah terpasang.");
      return;
    }
    notify("Untuk memasang aplikasi, buka situs Catat Uangmu melalui Chrome Android, lalu pilih menu ⋮ > Instal aplikasi.");
  }
  if("serviceWorker" in navigator&&(location.protocol==="https:"||["localhost","127.0.0.1"].includes(location.hostname))){
    navigator.serviceWorker.register("./service-worker.js").catch(error=>{
      console.error("Service worker Catat Uangmu gagal didaftarkan:",error);
      notify("Fitur offline aplikasi tidak dapat diaktifkan.",true);
    });
  }
  window.addEventListener("resize",()=>{if(page==="reports"||page==="all-reports")drawChart();});
  updateBrand();updateTrashCount();render();
  if(needsUserName)promptForUserName();
  else if(state.settings.pin)lockApp();
})();
