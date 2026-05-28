// ─── THEME (data-theme system) ───────────────────────────────────────────────
(function applyStoredTheme() {
  const saved = localStorage.getItem('emptracker-theme');
  if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.addEventListener('DOMContentLoaded', () => _updateThemeBtn('dark'));
  }
})();
let currentUser = null;
let employees = [];
let allEmployeesData = [];
let currentAdjRecord = null;

const SHIFT_MINS = 480;
const ALLOWED_BREAK = 40;
const MONTHS = ['','January','February','March','April','May','June',
                'July','August','September','October','November','December'];

function currencySymbol(c) { return c === 'AED' ? 'AED ' : c === 'PHP' ? '₱' : '£'; }
function fmtMoney(amount, currency) { return currencySymbol(currency) + Number(amount || 0).toLocaleString('en-GB', {minimumFractionDigits:2}); }
function fmt(n) { return Number(n||0).toLocaleString('en-GB', {minimumFractionDigits:2, maximumFractionDigits:2}); }

// ─── THEME ───────────────────────────────────────────────────────────────────
(function applyStoredTheme() {
  const saved = localStorage.getItem('emptracker-theme');
  if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    // update button once DOM is ready
    document.addEventListener('DOMContentLoaded', () => _updateThemeBtn('dark'));
  }
})();

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  if (next === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  localStorage.setItem('emptracker-theme', next);
  _updateThemeBtn(next);
}

function _updateThemeBtn(theme) {
  const icon  = document.getElementById('themeToggleIcon');
  const label = document.getElementById('themeToggleLabel');
  if (!icon || !label) return;
  if (theme === 'dark') {
    icon.textContent  = '☀️';
    label.textContent = 'Light Mode';
  } else {
    icon.textContent  = '🌙';
    label.textContent = 'Dark Mode';
  }
}

// ─── SIDEBAR COLLAPSE ─────────────────────────────────────────────────────────
function toggleSidebar() {
  const collapsed = document.body.classList.toggle('sidebar-collapsed');
  localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0');
}
(function applySidebarState() {
  if (localStorage.getItem('sidebar-collapsed') === '1') {
    document.body.classList.add('sidebar-collapsed');
  }
})();

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const res = await fetch('/api/me');
  if (!res.ok) { window.location.href = '/login.html'; return; }
  currentUser = await res.json();
  window.currentUser = currentUser;

  // Check user role before initializing
  if (currentUser.role === 'employee') {
    await initEmployeePortal(currentUser);
    return;
  }
  const initials = currentUser.username.slice(0,2).toUpperCase();
  document.getElementById('userLabel').innerHTML = `<div class="sidebar-user-pill"><div class="sidebar-user-avatar">${esc(initials)}</div><span class="sidebar-user-name">${esc(currentUser.username)}</span><span class="sidebar-user-role">${esc(currentUser.role)}</span></div>`;
  document.getElementById('todayDate').textContent = formatDate(today());

  if (currentUser.role === 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
  }
  if (currentUser.role === 'admin' || currentUser.role === 'manager' || currentUser.role === 'accounts') {
    document.querySelectorAll('.admin-manager-only').forEach(el => el.classList.remove('hidden'));
  }

  const m = thisMonth();
  document.getElementById('repFrom').value = m.from;
  document.getElementById('repTo').value = m.to;
  document.getElementById('trackMonth').value = m.from.slice(0, 7);

  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => { navigate(el.dataset.page); closeMobileNav(); });
  });

  // Mobile bottom nav
  document.querySelectorAll('.bottom-nav-item').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.page));
  });

  // Hamburger / drawer
  document.getElementById('hamburgerBtn')?.addEventListener('click', toggleMobileNav);
  document.getElementById('navOverlay')?.addEventListener('click', closeMobileNav);
  initSidebarCollapse();

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  await loadEmployees().catch(err => console.error('loadEmployees failed:', err));
  loadDashboard();
  refreshCalendarBadge();

  // Notification bell — admin only
  if (currentUser.role === 'admin') {
    document.getElementById('notifBellWrap').style.display = 'block';
    refreshNotifBadge();
    setInterval(refreshNotifBadge, 60000);
  }

  // Initial badge — silent, non-blocking
  fetch(`/api/salary-overview?year=${new Date().getFullYear()}`)
    .then(r => r.ok ? r.json() : [])
    .then(data => {
      const now = new Date();
      updateSalaryBadge(getUnpaidThisMonth(data, now.getFullYear(), now.getMonth() + 1).length);
    }).catch(() => {});
});

function toggleMobileNav() {
  const open = document.querySelector('.sidebar').classList.toggle('open');
  document.getElementById('hamburgerBtn').classList.toggle('open', open);
  document.getElementById('navOverlay').classList.toggle('open', open);
}
function closeMobileNav() {
  document.querySelector('.sidebar').classList.remove('open');
  document.getElementById('hamburgerBtn').classList.remove('open');
  document.getElementById('navOverlay').classList.remove('open');
}

// ─── SIDEBAR COLLAPSE ─────────────────────────────────────────────────────────
function initSidebarCollapse() {
  const sidebar = document.querySelector('.sidebar');
  const btn = document.getElementById('sidebarCollapseBtn');
  if (!sidebar || !btn) return;
  const collapsed = localStorage.getItem('sidebarCollapsed') === '1';
  if (collapsed) sidebar.classList.add('collapsed');
  btn.addEventListener('click', () => {
    const isNowCollapsed = sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebarCollapsed', isNowCollapsed ? '1' : '0');
  });
}

// ─── NAVIGATION ──────────────────────────────────────────────────────────────
function navigate(page) {
  // Salary and Employees sections are admin-only
  if ((page === 'salary' || page === 'employees') && currentUser?.role !== 'admin') return;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.bottom-nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
  document.querySelector(`.bottom-nav-item[data-page="${page}"]`)?.classList.add('active');
  const titles = { dashboard:'Dashboard', tracking:'Daily Tracking', salary:'Salary Tracker', employees:'Employees', reports:'Reports', calendar:'Calendar', admins:'Admin Users', hotels:'Hotel Expenses', subscriptions:'Subscriptions', portfolio:'Portfolio', deals:'Deal Tracker', eventkit:'Event Kit' };
  document.getElementById('pageTitle').textContent = titles[page] || page;
  if (page === 'employees') loadEmpTable();
  if (page === 'admins') loadAdmins();
  if (page === 'calendar') loadCalendar();
  if (page === 'salary') { loadSalaryPage(); renderSalaryReminderPanel(); }
  if (page === 'hotels') loadHotelExpenses();
  if (page === 'subscriptions') loadSubscriptions();
  if (page === 'portfolio') { loadPortfolio(); }
  if (page === 'deals') { loadDeals(); }
  if (page === 'eventkit') loadEventKitPage();
}

// ─── EMPLOYEES ───────────────────────────────────────────────────────────────
async function loadEmployees() {
  const res = await fetch('/api/employees');
  const raw = await res.json();
  employees = Array.isArray(raw) ? raw : [];
  ['trackEmp', 'repEmp', 'calEmpFilter', 'salaryEmpFilter'].forEach(id => {
    const sel = document.getElementById(id);
    const prev = sel.value;
    if (id === 'trackEmp') sel.innerHTML = '<option value="">-- Select Employee --</option>';
    else sel.innerHTML = '<option value="">All Employees</option>';
    employees.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.id; opt.textContent = e.name; sel.appendChild(opt);
    });
    if (prev) sel.value = prev;
  });
}

async function loadEmpTable() {
  const res = await fetch('/api/employees/all');
  allEmployeesData = await res.json();

  // Populate dept filter
  const deptSel = document.getElementById('empDeptFilter');
  if (deptSel) {
    const depts = [...new Set(allEmployeesData.map(e => e.department).filter(Boolean))].sort();
    deptSel.innerHTML = '<option value="">All</option>' + depts.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
  }

  // Update count tag and sub
  const activeEmps = allEmployeesData.filter(e => e.active);
  const countTag = document.getElementById('empCountTag');
  if (countTag) countTag.textContent = activeEmps.length;
  const payrollCount = activeEmps.filter(e => e.employment_type === 'payroll').length;
  const seCount = activeEmps.filter(e => e.employment_type === 'self_employed').length;
  const empSub = document.getElementById('empSub');
  if (empSub) empSub.textContent = `// ${payrollCount} payroll · ${seCount} self-employed`;

  renderEmpTable();
}

function filterEmpTable() {
  renderEmpTable();
}

function renderEmpTable() {
  const search = (document.getElementById('empSearch')?.value || '').trim().toLowerCase();
  const deptFilter = (document.getElementById('empDeptFilter')?.value || '').toLowerCase();
  const typeFilter = document.getElementById('empTypeFilter')?.value || '';
  let list = allEmployeesData;
  if (search) list = list.filter(e => (e.name || '').toLowerCase().includes(search) || (e.department || '').toLowerCase().includes(search));
  if (deptFilter) list = list.filter(e => (e.department || '').toLowerCase() === deptFilter);
  if (typeFilter) list = list.filter(e => e.employment_type === typeFilter);
  const tbody = document.getElementById('empTable');
  tbody.innerHTML = '';
  if (!list.length) {
    const msg = (search || deptFilter || typeFilter) ? 'No employees match your search.' : 'No employees yet.';
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="icon">👥</div><div>${msg}</div></div></td></tr>`;
    return;
  }
  list.forEach(emp => {
    const typeLabel  = emp.employment_type === 'self_employed' ? 'Self-Employed' : 'Payroll';
    const typeBadge  = emp.employment_type === 'self_employed' ? 'badge-yellow' : 'badge-blue';
    const terminated = !emp.active && emp.termination_date;
    const statusBadge = emp.active ? 'badge-green' : (terminated ? 'badge-red' : 'badge-grey');
    const statusLabel = emp.active ? 'Active' : (terminated ? `Terminated ${emp.termination_date.slice(0,10)}` : 'Inactive');
    const initials = (emp.name || '?').split(' ').filter(Boolean).slice(0,2).map(w => w[0]).join('').toUpperCase();
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:28px;height:28px;border-radius:7px;background:var(--accent-soft);border:1px solid var(--accent-line);color:var(--accent);font:700 10px/1 var(--font-mono);display:grid;place-items:center;flex-shrink:0">${initials}</div>
          <div>
            <div style="font-weight:600;color:var(--text);font-size:12.5px">${esc(emp.name)}</div>
            <div style="font-size:10.5px;color:var(--muted);font-family:var(--font-mono)">${esc(emp.job_title||emp.department||'')}</div>
          </div>
        </div>
      </td>
      <td>
        ${emp.department ? `<div style="font-weight:600;font-size:0.83rem">${esc(emp.department)}</div>` : ''}
        ${emp.job_title  ? `<div style="font-size:0.76rem;color:var(--muted)">${esc(emp.job_title)}</div>` : (!emp.department ? '<span style="color:var(--muted)">—</span>' : '')}
      </td>
      <td><span class="badge ${typeBadge}">${typeLabel}</span></td>
      <td>${emp.annual_salary > 0 ? fmtMoney(emp.annual_salary, emp.currency) + '/yr' : '—'}</td>
      <td>${emp.start_date ? emp.start_date.slice(0,10) : '<span style="color:var(--muted)">—</span>'}</td>
      <td><span class="badge ${statusBadge}" style="white-space:normal">${esc(statusLabel)}</span></td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-ghost btn-sm" onclick='openEmpModal(${JSON.stringify(emp)})'>Edit</button>
        ${!emp.portal_pin ? `<button class="btn btn-ghost btn-sm" style="color:#818cf8;border-color:#4f46e5" onclick="openAddPinModal(${emp.id},'${esc(emp.name)}')">Add PIN</button>` : ''}
        ${emp.active
          ? `<button class="btn btn-danger btn-sm" onclick="openTerminateModal(${emp.id},'${esc(emp.name)}')">Terminate</button>`
          : `<button class="btn btn-ghost btn-sm" onclick="reactivateEmployee(${emp.id})">Reactivate</button>
             <button class="btn btn-danger btn-sm" onclick="hardDeleteEmployee(${emp.id},'${esc(emp.name)}')">Delete</button>`}
      </td>`;
    tbody.appendChild(tr);
  });
}

function openEmpModal(emp = null) {
  document.getElementById('empId').value = emp ? emp.id : '';
  document.getElementById('empName').value = emp ? emp.name : '';
  document.getElementById('empStartDate').value = emp ? (emp.start_date || '') : today();
  document.getElementById('empType').value = emp ? (emp.employment_type || 'payroll') : 'payroll';
  document.getElementById('empCurrency').value = emp ? (emp.currency || 'GBP') : 'GBP';
  document.getElementById('empAnnualSalary').value = emp ? emp.annual_salary : 0;
  document.getElementById('empPensionRate').value = emp && emp.pension_rate != null ? emp.pension_rate : '';
  document.getElementById('empJobTitle').value = emp ? (emp.job_title || '') : '';
  document.getElementById('empDepartment').value = emp ? (emp.department || '') : '';
  document.getElementById('empPhone').value = emp ? (emp.phone || '') : '';
  document.getElementById('empEmail').value = emp ? (emp.email || '') : '';
  document.getElementById('empContractEnd').value = emp ? (emp.contract_end_date || '') : '';
  document.getElementById('empSalaryEffective').value = today();
  document.getElementById('empSalaryReason').value = '';
  document.getElementById('empPin').value = emp ? (emp.portal_pin || '') : '';
  document.getElementById('salaryChangeFields').classList.add('hidden');
  document.getElementById('empModalTitle').textContent = emp ? 'Edit Employee' : 'Add Employee';

  const togglePensionField = () => {
    const isPayroll = document.getElementById('empType').value === 'payroll';
    document.getElementById('pensionRateField').style.display = isPayroll ? '' : 'none';
  };
  document.getElementById('empType').onchange = togglePensionField;
  togglePensionField();

  // Show raise fields when salary value changes
  const salaryInput = document.getElementById('empAnnualSalary');
  const originalSalary = emp ? parseFloat(emp.annual_salary) : 0;
  salaryInput.oninput = () => {
    const changed = parseFloat(salaryInput.value) !== originalSalary && !!emp;
    document.getElementById('salaryChangeFields').classList.toggle('hidden', !changed);
  };
  openModal('empModal');
}

async function saveEmployee() {
  const id = document.getElementById('empId').value;
  const name = document.getElementById('empName').value.trim();
  const start_date = document.getElementById('empStartDate').value || null;
  const employment_type = document.getElementById('empType').value;
  const currency = document.getElementById('empCurrency').value;
  const annual_salary = parseFloat(document.getElementById('empAnnualSalary').value) || 0;
  const salary_reason = document.getElementById('empSalaryReason').value.trim();
  const salary_effective = document.getElementById('empSalaryEffective').value;
  const pensionRateVal = document.getElementById('empPensionRate').value;
  const pension_rate = employment_type === 'payroll' && pensionRateVal !== '' ? parseFloat(pensionRateVal) : 0;
  const job_title = document.getElementById('empJobTitle').value.trim();
  const department = document.getElementById('empDepartment').value.trim();
  const phone = document.getElementById('empPhone').value.trim();
  const email = document.getElementById('empEmail').value.trim();
  const contract_end_date = document.getElementById('empContractEnd').value || null;
  const portal_pin = document.getElementById('empPin').value.replace(/\D/g,'').slice(0,6) || null;
  if (!name) return showToast('Name is required', 'error');

  const payload = { name, employment_type, annual_salary, currency, start_date, pension_rate,
                    job_title, department, phone, email, contract_end_date, portal_pin };
  if (id) {
    await fetch(`/api/employees/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, active: 1, salary_reason, salary_effective })
    });
  } else {
    await fetch('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }
  closeModal('empModal');
  await loadEmployees();
  loadEmpTable();
}

function openTerminateModal(id, name) {
  document.getElementById('termEmpId').value = id;
  document.getElementById('termEmpName').textContent = name;
  document.getElementById('termDate').value = today();
  document.getElementById('termReason').value = 'Resigned';
  document.getElementById('termNotes').value = '';
  openModal('terminateModal');
}

async function confirmTerminate() {
  const id     = document.getElementById('termEmpId').value;
  const date   = document.getElementById('termDate').value;
  const reason = document.getElementById('termReason').value;
  const notes  = document.getElementById('termNotes').value.trim();
  if (!date) return showToast('Please select a termination date', 'error');
  const fullReason = notes ? `${reason} — ${notes}` : reason;
  const res = await fetch(`/api/employees/${id}/terminate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ termination_date: date, termination_reason: fullReason })
  });
  if (!res.ok) { const e = await res.json(); return showToast(e.error, 'error'); }
  closeModal('terminateModal');
  await loadEmployees();
  loadEmpTable();
}

async function openAddPinModal(id, name) {
  const pin = prompt(`Set portal PIN for ${name} (4–6 digits):`);
  if (pin === null) return;
  const cleaned = pin.replace(/\D/g,'').slice(0,6);
  if (cleaned.length < 4) { showToast('PIN must be 4–6 digits', 'error'); return; }
  const res = await fetch(`/api/employees/${id}/portal-pin`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: cleaned })
  });
  if (!res.ok) { showToast('Failed to set PIN', 'error'); return; }
  showToast(`PIN set for ${name}`, 'success');
  await loadEmployees();
  loadEmpTable();
}

async function reactivateEmployee(id) {
  if (!await showConfirm('Reactivate this employee? This clears the termination date.')) return;
  await fetch(`/api/employees/${id}/reactivate`, { method: 'POST' });
  await loadEmployees();
  loadEmpTable();
}

async function hardDeleteEmployee(id, name) {
  if (!await showConfirm(`Permanently delete "${name}"? This cannot be undone.`)) return;
  const res = await fetch(`/api/employees/${id}/hard`, { method: 'DELETE' });
  if (!res.ok) { const e = await res.json(); showToast(e.error || 'Delete failed', 'error'); return; }
  showToast('Employee deleted', 'success');
  await loadEmployees();
  loadEmpTable();
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
  const year = new Date().getFullYear();
  const now = new Date();
  const month = now.getMonth() + 1;

  document.getElementById('dashStats').innerHTML = `
    <div class="dash-bento">
      <div class="skeleton" style="height:200px;border-radius:18px"></div>
      <div class="dash-mini-grid">
        <div class="skeleton" style="height:72px;border-radius:14px"></div>
        <div class="skeleton" style="height:72px;border-radius:14px"></div>
        <div class="skeleton" style="height:72px;border-radius:14px"></div>
      </div>
    </div>
  `;

  const [summaryRes, salaryRes, upcomingRes, expiringRes, allEmpRes, hotelRes, dealsRes, evtRevRes, calCurRes, calNextRes] = await Promise.all([
    fetch(`/api/summary?from=${year}-01-01&to=${year}-12-31`),
    fetch(`/api/salary-overview?year=${year}`),
    fetch(`/api/calendar-reminders/upcoming?days=30`),
    fetch(`/api/contracts/expiring?days=60`),
    fetch(`/api/employees/all`),
    fetch(`/api/hotel-expenses`),
    fetch(`/api/deals`),
    fetch(`/api/deals/revenue-by-event`),
    fetch(`/api/calendar?year=${year}&month=${month}`),
    fetch(`/api/calendar?year=${month === 12 ? year + 1 : year}&month=${month === 12 ? 1 : month + 1}`)
  ]);

  const summary       = summaryRes.ok   ? await summaryRes.json()   : [];
  const salaryData    = salaryRes.ok    ? await salaryRes.json()    : [];
  const upcoming      = upcomingRes.ok  ? await upcomingRes.json()  : [];
  const expiring      = expiringRes.ok  ? await expiringRes.json()  : [];
  const allEmps       = allEmpRes.ok    ? await allEmpRes.json()    : [];
  const dashDeals     = dealsRes.ok     ? await dealsRes.json()     : [];
  const hotelData     = hotelRes.ok     ? await hotelRes.json()     : [];
  const evtRevData    = evtRevRes.ok    ? await evtRevRes.json()    : [];
  const calCur        = calCurRes.ok    ? await calCurRes.json()    : [];
  const calNext       = calNextRes.ok   ? await calNextRes.json()   : [];
  const todayStr      = now.toISOString().slice(0,10);
  const upcomingDayOffs = [...(Array.isArray(calCur) ? calCur : []), ...(Array.isArray(calNext) ? calNext : [])]
    .filter(r => r.record_date >= todayStr && parseFloat(r.is_day_off) > 0)
    .sort((a,b) => a.record_date.localeCompare(b.record_date));

  const activeEmps    = allEmps.filter(e => e.active);
  const unpaidCount   = getUnpaidThisMonth(salaryData, year, month).length;
  updateSalaryBadge(unpaidCount);

  const totalHeadcount  = activeEmps.length;
  const payrollCount    = activeEmps.filter(e => e.employment_type === 'payroll').length;
  const seCount         = activeEmps.filter(e => e.employment_type === 'self_employed').length;

  // Total salary remaining to pay this year — all currencies converted to GBP
  const SALARY_FX = { GBP: 1, AED: 1/4.67, PHP: 0.0138 };
  const salToGBP = (v, c) => v * (SALARY_FX[c] || 1);
  const totalGBPRemaining = salaryData
    .filter(e => !e.is_terminated)
    .reduce((a, e) => {
      const r = Math.max(0, parseFloat(e.net_remaining) || 0);
      return a + salToGBP(r, e.currency || 'GBP');
    }, 0);

  // Hotel fees remaining (unpaid + partial rows: paid_amount vs cost where parseable)
  const hotelUnpaidCount = hotelData.filter(h => h.status !== 'paid').length;
  const hotelPaidTotal   = hotelData.reduce((a, h) => a + (parseFloat(h.paid_amount) || 0), 0);

  document.getElementById('dashStats').innerHTML = `
    <div class="dash-bento dash-bento--3col">
      <div class="dash-hero-card dash-hero-card--compact">
        <div class="dash-hero-glow"></div>
        <div class="dash-hero-label">Active Headcount</div>
        <div class="dash-hero-value dash-hero-value--sm">${totalHeadcount}</div>
        <div class="dash-hero-pills">
          <span class="dash-hero-pill dash-hero-pill--blue">${payrollCount} Payroll</span>
          <span class="dash-hero-pill dash-hero-pill--amber">${seCount} Self-Emp</span>
        </div>
        <div style="margin-top:auto;padding-top:12px;border-top:1px solid rgba(255,255,255,0.08);cursor:pointer" onclick="navigate('salary')">
          <div style="font:600 9px/1 var(--font-mono);text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:6px">Unpaid This Month</div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font:700 24px/1 var(--font-mono);color:${unpaidCount > 0 ? 'var(--warning)' : 'var(--positive)'}">${unpaidCount}</span>
            <span style="font:500 11px/1.3 var(--font-mono);color:var(--muted)">${unpaidCount > 0 ? 'Action required →' : 'All paid up'}</span>
          </div>
        </div>
        <div class="dash-hero-footer">Total workforce · ${year}</div>
      </div>
      <div id="headcountPanel"></div>
      <div class="dash-mini-grid">
        <div class="dash-mini-card dash-mini--indigo" style="cursor:pointer" onclick="navigate('salary')" title="Go to salary page">
          <div class="dash-mini-icon">💷</div>
          <div class="dash-mini-body">
            <div class="dash-mini-label">Salaries Remaining</div>
            <div class="dash-mini-value">£${fmtK(totalGBPRemaining)}</div>
            <div class="dash-mini-sub">GBP outstanding · ${year}</div>
          </div>
        </div>
        <div class="dash-mini-card ${hotelUnpaidCount > 0 ? 'dash-mini--alert' : 'dash-mini--green'}" style="cursor:pointer" onclick="navigate('hotels')" title="View hotel expenses">
          <div class="dash-mini-icon">🏨</div>
          <div class="dash-mini-body">
            <div class="dash-mini-label">Hotel Fees Remaining</div>
            <div class="dash-mini-value">${hotelUnpaidCount} event${hotelUnpaidCount !== 1 ? 's' : ''}</div>
            <div class="dash-mini-sub">${hotelUnpaidCount > 0 ? `${hotelUnpaidCount} unpaid / partial →` : 'All settled'}</div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Revenue Intelligence + contract expiry panel
  renderRevenueIntelPanel(dashDeals, expiring, evtRevData);

  // Headcount by department (now renders into #headcountPanel inside the bento)
  renderHeadcountPanel(activeEmps, payrollCount, seCount, totalHeadcount, year);

  // Upcoming reminders panel (calendar reminders + day offs)
  renderDashUpcoming(upcoming, upcomingDayOffs);

  // Activity feed
  renderDashActivity(summary, expiring, hotelData, salaryData);

  const tbody = document.getElementById('dashTable');
  tbody.innerHTML = '';
  summary.forEach(row => {
    const emp = allEmps.find(e => e.id === row.employee_id);
    const typeBadge = row.employment_type === 'self_employed' ? 'badge-yellow' : 'badge-blue';
    const typeLabel = row.employment_type === 'self_employed' ? 'Self-Emp' : 'Payroll';
    const daysColor = row.excess_days > 0 ? 'text-danger fw-bold' : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="font-weight:700">${esc(row.name)}</div>
        ${emp?.job_title ? `<div style="font-size:0.73rem;color:var(--muted)">${esc(emp.job_title)}</div>` : ''}
      </td>
      <td>${emp?.department ? `<span style="font-size:0.82rem;font-weight:600">${esc(emp.department)}</span>` : '<span style="color:var(--muted)">—</span>'}</td>
      <td><span class="badge ${typeBadge}">${typeLabel}</span></td>
      <td class="${daysColor}">${row.year_days_off} / ${row.allowance_days}</td>
      <td>${row.excess_days > 0 ? `<span class="badge badge-red">${row.excess_days} excess</span>` : '<span class="badge badge-green">OK</span>'}</td>
      <td style="color:var(--primary)">£${(row.ref_time_amount||0).toFixed(2)}</td>
      <td class="${row.excess_day_deduction > 0 ? 'text-danger fw-bold' : ''}">£${(row.excess_day_deduction||0).toFixed(2)}</td>
      <td class="${row.total_deduction > 0 ? 'text-danger fw-bold' : ''}">£${(row.total_deduction||0).toFixed(2)}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="goToTracking(${row.employee_id})">View</button></td>
    `;
    tbody.appendChild(tr);
  });
  } catch(e) {
    console.error('loadDashboard error:', e);
    const el = document.getElementById('dashStats');
    if (el) el.innerHTML = `<div style="padding:20px;color:var(--negative);font-family:var(--font-mono);font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius)">Dashboard error: ${e.message}</div>`;
  }
}

function renderRevenueIntelPanel(deals, expiring, evtRevData) {
  const el = document.getElementById('contractExpiryPanel');
  if (!el) return;

  // Overall metrics from all deals
  const totalRev        = deals.reduce((a,d) => a + (parseFloat(d.amount)||0), 0);
  const totalPaid       = deals.reduce((a,d) => a + (parseFloat(d.paid_inc_vat)||0), 0);
  const totalVAT        = deals.reduce((a,d) => (parseFloat(d.paid_inc_vat)||0) > 0 ? a + (parseFloat(d.tax_vat)||0) : a, 0);
  const totalPaidExVat  = Math.max(0, totalPaid - totalVAT);
  const totalOut        = Math.max(0, totalRev - totalPaidExVat);
  const paidDeals  = deals.filter(d => (parseFloat(d.paid_inc_vat)||0) > 0).length;
  const collRate   = deals.length > 0 ? Math.round(paidDeals / deals.length * 100) : 0;

  // SVG donut: paid vs partial vs unpaid
  const R = 38, C = +(2 * Math.PI * R).toFixed(2);
  const unpaidDeals  = deals.filter(d => (parseFloat(d.paid_inc_vat)||0) === 0).length;
  const partialDeals = deals.filter(d => { const p=parseFloat(d.paid_inc_vat)||0; const a=parseFloat(d.amount)||0; return p>0 && p<a; }).length;
  const fullPaidDeals= deals.filter(d => { const p=parseFloat(d.paid_inc_vat)||0; const a=parseFloat(d.amount)||0; return p>0 && p>=a; }).length;
  const total = deals.length;
  const segPaid    = total > 0 ? (fullPaidDeals / total * C) : 0;
  const segPartial = total > 0 ? (partialDeals / total * C) : 0;
  const segUnpaid  = total > 0 ? (unpaidDeals / total * C) : 0;
  const offPaid    = 0;
  const offPartial = -(segPaid);
  const offUnpaid  = -(segPaid + segPartial);

  const today = new Date().toISOString().slice(0,10);
  const expiryHtml = expiring.length ? `
    <div class="ri-expiry-section">
      <div class="ri-expiry-title">⚠️ Contracts Expiring</div>
      ${expiring.slice(0,3).map(e => {
        const expired = e.contract_end_date < today;
        return `<div class="ri-expiry-row">
          <span>${esc(e.name)}</span>
          <span class="ri-expiry-badge ${expired ? 'ri-expiry-red' : 'ri-expiry-yellow'}">${expired ? 'Expired' : e.contract_end_date}</span>
        </div>`;
      }).join('')}
    </div>` : '';

  // Per-event cards
  const eventsHtml = (evtRevData||[]).filter(ev => Number(ev.deal_count) > 0).map(ev => {
    const amt        = parseFloat(ev.total_amount) || 0;
    const paid       = parseFloat(ev.total_paid) || 0;
    const vatColl    = parseFloat(ev.total_vat_collected) || 0;
    const paidExVat  = Math.max(0, paid - vatColl);
    const out        = Math.max(0, amt - paidExVat);
    const pct        = amt > 0 ? Math.min(100, Math.round(paidExVat / amt * 100)) : 0;
    const clients= Array.isArray(ev.clients) ? ev.clients : [];
    const paidC  = clients.filter(c => (parseFloat(c.paid_inc_vat)||0) >= (parseFloat(c.amount)||0) && (parseFloat(c.amount)||0) > 0).length;
    const partC  = clients.filter(c => { const p=parseFloat(c.paid_inc_vat)||0; const a=parseFloat(c.amount)||0; return p>0 && p<a; }).length;
    const unpC   = clients.filter(c => (parseFloat(c.paid_inc_vat)||0) === 0).length;
    const evtDate = ev.event_date ? new Date(ev.event_date).toLocaleDateString('en-GB',{month:'short',year:'2-digit'}) : '';

    // Client dots
    const dotHtml = clients.slice(0,12).map(c => {
      const p=parseFloat(c.paid_inc_vat)||0; const a=parseFloat(c.amount)||0;
      const status = p>=a && a>0 ? 'paid' : p>0 ? 'partial' : 'unpaid';
      const dotCol = status==='paid' ? '#22c55e' : status==='partial' ? '#f59e0b' : '#6b7280';
      const co = c.company || '?';
      return `<span title="${esc(co)}: ${status}" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dotCol};margin:1px"></span>`;
    }).join('') + (clients.length > 12 ? `<span style="font-size:0.7rem;color:rgba(255,255,255,0.4)">+${clients.length-12}</span>` : '');

    return `<div class="ri-evt-card" onclick="navigate('portfolio')" title="View in Portfolio" style="cursor:pointer">
      <div class="ri-evt-hd">
        <span class="ri-evt-name">${esc(ev.event_name)}</span>
        ${evtDate ? `<span class="ri-evt-date">${evtDate}</span>` : ''}
      </div>
      <div class="ri-evt-stats">
        <span class="ri-evt-stat">
          <span class="ri-evt-stat-label">Total</span>
          <strong>£${fmtK(amt)}</strong>
        </span>
        <span class="ri-evt-stat">
          <span class="ri-evt-stat-label" style="color:#22c55e">Collected</span>
          <strong style="color:#22c55e">£${fmtK(paidExVat)}</strong>
        </span>
        <span class="ri-evt-stat">
          <span class="ri-evt-stat-label" style="color:#f59e0b">Outstanding</span>
          <strong style="color:#f59e0b">£${fmtK(out)}</strong>
        </span>
      </div>
      <div class="ri-evt-bar-wrap"><div class="ri-evt-bar" style="width:0%" data-pct="${pct}"></div></div>
      <div class="ri-evt-foot">
        <span class="ri-evt-dots">${dotHtml}</span>
        <span class="ri-evt-counts ri-evt-foot-label">
          <span style="color:#22c55e;font-weight:700">${paidC}✓</span>
          ${partC > 0 ? `<span style="color:#f59e0b;font-weight:700"> ${partC}◑</span>` : ''}
          <span style="color:#9ca3af;font-weight:700"> ${unpC}✗</span>
        </span>
      </div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="ri-card">
      <div class="ri-glow"></div>
      <div class="ri-header">
        <div class="ri-header-left">
          <span class="ri-pulse"></span>
          <span class="ri-title">REVENUE INTELLIGENCE</span>
        </div>
        <span class="ri-year">${new Date().getFullYear()}</span>
      </div>

      <!-- Top: donut + summary metrics -->
      <div class="ri-body">
        <div class="ri-chart-wrap">
          <svg class="ri-donut" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="${R}" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="10"/>
            <circle cx="50" cy="50" r="${R}" fill="none" stroke="#22c55e" stroke-width="10" stroke-linecap="round"
              stroke-dasharray="0 ${C}" stroke-dashoffset="${offPaid}" class="ri-seg"
              data-final="${segPaid} ${C - segPaid}"/>
            <circle cx="50" cy="50" r="${R}" fill="none" stroke="#f59e0b" stroke-width="10" stroke-linecap="round"
              stroke-dasharray="0 ${C}" stroke-dashoffset="${offPartial}" class="ri-seg"
              data-final="${segPartial} ${C - segPartial}"/>
            <circle cx="50" cy="50" r="${R}" fill="none" stroke="#374151" stroke-width="10" stroke-linecap="round"
              stroke-dasharray="0 ${C}" stroke-dashoffset="${offUnpaid}" class="ri-seg"
              data-final="${segUnpaid} ${C - segUnpaid}"/>
          </svg>
          <div class="ri-donut-center">
            <div class="ri-donut-num">${collRate}%</div>
            <div class="ri-donut-label">Collected</div>
          </div>
        </div>
        <div class="ri-metrics">
          <div class="ri-metric">
            <div class="ri-metric-label">Total Revenue</div>
            <div class="ri-metric-val ri-blue">£${fmtK(totalRev)}</div>
          </div>
          <div class="ri-metric">
            <div class="ri-metric-label">Collected (inc VAT)</div>
            <div class="ri-metric-val ri-green">£${fmtK(totalPaid)}</div>
            <div style="font-size:0.65rem;color:rgba(255,255,255,0.4);margin-top:2px">£${fmtK(totalPaidExVat)} ex VAT</div>
          </div>
          <div class="ri-metric">
            <div class="ri-metric-label">Outstanding (ex VAT)</div>
            <div class="ri-metric-val" style="color:#f59e0b">£${fmtK(totalOut)}</div>
          </div>
          <div class="ri-metric ri-metric--wide">
            <div class="ri-metric-label">Payment Status</div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:2px">
              <span style="font-size:0.72rem;color:#22c55e">●  ${fullPaidDeals} paid</span>
              <span style="font-size:0.72rem;color:#f59e0b">● ${partialDeals} partial</span>
              <span style="font-size:0.72rem;color:#6b7280">● ${unpaidDeals} unpaid</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Per-event cards -->
      ${(evtRevData||[]).filter(ev => Number(ev.deal_count) > 0).length > 0 ? `
      <div class="ri-evt-section">
        <div class="ri-evt-section-hd">
          <div class="ri-evt-section-title">Events Breakdown</div>
          <input class="ri-evt-search" id="riEvtSearch" placeholder="Search events…" oninput="riFilterEvtCards(this.value)" />
        </div>
        <div class="ri-evt-list" id="riEvtList">${eventsHtml}</div>
      </div>` : ''}

      ${expiryHtml}
    </div>`;

  // Animate after render
  requestAnimationFrame(() => {
    setTimeout(() => {
      el.querySelectorAll('.ri-seg').forEach(seg => {
        seg.style.transition = 'stroke-dasharray 1.2s cubic-bezier(.4,0,.2,1)';
        seg.setAttribute('stroke-dasharray', seg.dataset.final);
      });
      el.querySelectorAll('.ri-evt-bar').forEach(bar => {
        bar.style.transition = 'width 1s cubic-bezier(.4,0,.2,1)';
        bar.style.width = bar.dataset.pct + '%';
      });
    }, 80);
  });
}

function riFilterEvtCards(query) {
  const q = (query || '').toLowerCase();
  document.querySelectorAll('#riEvtList .ri-evt-card').forEach(card => {
    const name = (card.querySelector('.ri-evt-name')?.textContent || '').toLowerCase();
    card.style.display = !q || name.includes(q) ? '' : 'none';
  });
}

function riFilterEvent(eventId, eventName) {
  // Switch to deals page and filter by this event
  navigate('deals');
  setTimeout(() => {
    const sel = document.getElementById('dealEventFilter');
    if (sel) {
      sel.value = String(eventId);
      setDealEvent(String(eventId));
    }
  }, 300);
}

function renderContractExpiryPanel(expiring, miniCardsHtml) {
  var el = document.getElementById('contractExpiryPanel');
  if (!el) return;

  var html = '<div style="display:flex;flex-direction:column;gap:12px;height:100%">';

  // Always show the 3 mini action cards stacked
  if (miniCardsHtml) html += miniCardsHtml;

  // Expiry alert below if contracts are expiring
  if (expiring && expiring.length) {
    var today = new Date().toISOString().slice(0,10);
    html += '<div class="dash-panel dash-panel--alert" style="margin-top:4px">' +
      '<div class="dash-panel-header">' +
        '<span class="dash-panel-icon">⚠️</span>' +
        '<span class="dash-panel-title">Contracts Expiring</span>' +
        '<span class="dash-panel-count">' + expiring.length + '</span>' +
      '</div>' +
      '<div class="dash-panel-body">' +
        expiring.map(function(e) {
          var expired = e.contract_end_date < today;
          var badge = expired ? 'badge-red' : 'badge-yellow';
          var label = expired ? 'Expired' : 'Ends ' + e.contract_end_date;
          return '<div class="dash-panel-row">' +
            '<div>' +
              '<div style="font-weight:700;font-size:0.88rem">' + esc(e.name) + '</div>' +
              ((e.job_title || e.department) ? '<div style="font-size:0.74rem;color:var(--muted)">' + esc([e.job_title,e.department].filter(Boolean).join(' · ')) + '</div>' : '') +
            '</div>' +
            '<span class="badge ' + badge + '">' + label + '</span>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>';
  }

  html += '</div>';
  el.innerHTML = html;
}

function renderHeadcountPanel(activeEmps, payrollCount, seCount, totalHeadcount, year) {
  var el = document.getElementById('headcountPanel');
  if (!el) return;
  const depts = {};
  activeEmps.forEach(e => {
    const d = e.department || 'Unassigned';
    if (!depts[d]) depts[d] = { count: 0, payroll: 0, se: 0, emps: [] };
    depts[d].count++;
    if (e.employment_type === 'self_employed') depts[d].se++;
    else depts[d].payroll++;
    depts[d].emps.push(e);
  });
  const sorted = Object.entries(depts).sort((a,b) => b[1].count - a[1].count);
  if (!sorted.length) { el.innerHTML = ''; return; }

  function deptColor(i) {
    const colors = ['#4f46e5','#0891b2','#16a34a','#d97706','#dc2626','#7c3aed','#be185d'];
    return colors[i % colors.length];
  }

  el.innerHTML = `
    <div class="dash-panel hc-panel">
      <div class="dash-panel-header">
        <span class="dash-panel-icon">🏢</span>
        <span class="dash-panel-title">Headcount by Department</span>
        <span class="dash-panel-count">${activeEmps.length} total</span>
      </div>
      <div class="dash-panel-body hc-body">
        ${sorted.map(([dept, info], idx) => {
          const color = deptColor(idx);
          const pct = Math.round((info.count / activeEmps.length) * 100);
          return `
          <div class="hc-dept" onclick="this.classList.toggle('hc-open')">
            <div class="hc-dept-hd">
              <div class="hc-dept-bar" style="background:${color}"></div>
              <div class="hc-dept-name">${esc(dept)}</div>
              <div class="hc-dept-badges">
                ${info.payroll ? `<span class="badge badge-blue">${info.payroll} payroll</span>` : ''}
                ${info.se ? `<span class="badge badge-yellow">${info.se} self-emp</span>` : ''}
              </div>
              <div class="hc-dept-pct">${pct}%</div>
              <div class="hc-dept-chevron">›</div>
            </div>
            <div class="hc-dept-track"><div class="hc-dept-fill" style="width:${pct}%;background:${color}"></div></div>
            <div class="hc-emp-list">
              ${info.emps.map(e => {
                const initials = (e.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
                const isSE = e.employment_type === 'self_employed';
                const avatarBg = isSE ? '#d97706' : color;
                const role = e.job_title || (isSE ? 'Self-Employed' : 'Payroll');
                return `<div class="hc-emp-row" onclick="event.stopPropagation();goToTracking(${e.id})">
                  <div class="hc-emp-av" style="background:${avatarBg}">${initials}</div>
                  <div class="hc-emp-info">
                    <div class="hc-emp-name">${esc(e.name)}</div>
                    <div class="hc-emp-role">${esc(role)}</div>
                  </div>
                  <span class="badge ${isSE ? 'badge-yellow' : 'badge-blue'}" style="font-size:0.6rem">${isSE ? 'SE' : 'PR'}</span>
                </div>`;
              }).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

function renderDashUpcoming(upcoming, dayOffs) {
  var el = document.getElementById('upcomingPanel');
  if (!el) return;
  var MONS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  var BELL = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';

  // Build unified entries
  var entries = [];
  (upcoming || []).forEach(function(r) {
    var sym = r.currency === 'GBP' ? '£' : r.currency === 'USD' ? '$' : (r.currency ? r.currency + ' ' : '');
    entries.push({
      date:  (r.virtual_date || '').slice(0,10),
      title: esc(r.title || ''),
      cat:   (r.category || '').toUpperCase(),
      amt:   r.amount ? sym + parseFloat(r.amount).toLocaleString('en-GB',{maximumFractionDigits:0}) : '',
      isDayOff: false
    });
  });
  (dayOffs || []).forEach(function(r) {
    var half = parseFloat(r.is_day_off) === 0.5;
    entries.push({
      date:  r.record_date || '',
      title: esc(r.employee_name || 'Employee'),
      cat:   half ? 'HALF DAY OFF' : 'FULL DAY OFF',
      amt:   '',
      isDayOff: true
    });
  });
  entries.sort(function(a,b){ return a.date.localeCompare(b.date); });

  var header =
    '<div class="card-header">' +
      '<span class="card-title" style="display:flex;align-items:center;gap:7px">' + BELL + ' Upcoming</span>' +
      '<span style="font:700 11px/1 var(--font-mono);color:var(--muted);letter-spacing:0.5px">NEXT 30D</span>' +
    '</div>';

  if (!entries.length) {
    el.innerHTML = '<div class="card" style="height:100%">' + header +
      '<div class="empty-state" style="padding:32px 0"><div class="icon">🔔</div><div>Nothing upcoming</div></div></div>';
    return;
  }

  var rows = entries.slice(0, 7).map(function(e) {
    var d   = new Date(e.date + 'T00:00:00Z');
    var day = d.getUTCDate();
    var mon = MONS[d.getUTCMonth()];
    var catCol = e.isDayOff ? '#f59e0b' : 'var(--muted)';
    return '<div style="display:flex;gap:14px;padding:13px 18px;border-bottom:1px solid var(--border);align-items:center">' +
      '<div style="width:42px;min-width:42px;text-align:center;background:#1a1f2e;border:1px solid var(--border);border-radius:8px;padding:7px 0">' +
        '<div style="font:800 17px/1 var(--font-mono);color:var(--text)">' + day + '</div>' +
        '<div style="font:600 9px/1 var(--font-mono);color:var(--muted);margin-top:4px;letter-spacing:0.8px">' + mon + '</div>' +
      '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font:600 13px/1.2 var(--font-sans);color:var(--text)">' + e.title + '</div>' +
        (e.cat ? '<div style="font:600 10px/1 var(--font-mono);color:' + catCol + ';margin-top:5px;letter-spacing:0.8px">' + e.cat + '</div>' : '') +
      '</div>' +
      (e.amt ? '<div style="font:700 13px/1 var(--font-mono);color:var(--text);white-space:nowrap">' + e.amt + '</div>' : '') +
    '</div>';
  }).join('');

  el.innerHTML = '<div class="card" style="height:100%">' + header + '<div style="padding:0">' + rows + '</div></div>';
}

function renderDashActivity(summary, expiring, hotelData, salaryData) {
  const el = document.getElementById('activityPanel');
  if (!el) return;

  const items = [];
  const ICONS = {
    pay:     '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
    breach:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    hotel:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    expiry:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    deduct:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  };

  // Salary payments from salaryData
  salaryData.filter(e => !e.is_terminated && (e.payments||[]).length).slice(0,2).forEach(e => {
    const last = e.payments[e.payments.length - 1];
    const sym = e.currency === 'AED' ? 'AED ' : '£';
    items.push({ icon: ICONS.pay, tone: 'pos', title: 'Logged payment', detail: sym + parseFloat(last.amount||0).toLocaleString('en-GB') + ' &rarr; ' + esc(e.name) });
  });

  // Allowance breaches
  summary.filter(r => (parseFloat(r.excess_days)||0) > 0).slice(0,2).forEach(r => {
    items.push({ icon: ICONS.breach, tone: 'neg', title: 'Allowance breach', detail: esc(r.name) + ' &middot; ' + r.year_days_off + '/' + r.allowance_days + ' days &middot; &pound;' + parseFloat(r.excess_day_deduction||0).toFixed(2) + ' deduct' });
  });

  // Contract expiring
  expiring.slice(0,2).forEach(e => {
    const days = Math.floor((new Date(e.contract_end_date) - new Date()) / 86400000);
    items.push({ icon: ICONS.expiry, tone: 'warn', title: 'Contract expiring', detail: esc(e.name) + ' &middot; ' + e.contract_end_date + ' &middot; ' + Math.abs(days) + 'd' });
  });

  // Hotel events
  hotelData.filter(h => h.status !== 'paid').slice(0,2).forEach(h => {
    const sym = hotelCurrencySymbol(h.currency || h.paid_currency || 'USD');
    const amtStr = h.paid_amount ? sym + parseFloat(h.paid_amount).toLocaleString('en-GB') + ' &middot; ' : '';
    items.push({ icon: ICONS.hotel, tone: 'info', title: 'Hotel expense', detail: esc(h.event_name) + ' &middot; ' + amtStr + h.status });
  });

  if (!items.length) { el.innerHTML = ''; return; }

  const TONE_COLOR = { pos:'var(--positive)', neg:'var(--negative)', warn:'var(--warning)', info:'var(--info)' };
  const rows = items.slice(0,5).map(it =>
    '<div style="display:flex;gap:10px;padding:11px 16px;border-bottom:1px solid var(--line);align-items:flex-start">' +
      '<div style="width:28px;height:28px;border-radius:6px;background:var(--surface-2);border:1px solid var(--border);display:grid;place-items:center;flex-shrink:0;color:' + TONE_COLOR[it.tone] + '">' + it.icon + '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font:600 12.5px/1.3 var(--font-sans);color:var(--text)">' + it.title + '</div>' +
        '<div style="font:400 11px/1.4 var(--font-mono);color:var(--muted);margin-top:3px">' + it.detail + '</div>' +
      '</div>' +
    '</div>'
  ).join('');

  el.innerHTML = '<div class="card" style="margin-bottom:0">' +
    '<div class="card-header" style="padding:12px 16px">' +
      '<span class="card-title" style="display:flex;align-items:center;gap:6px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Activity</span>' +
      '<span style="font-size:0.72rem;color:var(--muted);font-family:var(--font-mono)">last 24h</span>' +
    '</div>' +
    '<div style="padding:0">' + rows + '</div>' +
  '</div>';
}

function goToTracking(empId) {
  navigate('tracking');
  document.getElementById('trackEmp').value = empId;
  loadEmployeeRecords();
}

// ─── TRACKING ────────────────────────────────────────────────────────────────
async function loadEmployeeRecords() {
  const empId = document.getElementById('trackEmp').value;
  if (!empId) return;

  const month = document.getElementById('trackMonth').value;
  let from = '', to = '';
  if (month) {
    from = month + '-01';
    const d = new Date(month + '-01');
    d.setMonth(d.getMonth() + 1); d.setDate(0);
    to = d.toISOString().slice(0, 10);
  }

  const params = new URLSearchParams();
  if (from) params.append('from', from);
  if (to) params.append('to', to);

  const [recRes, yearStatsRes] = await Promise.all([
    fetch(`/api/records/${empId}?${params}`),
    fetch(`/api/employees/${empId}/year-stats?year=${(from || today()).slice(0,4)}`)
  ]);
  const records = await recRes.json();
  const yearStats = await yearStatsRes.json();
  const emp = employees.find(e => e.id === parseInt(empId));

  document.getElementById('trackTableTitle').textContent =
    emp ? `${emp.name} – ${month || 'All'}` : 'Records';

  // Days-off allowance banner
  const banner = document.getElementById('daysOffBanner');
  if (emp) {
    const allowance  = yearStats.allowance_days;
    const used       = yearStats.total_days_off;
    const remaining  = yearStats.remaining_allowance;
    const excess     = yearStats.excess_days;
    const dailyRate  = yearStats.daily_rate || emp.daily_rate || 0;
    const deduction  = yearStats.excess_deduction || 0;
    const typeLabel  = emp.employment_type === 'self_employed' ? 'Self-Employed' : 'Payroll';

    if (excess > 0) {
      banner.className = 'alert alert-error';
      const breakdown = yearStats.breakdown || [];
      const breakdownHtml = breakdown.map(b =>
        `<span>${MONTHS[b.month]}: ${b.days}d × £${parseFloat(b.rate).toFixed(2)} = <strong>£${b.deduction.toFixed(2)}</strong>
         <small style="opacity:0.7">(${b.working_days} working days)</small></span>`
      ).join('<span style="opacity:0.4">·</span>');
      banner.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:6px;width:100%">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
            <span><strong>${typeLabel} — Days Off ${yearStats.year}:</strong>
              ${used} used / ${allowance} allowed &nbsp;·&nbsp;
              <strong>${excess} excess day(s)</strong>
            </span>
            <span style="font-size:1rem;font-weight:800;color:var(--danger)">−£${deduction.toFixed(2)} deduction</span>
          </div>
          <div style="font-size:0.78rem;background:rgba(0,0,0,0.25);border-radius:6px;padding:6px 10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span>📐</span>
            <span>${used} used − ${allowance} free = <strong>${excess} excess</strong></span>
            <span style="opacity:0.4">·</span>
            <span>Rate = annual ÷ 12 ÷ working days in month</span>
            <span style="opacity:0.4">·</span>
            ${breakdownHtml}
          </div>
        </div>`;
    } else {
      banner.className = 'alert alert-success';
      banner.innerHTML = `<strong>${typeLabel} — Days Off ${yearStats.year}:</strong>
        ${used} used / ${allowance} allowed &nbsp;|&nbsp; <strong>${remaining} day(s) remaining</strong>`;
    }
    banner.classList.remove('hidden');
  }

  // Stats bar
  const statsBar = document.getElementById('empStatsBar');
  if (records.length && emp) {
    const refTotal = records.reduce((a, b) => a + (b.ref_amount || 0), 0);
    const fullDays = records.filter(r => r.is_day_off === 1).length;
    const halfDays = records.filter(r => r.is_day_off === 0.5).length;
    statsBar.innerHTML = `
      <div class="stat-card"><div class="stat-label">Break (total)</div><div class="stat-value">${records.filter(r=>!r.is_day_off).reduce((a,b)=>a+b.break_minutes,0)}m</div></div>
      <div class="stat-card yellow"><div class="stat-label">Phone Time</div><div class="stat-value">${records.reduce((a,b)=>a+b.phone_minutes,0)}m</div></div>
      <div class="stat-card yellow"><div class="stat-label">Wasted Time</div><div class="stat-value">${records.reduce((a,b)=>a+b.wasted_minutes,0)}m</div></div>
      <div class="stat-card yellow"><div class="stat-label">Late Arrivals</div><div class="stat-value">${records.reduce((a,b)=>a+b.late_minutes,0)}m</div></div>
      <div class="stat-card red"><div class="stat-label">Full Days Off</div><div class="stat-value">${fullDays}</div></div>
      <div class="stat-card red"><div class="stat-label">Half Days Off</div><div class="stat-value">${halfDays}</div></div>
      <div class="stat-card blue"><div class="stat-label">Ref. Potential (not deducted)</div><div class="stat-value" style="font-size:1.3rem">£${refTotal.toFixed(2)}</div></div>
    `;
    statsBar.classList.remove('hidden');
  } else {
    statsBar.classList.add('hidden');
  }

  // Records table
  const tbody = document.getElementById('trackTable');
  const empty = document.getElementById('trackEmpty');
  tbody.innerHTML = '';
  if (!records.length) { empty.classList.remove('hidden'); }
  else {
    empty.classList.add('hidden');
    records.forEach(r => {
      const tr = document.createElement('tr');
      if (r.is_day_off > 0) tr.classList.add('day-off-row');
      const excessBreak = Math.max(0, r.break_minutes - ALLOWED_BREAK);
      const adjSign = r.manual_adj_minutes > 0 ? '+' : '';
      const dayOffLabel = r.is_day_off === 1 ? '<span class="badge badge-red">Full Day</span>'
                        : r.is_day_off === 0.5 ? '<span class="badge badge-yellow">Half Day</span>'
                        : '—';
      tr.innerHTML = `
        <td><strong>${r.record_date}</strong></td>
        <td>${r.break_minutes}m ${excessBreak > 0 ? `<span class="badge badge-red">+${excessBreak}m</span>` : '<span class="badge badge-green">OK</span>'}</td>
        <td>${r.phone_minutes > 0 ? `<span class="badge badge-yellow">${r.phone_minutes}m</span>` : '—'}</td>
        <td>${r.wasted_minutes > 0 ? `<span class="badge badge-yellow">${r.wasted_minutes}m</span>` : '—'}</td>
        <td>${r.late_minutes > 0 ? `<span class="badge badge-red">${r.late_minutes}m</span>` : '—'}</td>
        <td>${dayOffLabel}</td>
        <td>
          ${r.manual_adj_minutes !== 0 ? `<span class="badge ${r.manual_adj_minutes > 0 ? 'badge-red' : 'badge-green'}">${adjSign}${r.manual_adj_minutes}m</span>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="openAdjModal(${r.employee_id},'${r.record_date}')">Adj</button>
        </td>
        <td style="color:var(--muted)">${r.ref_minutes || 0}m</td>
        <td style="color:var(--primary);font-size:0.8rem" title="Reference only — not deducted from salary">£${(r.ref_amount||0).toFixed(2)} <span style="opacity:0.5;font-size:0.68rem">ref</span></td>
        <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.notes||'')}">${esc(r.notes||'')||'—'}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-ghost btn-sm" onclick="openEditRecord(${r.id},${r.employee_id},'${r.record_date}',${r.break_minutes},${r.phone_minutes},${r.wasted_minutes},${r.late_minutes},${r.is_day_off},\`${esc(r.notes||'')}\`)">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteRecord(${r.id})">Del</button>
        </td>`;
      tbody.appendChild(tr);
    });
  }

  // Payments section kept hidden — salary management is in the Salary page
  document.getElementById('paymentsSection')?.classList.add('hidden');
}

// ─── RECORD MODAL ────────────────────────────────────────────────────────────
function openRecordModal() {
  const empId = document.getElementById('trackEmp').value;
  if (!empId) return showToast('Please select an employee first', 'info');
  document.getElementById('recId').value = '';
  document.getElementById('recEmpId').value = empId;
  document.getElementById('recEmpRow').classList.add('hidden');
  document.getElementById('recDate').value = today();
  document.getElementById('recBreak').value = 40;
  document.getElementById('recPhone').value = 0;
  document.getElementById('recWasted').value = 0;
  document.getElementById('recLate').value = 0;
  document.getElementById('recDayOff').value = '0';
  document.getElementById('recNotes').value = '';
  document.getElementById('recFields').style.display = '';
  document.getElementById('recordModalTitle').textContent = 'Add Daily Record';
  document.getElementById('recPreview').classList.add('hidden');
  updatePreview();
  openModal('recordModal');
}

function openEditRecord(id, empId, date, brk, phone, wasted, late, dayOff, notes) {
  document.getElementById('recId').value = id;
  document.getElementById('recEmpId').value = empId;
  document.getElementById('recEmpRow').classList.add('hidden');
  document.getElementById('recDate').value = date;
  document.getElementById('recBreak').value = brk;
  document.getElementById('recPhone').value = phone;
  document.getElementById('recWasted').value = wasted;
  document.getElementById('recLate').value = late;
  document.getElementById('recDayOff').value = String(dayOff);
  document.getElementById('recNotes').value = notes;
  document.getElementById('recFields').style.display = dayOff > 0 ? 'none' : '';
  document.getElementById('recordModalTitle').textContent = 'Edit Record';
  updatePreview();
  openModal('recordModal');
}

function toggleDayOff() {
  const dayOff = parseFloat(document.getElementById('recDayOff').value);
  document.getElementById('recFields').style.display = dayOff > 0 ? 'none' : '';
  updatePreview();
}

function updatePreview() {
  const empId = document.getElementById('recEmpId').value;
  const emp = employees.find(e => e.id === parseInt(empId));
  const dayOff = parseFloat(document.getElementById('recDayOff').value) || 0;
  const box = document.getElementById('recPreview');
  if (!emp) { box.classList.add('hidden'); return; }

  const rate = emp.daily_rate;
  const ratePerMin = rate / SHIFT_MINS;

  let html = '';
  if (dayOff > 0) {
    const label = dayOff === 1 ? 'Full day off' : 'Half day off';
    const typeNote = emp.employment_type === 'self_employed'
      ? ' (check year allowance — self-employed: 5 days free)'
      : ' (check year allowance — payroll: 20 days free)';
    html = `<h3>Day Off Note</h3>
      <div class="deduction-row"><span>${label}${typeNote}</span></div>
      <div class="deduction-row" style="font-size:0.8rem;color:var(--muted)">Day-off deductions are calculated at year level based on your allowance.</div>`;
  } else {
    const brk = parseInt(document.getElementById('recBreak').value) || 0;
    const phone = parseInt(document.getElementById('recPhone').value) || 0;
    const wasted = parseInt(document.getElementById('recWasted').value) || 0;
    const late = parseInt(document.getElementById('recLate').value) || 0;
    const excessBreak = Math.max(0, brk - ALLOWED_BREAK);
    const total = excessBreak + phone + wasted + late;
    if (total === 0) { box.classList.add('hidden'); return; }

    html = `<h3>Reference Preview <span style="font-size:0.72rem;font-weight:500;opacity:0.7">(for your records — not deducted from salary)</span></h3>`;
    if (excessBreak > 0) html += `<div class="deduction-row"><span>Excess break (${brk}m – ${ALLOWED_BREAK}m)</span><span>${excessBreak}m / £${(excessBreak*ratePerMin).toFixed(2)}</span></div>`;
    if (phone > 0)  html += `<div class="deduction-row"><span>Phone time</span><span>${phone}m / £${(phone*ratePerMin).toFixed(2)}</span></div>`;
    if (wasted > 0) html += `<div class="deduction-row"><span>Wasted time</span><span>${wasted}m / £${(wasted*ratePerMin).toFixed(2)}</span></div>`;
    if (late > 0)   html += `<div class="deduction-row"><span>Late arrival</span><span>${late}m / £${(late*ratePerMin).toFixed(2)}</span></div>`;
    html += `<div class="deduction-row total"><span>Total (reference only)</span><span>${total}m / £${(total*ratePerMin).toFixed(2)}</span></div>`;
  }
  box.innerHTML = html;
  box.classList.remove('hidden');
}

async function saveRecord() {
  const id = document.getElementById('recId').value;
  const body = {
    employee_id: parseInt(document.getElementById('recEmpId').value),
    record_date: document.getElementById('recDate').value,
    break_minutes: parseInt(document.getElementById('recBreak').value) || 0,
    phone_minutes: parseInt(document.getElementById('recPhone').value) || 0,
    wasted_minutes: parseInt(document.getElementById('recWasted').value) || 0,
    late_minutes: parseInt(document.getElementById('recLate').value) || 0,
    is_day_off: parseFloat(document.getElementById('recDayOff').value) || 0,
    notes: document.getElementById('recNotes').value
  };
  const res = await fetch(id ? `/api/records/${id}` : '/api/records', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) { const e = await res.json(); return showToast(e.error, 'error'); }
  showToast('Record saved', 'success');
  closeModal('recordModal');
  const calPage = document.getElementById('page-calendar');
  if (calPage && calPage.classList.contains('active')) loadCalendar();
  else loadEmployeeRecords();
}

async function deleteRecord(id) {
  if (!await showConfirm('Delete this record?')) return;
  await fetch(`/api/records/${id}`, { method: 'DELETE' });
  const calPage = document.getElementById('page-calendar');
  if (calPage && calPage.classList.contains('active')) loadCalendar();
  else loadEmployeeRecords();
}

// ─── ADJUSTMENTS ─────────────────────────────────────────────────────────────
async function openAdjModal(empId, date) {
  currentAdjRecord = { empId, date };
  document.getElementById('adjModalSubtitle').textContent =
    `${employees.find(e=>e.id===parseInt(empId))?.name || 'Employee'} – ${date}`;
  document.getElementById('adjMinutes').value = '';
  document.getElementById('adjReason').value = '';
  await loadAdjList();
  openModal('adjModal');
}

async function loadAdjList() {
  if (!currentAdjRecord) return;
  const { empId, date } = currentAdjRecord;
  const res = await fetch(`/api/adjustments/${empId}?date=${date}`);
  const adjs = await res.json();
  const list = document.getElementById('adjList');
  if (!adjs.length) { list.innerHTML = '<div style="color:var(--muted);font-size:0.85rem">No adjustments yet.</div>'; return; }
  list.innerHTML = adjs.map(a => `
    <div class="adj-item">
      <div>
        <span class="adj-amount ${a.adjustment_minutes > 0 ? 'positive' : 'negative'}">${a.adjustment_minutes > 0 ? '+' : ''}${a.adjustment_minutes}m</span>
        &nbsp;${esc(a.reason)}
        <small style="color:var(--muted)"> – by ${esc(a.username||'unknown')} on ${a.created_at.slice(0,10)}</small>
      </div>
      <button class="btn btn-danger btn-sm" onclick="deleteAdj(${a.id})">✕</button>
    </div>`).join('');
}

async function saveAdjustment() {
  const mins = parseInt(document.getElementById('adjMinutes').value);
  const reason = document.getElementById('adjReason').value.trim();
  if (isNaN(mins)) return showToast('Enter a number of minutes', 'error');
  if (!reason) return showToast('Reason is required', 'error');
  await fetch('/api/adjustments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_id: currentAdjRecord.empId, record_date: currentAdjRecord.date, adjustment_minutes: mins, reason })
  });
  document.getElementById('adjMinutes').value = '';
  document.getElementById('adjReason').value = '';
  await loadAdjList();
  loadEmployeeRecords();
}

async function deleteAdj(id) {
  if (!await showConfirm('Remove this adjustment?')) return;
  await fetch(`/api/adjustments/${id}`, { method: 'DELETE' });
  await loadAdjList();
  loadEmployeeRecords();
}

// ─── MONTHLY PAYMENTS ────────────────────────────────────────────────────────
async function loadPaymentsSection(empId, emp) {
  const section = document.getElementById('paymentsSection');
  if (!emp || emp.annual_salary <= 0) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');

  const year = new Date().getFullYear();
  const sym  = currencySymbol(emp.currency || 'GBP');

  // Fetch payments, year-stats (day-off deductions), and office deductions in parallel
  const [paymentsRes, yearStatsRes, officeRes] = await Promise.all([
    fetch(`/api/payments/${empId}?year=${year}`),
    fetch(`/api/employees/${empId}/year-stats?year=${year}`),
    fetch(`/api/office-deductions/${empId}`)
  ]);
  const payments   = paymentsRes.ok   ? await paymentsRes.json()   : [];
  const yearStats  = yearStatsRes.ok  ? await yearStatsRes.json()  : {};
  const officeRows = officeRes.ok     ? await officeRes.json()     : [];

  const annual       = parseFloat(emp.annual_salary) || 0;
  const totalPaid    = payments.reduce((a, b) => a + parseFloat(b.amount || 0), 0);
  const dayOffDeduct = parseFloat(yearStats.excess_deduction) || 0;
  const officeDeduct = officeRows.reduce((a, b) => a + parseFloat(b.amount || 0), 0);

  // Pro-rated only applies if employee started this year — fetch from overview to get salary_target
  const startDate = emp.start_date ? emp.start_date.slice(0,10) : null;
  const startedThisYear = startDate && startDate.startsWith(String(year));
  let proRatedHtml = '';
  let salaryTargetForYear = annual; // default to full annual
  if (startedThisYear) {
    const res2 = await fetch(`/api/salary-overview?year=${year}`);
    if (res2.ok) {
      const overview = await res2.json();
      const empData = Array.isArray(overview) ? overview.find(e => e.employee_id === parseInt(empId)) : null;
      if (empData) {
        // Use the server-computed salary_target (pro-rated to Dec 31)
        salaryTargetForYear = parseFloat(empData.salary_target ?? empData.annual_salary) || annual;
        const pr = empData.pro_rated;
        if (pr) {
          proRatedHtml = `
          <div style="margin-top:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 16px">
            <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#059669;margin-bottom:8px">Pro-Rated Reference · Started ${pr.start_date}</div>
            <div style="font-size:0.85rem;display:flex;justify-content:space-between;font-weight:600">
              <span style="color:var(--muted)">Expected to date</span>
              <span style="color:#059669;font-weight:800">${sym}${pr.total_expected.toLocaleString('en-GB',{minimumFractionDigits:2})}</span>
            </div>
          </div>`;
        }
      }
    }
  }

  const remaining = salaryTargetForYear - totalPaid - dayOffDeduct - officeDeduct;

  document.getElementById('salaryInfo').innerHTML = `
    <div class="stat-card blue"><div class="stat-label">Annual Salary</div><div class="stat-value">${sym}${annual.toLocaleString('en-GB',{minimumFractionDigits:2})}</div></div>
    ${startedThisYear ? `<div class="stat-card yellow"><div class="stat-label">Target for ${year}</div><div class="stat-value">${sym}${salaryTargetForYear.toLocaleString('en-GB',{minimumFractionDigits:2})}</div></div>` : ''}
    ${startDate ? `<div class="stat-card blue"><div class="stat-label">Start Date</div><div class="stat-value" style="font-size:1.1rem">${startDate}</div></div>` : ''}
    <div class="stat-card green"><div class="stat-label">Paid This Year</div><div class="stat-value">${sym}${totalPaid.toLocaleString('en-GB',{minimumFractionDigits:2})}</div></div>
    ${dayOffDeduct > 0 ? `<div class="stat-card red"><div class="stat-label">Day-Off Deductions</div><div class="stat-value">−${sym}${dayOffDeduct.toLocaleString('en-GB',{minimumFractionDigits:2})}</div></div>` : ''}
    ${officeDeduct > 0 ? `<div class="stat-card red"><div class="stat-label">Office Items</div><div class="stat-value">−${sym}${officeDeduct.toLocaleString('en-GB',{minimumFractionDigits:2})}</div></div>` : ''}
    <div class="stat-card ${remaining < 0 ? 'green' : 'red'}"><div class="stat-label">Remaining to Pay</div><div class="stat-value">${remaining < 0 ? '+' : ''}${sym}${Math.abs(remaining).toLocaleString('en-GB',{minimumFractionDigits:2})}</div></div>
  `;

  // Append pro-rated block below stats
  if (proRatedHtml) document.getElementById('salaryInfo').insertAdjacentHTML('afterend', proRatedHtml);

  const tbody = document.getElementById('paymentsTable');
  const empty = document.getElementById('paymentsEmpty');
  tbody.innerHTML = '';
  if (!payments.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  payments.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${MONTHS[p.payment_month]} ${p.payment_year}</td>
      <td class="fw-bold">${sym}${parseFloat(p.amount).toLocaleString('en-GB',{minimumFractionDigits:2})}</td>
      <td>${esc(p.notes || '') || '—'}</td>
      <td><button class="btn btn-danger btn-sm" onclick="deletePayment(${p.id})">Del</button></td>`;
    tbody.appendChild(tr);
  });
}

function openPaymentModal() {
  const empId = document.getElementById('trackEmp').value;
  if (!empId) return;
  const now = new Date();
  document.getElementById('payEmpId').value = empId;
  document.getElementById('payYear').value = now.getFullYear();
  document.getElementById('payMonth').value = now.getMonth() + 1;
  document.getElementById('payAmount').value = '';
  document.getElementById('payNotes').value = '';
  openModal('paymentModal');
}

async function savePayment() {
  const employee_id = document.getElementById('payEmpId').value;
  const payment_year = document.getElementById('payYear').value;
  const payment_month = document.getElementById('payMonth').value;
  const amount = document.getElementById('payAmount').value;
  const notes = document.getElementById('payNotes').value;
  if (!amount) return showToast('Amount is required', 'error');
  const res = await fetch('/api/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_id, payment_year, payment_month, amount, notes })
  });
  if (!res.ok) { const e = await res.json(); return showToast(e.error, 'error'); }
  closeModal('paymentModal');
  loadEmployeeRecords();
}

async function deletePayment(id) {
  if (!await showConfirm('Delete this payment record?')) return;
  await fetch(`/api/payments/${id}`, { method: 'DELETE' });
  loadEmployeeRecords();
}

// ─── REPORTS ─────────────────────────────────────────────────────────────────
function _repTile(label, value, sub, color) {
  return '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px 22px;display:flex;flex-direction:column;gap:8px">' +
    '<div style="font:600 10px/1 var(--font-mono);text-transform:uppercase;letter-spacing:1.2px;color:var(--muted)">' + label + '</div>' +
    '<div style="font:700 30px/1 var(--font-mono);color:' + color + ';letter-spacing:-1px">' + value + '</div>' +
    '<div style="font:500 11px/1 var(--font-mono);color:var(--muted)">' + sub + '</div>' +
  '</div>';
}

async function loadReport() {
  const from    = document.getElementById('repFrom').value;
  const to      = document.getElementById('repTo').value;
  const empId   = document.getElementById('repEmp').value;
  const container = document.getElementById('reportContent');

  if (!from || !to) return showToast('Please select a date range', 'info');

  container.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><div>Generating report…</div></div>';

  try {
    const params = new URLSearchParams({ from, to });
    const year   = new Date(from).getFullYear();

    const [summaryRes, salaryRes] = await Promise.all([
      fetch('/api/summary?' + params),
      fetch('/api/salary-overview?year=' + year)
    ]);

    if (!summaryRes.ok) throw new Error('Server error ' + summaryRes.status);
    const summary = await summaryRes.json();
    if (!Array.isArray(summary)) throw new Error(summary.error || 'Unexpected response');

    const salaryData = salaryRes.ok ? await salaryRes.json() : [];
    const filtered   = empId ? summary.filter(e => e.employee_id === parseInt(empId)) : summary;

    if (!filtered.length) {
      container.innerHTML = '<div class="empty-state"><div class="icon">📋</div><div>No records found for the selected range.</div></div>';
      return;
    }

    // ── Period stats ──────────────────────────────────────────────────────────
    const fromDate   = new Date(from);
    const toDate     = new Date(to);
    const periodDays = Math.ceil((toDate - fromDate) / 86400000) + 1;
    const dateLabel  = fromDate.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})
                     + ' – ' + toDate.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});

    const filteredIds = new Set(filtered.map(e => e.employee_id));
    const relSalary   = salaryData.filter(e => !empId || filteredIds.has(e.employee_id));

    // Total payroll paid in period (use payment_month/payment_year to bucket)
    const fromYM = year * 100 + fromDate.getMonth() + 1;
    const toYM   = new Date(to).getFullYear() * 100 + new Date(to).getMonth() + 1;
    let totalPayrollPaid = 0;
    relSalary.forEach(e => {
      (e.payments || []).forEach(p => {
        const ym = (parseInt(p.payment_year) || 0) * 100 + (parseInt(p.payment_month) || 0);
        if (ym >= fromYM && ym <= toYM) totalPayrollPaid += parseFloat(p.amount || 0);
      });
    });

    const totalDeduct  = filtered.reduce((a, b) => a + (parseFloat(b.total_deduction) || 0), 0);
    const timeDeduct   = filtered.reduce((a, b) => a + (parseFloat(b.total_time_deduction) || 0), 0);
    const dayDeduct    = filtered.reduce((a, b) => a + (parseFloat(b.excess_day_deduction) || 0), 0);
    const deductPct    = totalPayrollPaid > 0 ? ((totalDeduct / totalPayrollPaid) * 100).toFixed(1) : '0.0';
    const activeCount  = filtered.length;

    // ── Monthly trend data ────────────────────────────────────────────────────
    const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const curMonth     = new Date().getMonth();
    const monthlyTotals = new Array(12).fill(0);
    relSalary.forEach(e => {
      (e.payments || []).forEach(p => {
        const m = parseInt(p.payment_month) - 1;
        const y = parseInt(p.payment_year);
        if (!isNaN(m) && y === year && m >= 0 && m < 12) monthlyTotals[m] += parseFloat(p.amount || 0);
      });
    });

    const chartLabels = MONTHS_SHORT.slice(0, curMonth + 1);
    const chartVals   = monthlyTotals.slice(0, curMonth + 1);
    const maxVal      = Math.max(...chartVals, 1);

    // ── Build HTML ────────────────────────────────────────────────────────────
    let html = '';

    // Stat tiles
    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">';
    html += _repTile('Period', periodDays + ' days', dateLabel, 'var(--text)');
    html += _repTile('Total Payroll', '£' + Math.round(totalPayrollPaid).toLocaleString('en-GB'), 'paid this period', 'var(--positive)');
    html += _repTile('Total Deductions', '£' + Math.round(totalDeduct).toLocaleString('en-GB'), deductPct + '% of gross', 'var(--negative)');
    html += _repTile('Active Records', String(activeCount), 'across ' + activeCount + ' staff', 'var(--primary)');
    html += '</div>';

    // Chart + breakdown row
    html += '<div style="display:grid;grid-template-columns:3fr 2fr;gap:16px;margin-bottom:20px">';

    // Payroll trend chart
    html += '<div class="card">';
    html += '<div class="card-header"><span class="card-title">Payroll Trend</span>' +
            '<span style="font:500 11px/1 var(--font-mono);color:var(--muted)">' + year + ' · monthly</span></div>';
    html += '<div style="display:flex;align-items:flex-end;gap:6px;height:150px;padding:4px 4px 0">';
    chartLabels.forEach(function(m, i) {
      var val  = chartVals[i];
      var barH = val > 0 ? Math.max(10, Math.round((val / maxVal) * 110)) : 4;
      var lbl  = val > 0 ? (val >= 1000 ? '£' + (val/1000).toFixed(1) + 'k' : '£' + Math.round(val)) : '';
      var isNow = (i === curMonth);
      var barBg = isNow ? 'var(--primary)' : '#2a3040';
      html += '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0">';
      html += '<div style="font:600 9px/1 var(--font-mono);color:' + (isNow ? 'var(--primary)' : 'var(--muted)') + ';text-align:center;white-space:nowrap">' + lbl + '</div>';
      html += '<div style="background:' + barBg + ';border-radius:3px 3px 0 0;width:100%;height:' + barH + 'px"></div>';
      html += '<div style="font:500 9px/1 var(--font-mono);color:' + (isNow ? 'var(--text)' : 'var(--muted)') + '">' + m + '</div>';
      html += '</div>';
    });
    html += '</div></div>';

    // Deductions breakdown
    html += '<div class="card">';
    html += '<div class="card-header"><span class="card-title">Deductions Breakdown</span></div>';
    var deductBase = timeDeduct + dayDeduct || 1;
    var cats = [
      { label: 'Time deductions', val: timeDeduct, color: 'var(--primary)' },
      { label: 'Day-off overage', val: dayDeduct, color: 'var(--negative)' }
    ];
    cats.forEach(function(c) {
      var pct = Math.round((c.val / deductBase) * 100);
      html += '<div style="margin-bottom:16px">';
      html += '<div style="display:flex;justify-content:space-between;font:500 11px/1 var(--font-mono);color:var(--muted);margin-bottom:7px">';
      html += '<span>' + c.label + '</span><span>£' + c.val.toFixed(0) + ' &middot; ' + pct + '%</span></div>';
      html += '<div style="height:6px;background:var(--border);border-radius:3px">';
      html += '<div style="height:100%;width:' + pct + '%;background:' + c.color + ';border-radius:3px"></div>';
      html += '</div></div>';
    });
    html += '</div>';
    html += '</div>'; // end 2-col row

    // Payroll ledger table
    html += '<div class="card">';
    html += '<div class="card-header"><span class="card-title">Payroll Ledger YTD</span>' +
            '<span style="font:500 11px/1 var(--font-mono);color:var(--muted)">' + year + '</span></div>';
    html += '<div class="table-wrap"><table><thead><tr>';
    html += '<th>Employee</th><th>Type</th>';
    chartLabels.forEach(function(m) { html += '<th style="text-align:right">' + m + '</th>'; });
    html += '<th style="text-align:right;color:var(--primary)">YTD Total</th>';
    html += '</tr></thead><tbody>';

    relSalary.forEach(function(emp) {
      var initials = (emp.name || '').split(' ').map(function(w){ return w[0]||''; }).join('').slice(0,2).toUpperCase();
      var typeLabel = emp.employment_type === 'self_employed' ? 'SE' : 'PR';
      var typeCls   = emp.employment_type === 'self_employed' ? 'badge-yellow' : 'badge-blue';
      var empMonthly = new Array(12).fill(0);
      (emp.payments || []).forEach(function(p) {
        var m = parseInt(p.payment_month) - 1;
        var y = parseInt(p.payment_year);
        if (!isNaN(m) && y === year && m >= 0 && m < 12) empMonthly[m] += parseFloat(p.amount || 0);
      });
      var ytd = empMonthly.slice(0, curMonth + 1).reduce(function(a,b){ return a+b; }, 0);

      html += '<tr>';
      html += '<td><div style="display:flex;align-items:center;gap:10px">';
      html += '<div style="width:30px;height:30px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;font:700 10px/1 var(--font-mono);color:#000;flex-shrink:0">' + initials + '</div>';
      html += '<div><div style="font-weight:700;font-size:0.84rem">' + esc(emp.name || '') + '</div>';
      html += '<div style="font-size:0.71rem;color:var(--muted)">' + esc(emp.job_title || '') + '</div></div></div></td>';
      html += '<td><span class="badge ' + typeCls + '">' + typeLabel + '</span></td>';
      chartLabels.forEach(function(m, i) {
        var v = empMonthly[i];
        html += '<td style="text-align:right;font:500 12px/1 var(--font-mono);color:' + (v > 0 ? 'var(--text)' : 'var(--dim)') + '">' +
                (v > 0 ? '£' + v.toLocaleString('en-GB',{maximumFractionDigits:0}) : '&mdash;') + '</td>';
      });
      html += '<td style="text-align:right;font:700 13px/1 var(--font-mono);color:var(--primary)">' +
              (ytd > 0 ? '£' + ytd.toLocaleString('en-GB') : '&mdash;') + '</td>';
      html += '</tr>';
    });

    html += '</tbody></table></div></div>';

    container.innerHTML = html;

  } catch (e) {
    container.innerHTML = '<div class="alert alert-error">Failed to generate report: ' + esc(e.message) + '</div>';
  }
}

// ─── ADMINS ──────────────────────────────────────────────────────────────────
async function loadAdmins() {
  const res = await fetch('/api/admins');
  if (!res.ok) return;
  const admins = await res.json();

  // Update adminSub
  const adminCount = admins.length;
  const adminRoleCount = admins.filter(a => a.role === 'admin').length;
  const managerCount = admins.filter(a => a.role === 'manager').length;
  const accountsCount = admins.filter(a => a.role === 'accounts').length;
  const adminSub = document.getElementById('adminSub');
  if (adminSub) adminSub.textContent = `// ${adminCount} account${adminCount !== 1 ? 's' : ''} · ${adminRoleCount} admin · ${managerCount} manager` + (accountsCount ? ` · ${accountsCount} accounts` : '');

  const tbody = document.getElementById('adminTable');
  tbody.innerHTML = '';
  admins.forEach(a => {
    const initials = (a.username || '?').slice(0, 2).toUpperCase();
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:28px;height:28px;border-radius:7px;background:var(--accent-soft);border:1px solid var(--accent-line);color:var(--accent);font:700 10px/1 var(--font-mono);display:grid;place-items:center;flex-shrink:0">${initials}</div>
          <strong>${esc(a.username)}</strong>
        </div>
      </td>
      <td><span class="badge ${a.role==='admin'?'badge-green':a.role==='accounts'?'badge-teal':'badge-blue'}">${a.role.toUpperCase()}</span></td>
      <td>${a.created_at.slice(0,10)}</td>
      <td style="text-align:right">
        <button class="btn btn-ghost btn-sm" onclick="resetPw(${a.id})">Reset PW</button>
        <button class="btn btn-danger btn-sm" onclick="deleteAdmin(${a.id})">Remove</button>
      </td>`;
    tbody.appendChild(tr);
  });

  // Append roles + recent sign-ins section (remove old one if present)
  const oldExtra = document.getElementById('adminExtraSection');
  if (oldExtra) oldExtra.remove();

  const signinRows = admins.map(a => {
    const initials = (a.username || '?').slice(0, 2).toUpperCase();
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border)">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--positive);flex-shrink:0"></span>
        <div style="width:28px;height:28px;border-radius:7px;background:var(--accent-soft);border:1px solid var(--accent-line);color:var(--accent);font:700 10px/1 var(--font-mono);display:grid;place-items:center;flex-shrink:0">${initials}</div>
        <div style="flex:1;min-width:0">
          <div style="font:600 12.5px/1 var(--font-mono);color:var(--text)">${esc(a.username)}</div>
          <div style="font:400 10.5px/1 var(--font-mono);color:var(--muted);margin-top:3px">${a.created_at.slice(0,10)}</div>
        </div>
        <span class="badge ${a.role==='admin'?'badge-green':'badge-blue'}" style="font-size:0.65rem">${a.role.toUpperCase()}</span>
      </div>`;
  }).join('');

  const extraSection = document.createElement('div');
  extraSection.id = 'adminExtraSection';
  extraSection.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
      <div class="card" style="margin-bottom:0">
        <div class="card-header">
          <span class="card-title">Roles</span>
        </div>
        <div style="padding:16px">
          <div style="margin-bottom:14px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span class="badge badge-green">ADMIN</span>
              <span style="font:600 12.5px/1 var(--font-sans);color:var(--text)">Full access</span>
            </div>
            <div style="font:400 11.5px/1.5 var(--font-mono);color:var(--muted)">Manage admins, delete records, terminate employees, all exports.</div>
          </div>
          <div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span class="badge badge-blue">MANAGER</span>
              <span style="font:600 12.5px/1 var(--font-sans);color:var(--text)">Day-to-day</span>
            </div>
            <div style="font:400 11.5px/1.5 var(--font-mono);color:var(--muted)">Add records, log payments, edit employees · no admin or termination.</div>
          </div>
        </div>
      </div>
      <div class="card" style="margin-bottom:0">
        <div class="card-header">
          <span class="card-title">Recent sign-ins</span>
          <span style="font:600 10px/1 var(--font-mono);color:var(--muted);text-transform:uppercase;letter-spacing:0.6px">Last 7 days</span>
        </div>
        <div id="adminSignins">${signinRows || '<div style="padding:16px;color:var(--muted);font-size:0.85rem">No accounts yet.</div>'}</div>
      </div>
    </div>`;

  const adminPage = document.getElementById('page-admins');
  if (adminPage) adminPage.appendChild(extraSection);
}

function openAdminModal() { openModal('adminModal'); }

async function saveAdmin() {
  const username = document.getElementById('newAdminUser').value.trim();
  const password = document.getElementById('newAdminPass').value;
  const role = document.getElementById('newAdminRole').value;
  if (!username || !password) return showToast('Username and password required', 'error');
  const res = await fetch('/api/admins', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, role })
  });
  if (!res.ok) { const e = await res.json(); return showToast(e.error, 'error'); }
  closeModal('adminModal');
  loadAdmins();
}

async function deleteAdmin(id) {
  if (!await showConfirm('Remove this user?')) return;
  const res = await fetch(`/api/admins/${id}`, { method: 'DELETE' });
  if (!res.ok) { const e = await res.json(); return showToast(e.error, 'error'); }
  loadAdmins();
}

async function resetPw(id) {
  const pw = await showPrompt('New password:', 'Enter new password');
  if (!pw) return;
  await fetch(`/api/admins/${id}/password`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw })
  });
  showToast('Password updated', 'success');
}

// ─── SALARY PAGE ─────────────────────────────────────────────────────────────

function setSalaryTab(btn) {
  document.querySelectorAll('.salary-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  loadSalaryPage();
}

function pbFilter(btn, filter) {
  document.querySelectorAll('.pb-filter').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('#pbList .pb-row').forEach(row => {
    row.style.display = (filter === 'unpaid' && row.classList.contains('pb-row--settled')) ? 'none' : '';
  });
  // Hide section headers if all their rows are hidden
  document.querySelectorAll('#pbList .pb-section').forEach(sec => {
    const visible = [...sec.querySelectorAll('.pb-row')].some(r => r.style.display !== 'none');
    sec.style.display = visible ? '' : 'none';
  });
}

function activeSalaryTab() {
  return document.querySelector('.salary-tab.active')?.dataset.tab || 'all';
}

function initSalaryYearSelect() {
  const sel = document.getElementById('salaryYear');
  if (sel.options.length > 1) return;
  const now = new Date().getFullYear();
  for (let y = now; y >= now - 4; y--) {
    const opt = document.createElement('option');
    opt.value = y; opt.textContent = y;
    sel.appendChild(opt);
  }
  sel.value = now;
}

async function loadSalaryPage() {
  const container = document.getElementById('salaryCards');
  renderSalaryReminderPanel();
  try {
    initSalaryYearSelect();
    const year       = document.getElementById('salaryYear').value || new Date().getFullYear();
    const empFilter  = document.getElementById('salaryEmpFilter').value;
    const searchTerm = (document.getElementById('salarySearch')?.value || '').trim().toLowerCase();

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    let res;
    try {
      res = await fetch(`/api/salary-overview?year=${year}`, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      let errMsg = `Server error ${res.status}`;
      try { const j = await res.json(); errMsg = j.error || errMsg; } catch {}
      throw new Error(errMsg);
    }
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Unexpected response from server');
    // Update tab counts
    const base = empFilter ? data.filter(e => String(e.employee_id) === empFilter) : data;
    const searched = searchTerm
      ? base.filter(e => (e.name || '').toLowerCase().includes(searchTerm))
      : base;
    const counts = {
      all:          searched.filter(e => !e.is_terminated).length,
      payroll:      searched.filter(e => !e.is_terminated && e.employment_type === 'payroll').length,
      self_employed:searched.filter(e => !e.is_terminated && e.employment_type === 'self_employed').length,
      terminated:   searched.filter(e => e.is_terminated).length
    };
    document.querySelectorAll('.salary-tab').forEach(t => {
      const key = t.dataset.tab;
      const labels = { all:'All', payroll:'Payroll', self_employed:'Self-Employed', terminated:'Terminated' };
      t.textContent = `${labels[key]} (${counts[key]})`;
    });

    // Update salary page tag and sub
    const salaryPageTag = document.getElementById('salaryPageTag');
    if (salaryPageTag) salaryPageTag.textContent = year;
    const salarySub = document.getElementById('salarySub');
    if (salarySub) {
      const activeCount = searched.filter(e => !e.is_terminated).length;
      const flagged = searched.filter(e => !e.is_terminated && (parseFloat(e.excess_days) || 0) > 0).length;
      salarySub.textContent = `// ${activeCount} account${activeCount !== 1 ? 's' : ''} · ${flagged > 0 ? flagged + ' flagged' : 'all clear'}`;
    }

    const tab = activeSalaryTab();
    let rows = [...searched];
    if (tab === 'terminated')        rows = rows.filter(e => e.is_terminated);
    else if (tab === 'payroll')      rows = rows.filter(e => !e.is_terminated && e.employment_type === 'payroll');
    else if (tab === 'self_employed')rows = rows.filter(e => !e.is_terminated && e.employment_type === 'self_employed');
    else                             rows = rows.filter(e => !e.is_terminated);

    // ── Totals strip: grouped by employment_type × currency (active only) ──
    const activeRows = rows.filter(r => !r.is_terminated);
    const TYPE_ORDER = ['payroll', 'self_employed'];
    const groups = [];
    TYPE_ORDER.forEach(type => {
      const ofType = activeRows.filter(r => r.employment_type === type);
      if (!ofType.length) return;
      const curs = [...new Set(ofType.map(r => r.currency || 'GBP'))];
      curs.forEach(c => {
        groups.push({ type, currency: c, rows: ofType.filter(r => (r.currency || 'GBP') === c) });
      });
    });
    const TYPE_LABEL = { payroll: 'Payroll', self_employed: 'Self-Employed' };
    const TYPE_CLASS  = { payroll: 'payroll', self_employed: 'self-employed' };
    const SAL_FX = { GBP: 1, AED: 1/4.67, PHP: 0.0138 };
    const salFxToGBP = (v, c) => v * (SAL_FX[c] || 1);
    const AED_TO_GBP = SAL_FX.AED; // kept for legacy references below

    // ── Summary table ──
    const allActive = activeRows;
    const gtTarget  = allActive.reduce((s, e) => s + salFxToGBP(parseFloat(e.salary_target ?? e.annual_salary) || 0, e.currency || 'GBP'), 0);
    const gtPaid    = allActive.reduce((s, e) => s + salFxToGBP(parseFloat(e.total_paid)    || 0, e.currency || 'GBP'), 0);
    const gtDeduct  = allActive.reduce((s, e) => s + salFxToGBP((parseFloat(e.excess_deduction)||0)+(parseFloat(e.total_office_deductions)||0), e.currency || 'GBP'), 0);
    const gtRemain  = allActive.reduce((s, e) => s + Math.max(0, salFxToGBP(parseFloat(e.net_remaining) || 0, e.currency || 'GBP')), 0);
    const hasMultiCurrency = groups.some(g => g.currency !== 'GBP');
    const phpGroups = groups.filter(g => g.currency === 'PHP');
    const phpRemain = phpGroups.reduce((s, g) => s + g.rows.reduce((a, e) => a + Math.max(0, parseFloat(e.net_remaining) || 0), 0), 0);
    const gtPaidPct = gtTarget > 0 ? Math.min(100, Math.round(gtPaid / gtTarget * 100)) : 0;
    const fmtN = (v, sym) => sym + v.toLocaleString('en-GB', {maximumFractionDigits:0});
    const fmtGBP = v => '£' + v.toLocaleString('en-GB', {maximumFractionDigits:0});

    const rows = groups.map(g => {
      const s       = currencySymbol(g.currency);
      const tTarget = g.rows.reduce((a, b) => a + (parseFloat(b.salary_target ?? b.annual_salary) || 0), 0);
      const tPaid   = g.rows.reduce((a, b) => a + (parseFloat(b.total_paid) || 0), 0);
      const tDeduct = g.rows.reduce((a, b) => a + (parseFloat(b.excess_deduction)||0) + (parseFloat(b.total_office_deductions)||0), 0);
      const tRemain = g.rows.reduce((a, b) => a + (parseFloat(b.net_remaining) || 0), 0);
      const pct     = tTarget > 0 ? Math.min(100, Math.round(tPaid / tTarget * 100)) : 0;
      const isNonGBP = g.currency !== 'GBP';
      const groupLabel = `${TYPE_LABEL[g.type]}${g.currency !== 'GBP' ? ' · ' + g.currency : ''}`;
      return `<tr>
        <td>
          <div style="font-weight:600;font-size:0.85rem">${groupLabel}</div>
          <div style="font-size:0.72rem;color:var(--muted)">${g.rows.length} employee${g.rows.length !== 1 ? 's' : ''}</div>
        </td>
        <td>
          <div>${fmtN(tTarget, s)}</div>
          ${isNonGBP ? `<div class="sal-tbl-sub">${fmtGBP(salFxToGBP(tTarget,g.currency))}</div>` : ''}
        </td>
        <td>
          <div style="color:var(--positive);font-weight:600">${fmtN(tPaid, s)}</div>
          ${isNonGBP ? `<div class="sal-tbl-sub">${fmtGBP(salFxToGBP(tPaid,g.currency))}</div>` : ''}
        </td>
        <td>${tDeduct > 0 ? `<div style="color:var(--warning)">−${fmtN(tDeduct,s)}</div>` : '<span style="color:var(--muted)">—</span>'}</td>
        <td>
          <div style="color:${tRemain < 0 ? 'var(--positive)' : tRemain === 0 ? 'var(--muted)' : 'var(--negative)'};font-weight:600">${tRemain < 0 ? 'Overpaid' : fmtN(Math.abs(tRemain),s)}</div>
          ${isNonGBP && tRemain > 0 ? `<div class="sal-tbl-sub">${fmtGBP(salFxToGBP(tRemain,g.currency))}</div>` : ''}
        </td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="flex:1;height:6px;background:var(--border);border-radius:3px;min-width:48px">
              <div style="height:100%;width:${pct}%;background:var(--primary);border-radius:3px"></div>
            </div>
            <span style="font-size:0.78rem;font-weight:600;color:var(--muted);min-width:30px">${pct}%</span>
          </div>
        </td>
      </tr>`;
    }).join('');

    document.getElementById('salaryTotals').innerHTML = `
      <div class="card" style="padding:0;overflow:hidden">
        <table class="sal-summary-tbl">
          <thead><tr>
            <th>Group</th>
            <th>Annual</th>
            <th>Paid</th>
            <th>Deductions</th>
            <th>Still Owed</th>
            <th style="min-width:120px">Progress</th>
          </tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr>
            <td><div style="font-weight:700">Total · GBP</div><div style="font-size:0.72rem;color:var(--muted)">${allActive.length} employees</div></td>
            <td><div style="font-weight:700">${fmtGBP(gtTarget)}</div></td>
            <td><div style="font-weight:700;color:var(--positive)">${fmtGBP(gtPaid)}</div></td>
            <td>${gtDeduct > 0 ? `<div style="color:var(--warning)">−${fmtGBP(gtDeduct)}</div>` : '<span style="color:var(--muted)">—</span>'}</td>
            <td><div style="font-weight:700;color:var(--negative)">${fmtGBP(gtRemain)}</div>${phpRemain > 0 ? `<div class="sal-tbl-sub">₱${phpRemain.toLocaleString('en-GB',{maximumFractionDigits:0})} PHP</div>` : ''}</td>
            <td>
              <div style="display:flex;align-items:center;gap:8px">
                <div style="flex:1;height:6px;background:var(--border);border-radius:3px;min-width:48px">
                  <div style="height:100%;width:${gtPaidPct}%;background:var(--positive);border-radius:3px"></div>
                </div>
                <span style="font-size:0.78rem;font-weight:700;min-width:30px">${gtPaidPct}%</span>
              </div>
            </td>
          </tr></tfoot>
        </table>
      </div>`;

    // Payment Board removed — salary reminder panel handles categorized view
    document.getElementById('salaryBoard').innerHTML = '';

    // ── Per-employee cards ──
    if (!rows.length) {
      container.innerHTML = `<div class="empty-state"><div class="icon">💰</div><div>No employees with salary data.</div></div>`;
      return;
    }

    container.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:16px;margin-top:16px';
    container.innerHTML = rows.map(emp => {
      const annualSalary    = parseFloat(emp.annual_salary) || 0;
      const salaryTarget    = parseFloat(emp.salary_target ?? emp.annual_salary) || 0;
      const isProRatedYear  = !emp.is_terminated && salaryTarget !== annualSalary && salaryTarget > 0;
      const totalPaidEmp    = parseFloat(emp.total_paid) || 0;
      const excessDeduction = parseFloat(emp.excess_deduction) || 0;
      const netRemaining    = parseFloat(emp.net_remaining) || 0;
      const excessDays      = parseFloat(emp.excess_days) || 0;
      const totalDaysOff    = emp.total_days_off != null ? emp.total_days_off : 0;
      const allowanceDays   = emp.allowance_days != null ? emp.allowance_days : '—';
      const pctPaid         = parseFloat(emp.pct_paid) || 0;
      const payments        = Array.isArray(emp.payments) ? emp.payments : [];
      const officeDeductions = Array.isArray(emp.office_deductions) ? emp.office_deductions : [];
      const bonuses         = Array.isArray(emp.bonuses) ? emp.bonuses : [];
      const salaryHistory   = Array.isArray(emp.salary_history) ? emp.salary_history : [];
      const officeTotal     = parseFloat(emp.total_office_deductions) || 0;
      const bonusTotal      = parseFloat(emp.total_bonuses) || 0;
      const cur             = emp.currency || 'GBP';
      const sym             = currencySymbol(cur);
      const paye            = emp.paye_breakdown || null;
      const netMonthly      = emp.net_monthly ? parseFloat(emp.net_monthly) : null;

      // First-month suggestion: server-provided or client-side fallback
      const pr = emp.pro_rated;
      const fm = emp.first_month_full;
      const isPartialFirstMonth = fm && fm.first_month_days < fm.first_month_total_days;
      const payeNetFactor = paye && annualSalary > 0 ? paye.net_annual / annualSalary : 1;
      let suggestedFirstMonthNet = isPartialFirstMonth
        ? parseFloat((fm.first_month_pay * payeNetFactor).toFixed(2))
        : null;
      let fmMeta = isPartialFirstMonth ? {
        monthName: MONTHS[parseInt(fm.first_month.split('-')[1]) - 1] || fm.first_month,
        startDate: fm.start_date || emp.start_date,
        daysWorked: fm.first_month_days,
        daysTotal: fm.first_month_total_days
      } : null;

      // Client-side fallback: derive from emp.start_date when server didn't provide fm data
      if (suggestedFirstMonthNet === null && emp.start_date && !emp.is_terminated) {
        const sd = new Date(emp.start_date + 'T00:00:00');
        const startDay = sd.getDate();
        if (startDay > 1) {
          const daysInMonth = new Date(sd.getFullYear(), sd.getMonth() + 1, 0).getDate();
          const daysWorked = daysInMonth - startDay + 1;
          const netM = (paye ? paye.net_monthly : null) || netMonthly || (annualSalary / 12);
          suggestedFirstMonthNet = parseFloat((netM * (daysWorked / daysInMonth)).toFixed(2));
          fmMeta = {
            monthName: MONTHS[sd.getMonth()],
            startDate: emp.start_date,
            daysWorked,
            daysTotal: daysInMonth
          };
        }
      }

      const initials = (emp.name || '?').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
      const typeLabel = emp.employment_type === 'self_employed' ? 'Self-Employed' : 'Payroll';
      const typeBadge = emp.employment_type === 'self_employed' ? 'badge-yellow' : 'badge-blue';
      const allowanceLabel = emp.employment_type === 'self_employed' ? '5 days/yr free' : '20 days/yr free';
      const isTerminated = !!emp.is_terminated;
      const isOverpaid = netRemaining < 0;


      const earnedTotal = emp.earned_to_date != null ? parseFloat(emp.earned_to_date) : null;
      const eb = emp.earned_breakdown;

      // ── figures strip values ──
      const figOutClass = isOverpaid ? 'sc-fig-ok' : netRemaining === 0 ? 'sc-fig-dim' : 'sc-fig-bad';

      // ── build card ──
      const avatarTypeClass = isTerminated ? '' : emp.employment_type === 'self_employed' ? ' sc-self-emp-type' : '';
      const accentClass = isTerminated ? 'sc-term-accent' : emp.employment_type === 'self_employed' ? 'sc-self-emp' : 'sc-payroll';

      return `<div class="sc-card${isTerminated ? ' sc-terminated' : ''}${avatarTypeClass}" id="sc-emp-${emp.employee_id}">
        <div class="sc-accent ${accentClass}"></div>

        ${isTerminated ? `<div class="sc-term-banner">
          <span>Terminated</span>
          <span class="tb-date">${emp.termination_date}</span>
          ${emp.termination_reason ? `<span class="tb-reason">· ${esc(emp.termination_reason)}</span>` : ''}
        </div>` : ''}

        <div class="sc-head">
          <div class="sc-info">
            <div class="sc-emp-name">${esc(emp.name || '')}</div>
            ${emp.job_title || emp.department ? `<div class="sc-emp-role">${[emp.job_title, emp.department].filter(Boolean).map(s => esc(s)).join(' · ')}</div>` : ''}
            <div class="sc-emp-badges">
              <span class="badge ${typeBadge}" style="font-size:0.67rem">${typeLabel}</span>
              ${emp.start_date ? `<span class="sc-emp-since">${isTerminated ? 'Started' : 'Since'} ${emp.start_date}</span>` : ''}
            </div>
          </div>
          <div class="sc-annual">
            <div class="sc-annual-lbl">${isTerminated ? 'Final earned' : isProRatedYear ? `Target ${year}` : 'Annual'}</div>
            <div class="sc-annual-val">${sym}${(isTerminated ? (earnedTotal ?? annualSalary) : isProRatedYear ? salaryTarget : annualSalary).toLocaleString('en-GB',{maximumFractionDigits:0})}</div>
          </div>
          ${!isTerminated ? `<button class="btn btn-primary btn-sm" onclick="openSalaryPaymentModal(${emp.employee_id})" style="flex-shrink:0">+ Pay</button>` : ''}
        </div>

        <div class="sc-prog">
          <div class="sc-prog-meta">
            <span>${pctPaid}% paid</span>
            <span style="color:${isOverpaid ? 'var(--positive)' : netRemaining === 0 ? 'var(--muted)' : 'var(--negative)'}">${isOverpaid ? 'Overpaid' : netRemaining === 0 ? 'Fully paid' : `${sym}${Math.abs(netRemaining).toLocaleString('en-GB',{maximumFractionDigits:0})} left`}</span>
          </div>
          <div class="sc-prog-track">
            <div class="sc-prog-fill${isOverpaid ? ' overpaid' : ''}" style="width:${Math.min(pctPaid,100)}%"></div>
          </div>
        </div>


        ${(() => {
          const monthlyVal = paye ? paye.net_monthly : annualSalary / 12;
          const monthlyLbl = paye ? 'Take-home / mo' : 'Monthly';
          const monthlySub = paye ? 'after PAYE' + (paye.pension > 0 ? ' + pension' : '') : '';
          const outColor = isOverpaid ? 'var(--positive)' : netRemaining === 0 ? 'var(--muted)' : 'var(--negative)';
          const showFirstMonth = suggestedFirstMonthNet !== null && fmMeta && !isOverpaid;
          const firstMonthUnpaid = showFirstMonth && totalPaidEmp === 0;
          return '<div style="display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--border);border-bottom:1px solid var(--border)">' +
            '<div style="padding:14px 20px;border-right:1px solid var(--border)">' +
              '<div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin-bottom:6px">' + monthlyLbl + '</div>' +
              '<div style="font-size:1.3rem;font-weight:700;color:var(--text)">' + sym + monthlyVal.toLocaleString('en-GB',{maximumFractionDigits:0}) + '</div>' +
              (monthlySub ? '<div style="font-size:0.7rem;color:var(--muted);margin-top:3px">' + monthlySub + '</div>' : '') +
            '</div>' +
            '<div style="padding:14px 20px' + (firstMonthUnpaid ? ';background:rgba(251,191,36,0.05)' : '') + '">' +
              '<div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin-bottom:6px">' + (firstMonthUnpaid ? 'Pay This Month' : 'Year Balance') + '</div>' +
              '<div style="font-size:1.3rem;font-weight:700;color:' + (firstMonthUnpaid ? '#f59e0b' : outColor) + '">' +
                (firstMonthUnpaid
                  ? sym + Math.round(suggestedFirstMonthNet).toLocaleString('en-GB')
                  : (isOverpaid ? '−' : '') + sym + Math.abs(netRemaining).toLocaleString('en-GB',{maximumFractionDigits:0})) +
              '</div>' +
              (firstMonthUnpaid && fmMeta ? '<div style="font-size:0.7rem;color:var(--muted);margin-top:3px">' + fmMeta.daysWorked + ' of ' + fmMeta.daysTotal + ' days · ' + (fmMeta.monthName||'') + '</div>' : '') +
            '</div>' +
          '</div>' +
          (!paye && excessDays > 0
            ? '<div style="padding:8px 20px;font-size:0.75rem;color:var(--negative);border-bottom:1px solid var(--border)">⚠ ' +
              excessDays + ' excess day' + (excessDays > 1 ? 's' : '') + ' — −' + sym + excessDeduction.toLocaleString('en-GB',{minimumFractionDigits:2}) + ' deducted</div>'
            : '');
        })()}

        <div class="sc-sections">

          <!-- Payments -->
          <div class="sc-section">
            <button class="sc-sec-toggle" onclick="toggleSection(this)">
              <span class="sc-sec-title">Payments (${payments.length})</span>
              ${payments.length ? `<span style="font-size:1rem;font-weight:700;color:var(--positive)">${sym}${totalPaidEmp.toLocaleString('en-GB',{minimumFractionDigits:2})}</span>` : ''}
              <span class="sc-chevron">›</span>
            </button>
            <div class="sc-sec-body">
              ${payments.length ? payments.map(p => `
                <div class="sc-item">
                  <span class="sc-item-date">${MONTHS[p.payment_month]?.slice(0,3)||p.payment_month} ${p.payment_year}</span>
                  <span class="sc-item-amt pos">+${sym}${parseFloat(p.amount||0).toLocaleString('en-GB',{minimumFractionDigits:2})}</span>
                  <span class="sc-item-note">${esc(p.notes||'')}</span>
                  <button class="btn btn-danger btn-sm" onclick="deleteSalaryPayment(${p.id})">×</button>
                </div>`).join('') : `<div class="sc-empty">No payments logged yet.</div>`}
            </div>
          </div>

          ${paye ? `
          <!-- PAYE Breakdown -->
          <div class="sc-section">
            <button class="sc-sec-toggle" onclick="toggleSection(this)">
              <span class="sc-sec-title">PAYE Breakdown (2024/25)</span>
              <span class="sc-sec-sum">${sym}${(paye.income_tax+paye.national_insurance+paye.pension).toLocaleString('en-GB',{minimumFractionDigits:2})}/yr deducted</span>
              <span class="sc-chevron">›</span>
            </button>
            <div class="sc-sec-body">
              <div class="sc-paye-grid">
                <div class="sc-paye-box">
                  <div class="sc-paye-lbl">Income Tax</div>
                  <div class="sc-paye-val">${sym}${paye.income_tax.toLocaleString('en-GB',{minimumFractionDigits:2})}</div>
                  <div class="sc-paye-sub">per year</div>
                </div>
                <div class="sc-paye-box">
                  <div class="sc-paye-lbl">National Insurance</div>
                  <div class="sc-paye-val">${sym}${paye.national_insurance.toLocaleString('en-GB',{minimumFractionDigits:2})}</div>
                  <div class="sc-paye-sub">per year</div>
                </div>
                ${paye.pension > 0 ? `
                <div class="sc-paye-box">
                  <div class="sc-paye-lbl">Pension (${emp.pension_rate}%)</div>
                  <div class="sc-paye-val">${sym}${paye.pension.toLocaleString('en-GB',{minimumFractionDigits:2})}</div>
                  <div class="sc-paye-sub">per year</div>
                </div>` : ''}
              </div>
              <div class="sc-paye-footer">
                <span class="sc-paye-footer-lbl">Monthly take-home</span>
                <span class="sc-paye-footer-val">${sym}${paye.net_monthly.toLocaleString('en-GB',{minimumFractionDigits:2})}</span>
              </div>
            </div>
          </div>` : ''}

          <!-- Office Deductions -->
          <div class="sc-section">
            <button class="sc-sec-toggle" onclick="toggleSection(this)">
              <span class="sc-sec-title">Office Deductions (${officeDeductions.length})</span>
              ${officeTotal > 0 ? `<span class="sc-sec-sum red">−${sym}${officeTotal.toLocaleString('en-GB',{minimumFractionDigits:2})}</span>` : ''}
              <span class="sc-chevron">›</span>
            </button>
            <div class="sc-sec-body">
              <div class="sc-sec-actions">
                <button class="btn btn-ghost btn-sm" onclick="openOfficeDeductModal(${emp.employee_id})">+ Add Deduction</button>
              </div>
              ${officeDeductions.length ? officeDeductions.map(od => `
                <div class="sc-item">
                  <span class="sc-item-date">${od.deduction_date||''}</span>
                  <span class="sc-item-amt neg">−${sym}${parseFloat(od.amount||0).toLocaleString('en-GB',{minimumFractionDigits:2})}</span>
                  <span class="sc-item-note">${esc(od.description||'')}${od.notes?` · ${esc(od.notes)}`:''}</span>
                  <button class="btn btn-danger btn-sm" onclick="deleteOfficeDeduction(${od.id})">×</button>
                </div>`).join('') : `<div class="sc-empty">No deductions logged.</div>`}
            </div>
          </div>

          <!-- Bonuses -->
          <div class="sc-section">
            <button class="sc-sec-toggle" onclick="toggleSection(this)">
              <span class="sc-sec-title">Bonuses (${bonuses.length})</span>
              ${bonusTotal > 0 ? `<span class="sc-sec-sum amber">+${sym}${bonusTotal.toLocaleString('en-GB',{minimumFractionDigits:2})}</span>` : ''}
              <span class="sc-chevron">›</span>
            </button>
            <div class="sc-sec-body">
              <div class="sc-sec-actions">
                <button class="btn btn-ghost btn-sm" style="border-color:#fde68a;color:#b45309" onclick="openBonusModal(${emp.employee_id})">+ Add Bonus</button>
              </div>
              ${bonuses.length ? bonuses.map(b => `
                <div class="sc-item" style="background:#fffbeb;border-color:#fde68a">
                  <span class="sc-item-date">${b.bonus_date||''}</span>
                  <span class="sc-item-amt amb">+${sym}${parseFloat(b.amount||0).toLocaleString('en-GB',{minimumFractionDigits:2})}</span>
                  <span class="sc-item-note">${esc(b.reason||'')}${b.notes?` · ${esc(b.notes)}`:''}</span>
                  <button class="btn btn-danger btn-sm" onclick="deleteBonus(${b.id})">×</button>
                </div>`).join('') : `<div class="sc-empty">No bonuses logged yet.</div>`}
            </div>
          </div>

          <!-- Days off (payroll only) -->
          ${emp.employment_type === 'payroll' ? `
          <div class="sc-section">
            <button class="sc-sec-toggle" onclick="toggleSection(this)">
              <span class="sc-sec-title">Days Off — ${totalDaysOff} / ${allowanceDays} used</span>
              ${excessDays > 0
                ? `<span class="sc-sec-sum red">−${sym}${excessDeduction.toLocaleString('en-GB',{minimumFractionDigits:2})} deducted</span>`
                : `<span class="sc-sec-sum muted">within allowance</span>`}
              <span class="sc-chevron">›</span>
            </button>
            <div class="sc-sec-body">
              <div class="sc-days-note">${excessDays > 0
                ? `${excessDays} day${excessDays > 1 ? 's' : ''} over the ${allowanceDays}-day allowance → ${sym}${excessDeduction.toLocaleString('en-GB',{minimumFractionDigits:2})} deducted from salary.`
                : `${totalDaysOff} of ${allowanceDays} free days used — no deduction.`}</div>
            </div>
          </div>` : ''}

          <!-- Pro-rated breakdown -->
          ${(emp.pro_rated || emp.first_month_full || (suggestedFirstMonthNet !== null && fmMeta)) ? (() => {
            const pr = emp.pro_rated;
            const fmr = emp.first_month_full;
            // Client-side fallback only (no server data)
            if (!pr && !fmr && suggestedFirstMonthNet !== null && fmMeta) {
              const grossMonthly = annualSalary / 12;
              const grossProrata = grossMonthly * (fmMeta.daysWorked / fmMeta.daysTotal);
              const payLabel = paye ? ('Net after PAYE/NI' + (paye.pension > 0 ? '/pension' : '')) : 'Pro-rata amount';
              return `
          <div class="sc-section">
            <button class="sc-sec-toggle" onclick="toggleSection(this)">
              <span class="sc-sec-title">Pro-Rated Pay — started ${fmMeta.startDate}</span>
              <span class="sc-chevron">›</span>
            </button>
            <div class="sc-sec-body">
              <div class="sc-breakdown">
                <div class="sc-breakdown-title">First month payment — ${fmMeta.monthName}</div>
                <div class="sc-breakdown-row"><span>${fmMeta.daysWorked} of ${fmMeta.daysTotal} days in ${fmMeta.monthName}</span><span>${sym}${grossProrata.toLocaleString('en-GB',{minimumFractionDigits:2})} gross</span></div>
                <div class="sc-breakdown-row total"><span>${payLabel}</span><span>${sym}${suggestedFirstMonthNet.toLocaleString('en-GB',{minimumFractionDigits:2})}</span></div>
              </div>
            </div>
          </div>`;
            }
            const showFmFull = fmr && fmr.first_month_days < fmr.first_month_total_days;
            const fmrName = fmr ? (MONTHS[parseInt(fmr.first_month.split('-')[1])] || fmr.first_month) : null;
            const fmrGross = fmr ? fmr.first_month_pay : 0;
            const fmrNet = fmr ? parseFloat((fmrGross * payeNetFactor).toFixed(2)) : 0;
            const startLabel = (fmr || pr).start_date;
            return `
          <div class="sc-section">
            <button class="sc-sec-toggle" onclick="toggleSection(this)">
              <span class="sc-sec-title">Pro-Rated Pay — started ${startLabel}</span>
              <span class="sc-chevron">›</span>
            </button>
            <div class="sc-sec-body">
              ${showFmFull ? `
              <div class="sc-breakdown">
                <div class="sc-breakdown-title">Payment due — end of ${fmrName}</div>
                <div class="sc-breakdown-row"><span>Working days (${fmr.first_month_days}/${fmr.first_month_total_days} in ${fmrName})</span><span>${sym}${fmrGross.toLocaleString('en-GB',{minimumFractionDigits:2})} gross</span></div>
                ${paye ? `<div class="sc-breakdown-row total"><span>Net after PAYE/NI${paye.pension > 0 ? '/pension' : ''}</span><span>${sym}${fmrNet.toLocaleString('en-GB',{minimumFractionDigits:2})}</span></div>`
                       : `<div class="sc-breakdown-row total"><span>Gross amount due</span><span>${sym}${fmrGross.toLocaleString('en-GB',{minimumFractionDigits:2})}</span></div>`}
              </div>` : ''}
              ${pr ? `
              <div class="sc-breakdown${showFmFull ? ' sc-breakdown-secondary' : ''}">
                <div class="sc-breakdown-title">${showFmFull ? 'Earned to today' : 'Earned pay to date'}</div>
                <div class="sc-breakdown-row"><span>First month (${pr.first_month_days}/${pr.first_month_total_days} working days)</span><span>${sym}${pr.first_month_pay.toLocaleString('en-GB',{minimumFractionDigits:2})}</span></div>
                ${pr.full_months_count > 0 ? `<div class="sc-breakdown-row"><span>${pr.full_months_count} full month${pr.full_months_count > 1 ? 's' : ''}</span><span>${sym}${pr.full_months_pay.toLocaleString('en-GB',{minimumFractionDigits:2})}</span></div>` : ''}
                <div class="sc-breakdown-row total"><span>Total expected to date</span><span>${sym}${pr.total_expected.toLocaleString('en-GB',{minimumFractionDigits:2})}</span></div>
              </div>` : ''}
            </div>
          </div>`; })() : ''}

          <!-- Salary history / raises -->
          ${salaryHistory.length ? `
          <div class="sc-section">
            <button class="sc-sec-toggle" onclick="toggleSection(this)">
              <span class="sc-sec-title">Salary History (${salaryHistory.length})</span>
              <span class="sc-chevron">›</span>
            </button>
            <div class="sc-sec-body">
              ${salaryHistory.map(h => `
                <div class="sc-hist-item">
                  <span class="sc-item-date">${h.effective_from||''}</span>
                  <span style="font-weight:800;color:#059669;min-width:100px">${currencySymbol(h.currency||cur)}${parseFloat(h.annual_salary||0).toLocaleString('en-GB',{minimumFractionDigits:2})}/yr</span>
                  <span class="sc-item-note">${esc(h.reason||'')}</span>
                  <button class="btn btn-danger btn-sm" onclick="deleteSalaryHistory(${h.id})">×</button>
                </div>`).join('')}
            </div>
          </div>` : ''}

          <!-- Final pay breakdown for terminated -->
          ${isTerminated && eb ? `
          <div class="sc-section">
            <button class="sc-sec-toggle" onclick="toggleSection(this)">
              <span class="sc-sec-title">Final Pay Breakdown</span>
              <span class="sc-chevron">›</span>
            </button>
            <div class="sc-sec-body">
              <div class="sc-breakdown danger">
                <div class="sc-breakdown-title">${emp.start_date ? `Started ${emp.start_date} → ` : ''}Terminated ${emp.termination_date}</div>
                <div class="sc-breakdown-row"><span>First month (${eb.first_month_days}/${eb.first_month_total_days} working days)</span><span>${sym}${eb.first_month_pay.toLocaleString('en-GB',{minimumFractionDigits:2})}</span></div>
                ${eb.full_months_count > 0 ? `<div class="sc-breakdown-row"><span>${eb.full_months_count} full month${eb.full_months_count > 1 ? 's' : ''}</span><span>${sym}${eb.full_months_pay.toLocaleString('en-GB',{minimumFractionDigits:2})}</span></div>` : ''}
                ${eb.last_month_pay > 0 ? `<div class="sc-breakdown-row"><span>Last month (pro-rated)</span><span>${sym}${eb.last_month_pay.toLocaleString('en-GB',{minimumFractionDigits:2})}</span></div>` : ''}
                <div class="sc-breakdown-row total"><span>Total earned</span><span>${sym}${(earnedTotal||0).toLocaleString('en-GB',{minimumFractionDigits:2})}</span></div>
              </div>
            </div>
          </div>` : ''}

          <!-- HR Notes -->
          <div class="sc-section" id="notes-section-${emp.employee_id}">
            <button class="sc-sec-toggle" onclick="toggleNotesSection(this, ${emp.employee_id})">
              <span class="sc-sec-title">HR Notes</span>
              <span class="sc-chevron">›</span>
            </button>
            <div class="sc-sec-body">
              <div class="sc-sec-actions">
                <button class="btn btn-ghost btn-sm" onclick="openNoteModal(${emp.employee_id})">+ Add Note</button>
              </div>
              <div id="notes-list-${emp.employee_id}" class="sc-notes-list">
                <div class="sc-empty">Click to load notes…</div>
              </div>
            </div>
          </div>

          <!-- Print / Export row -->
          <div class="sc-card-footer">
            <button class="btn btn-ghost btn-sm" onclick="printPayslip(${emp.employee_id}, '${esc(emp.name)}')" title="Print formatted payslip">🖨 Print Payslip</button>
          </div>

        </div>
      </div>`;
    }).join('');
  } catch(e) {
    console.error('loadSalaryPage error:', e);
    container.innerHTML = `<div class="alert alert-error" style="margin:24px">Failed to load salary data: ${esc(e.message)}. Please refresh and try again.</div>`;
  }
}

function toggleSection(btn) {
  btn.closest('.sc-section').classList.toggle('open');
}

function showSalaryBreakdown(key) {
  const rows = window._salaryRows || [];
  const BD_FX = { GBP: 1, AED: window._salaryAedRate || (1/4.67), PHP: 0.0138 };
  const toGBP = (v, cur) => v * (BD_FX[cur] || 1);
  const fmtGBP = v => '£' + Math.abs(v).toLocaleString('en-GB', {minimumFractionDigits:2, maximumFractionDigits:2});
  const fmtCur = (v, cur) => currencySymbol(cur) + Math.abs(v).toLocaleString('en-GB', {minimumFractionDigits:2, maximumFractionDigits:2});

  const titles = { paid: 'Total Paid — Breakdown', due: 'Total Salaries — Breakdown', outstanding: 'Outstanding Balance — Breakdown', bonuses: 'Total Bonuses — Breakdown' };
  const notes  = { paid: 'Payments logged this year per employee', due: 'Net annual salary target incl. PAYE/NI deductions', outstanding: 'Remaining balance after payments & deductions (excl. bonuses)', bonuses: 'Bonus payments logged per employee' };

  // Build per-employee rows
  const empRows = rows.map(emp => {
    const cur = emp.currency || 'GBP';
    let nativeVal, gbpVal, label;
    if (key === 'paid') {
      nativeVal = parseFloat(emp.total_paid) || 0;
      gbpVal    = toGBP(nativeVal, cur);
      label     = nativeVal;
    } else if (key === 'due') {
      nativeVal = parseFloat(emp.salary_target ?? emp.annual_salary) || 0;
      gbpVal    = toGBP(nativeVal, cur);
    } else if (key === 'outstanding') {
      nativeVal = parseFloat(emp.net_remaining) || 0;
      gbpVal    = toGBP(nativeVal, cur);
    } else { // bonuses
      nativeVal = parseFloat(emp.total_bonuses) || 0;
      gbpVal    = toGBP(nativeVal, cur);
    }
    return { emp, cur, nativeVal, gbpVal };
  }).filter(r => Math.abs(r.nativeVal) > 0.005)
    .sort((a, b) => Math.abs(b.gbpVal) - Math.abs(a.gbpVal));

  const totalGBP = empRows.reduce((s, r) => s + r.gbpVal, 0);

  const rowsHtml = empRows.map(({ emp, cur, nativeVal, gbpVal }) => {
    const isNeg = nativeVal < 0;
    const valColor = key === 'outstanding' ? (isNeg ? 'var(--positive)' : 'var(--negative)') : 'var(--text)';
    const deductHtml = key === 'outstanding' ? (() => {
      const od  = parseFloat(emp.total_office_deductions) || 0;
      const ed  = parseFloat(emp.excess_deduction) || 0;
      const paid = parseFloat(emp.total_paid) || 0;
      const target = parseFloat(emp.salary_target ?? emp.annual_salary) || 0;
      const parts = [];
      if (paid > 0)  parts.push('<span style="color:var(--positive)">−' + fmtCur(paid, cur) + ' paid</span>');
      if (od > 0)    parts.push('<span style="color:var(--negative)">−' + fmtCur(od, cur) + ' deductions</span>');
      if (ed > 0)    parts.push('<span style="color:var(--negative)">−' + fmtCur(ed, cur) + ' excess days</span>');
      return parts.length ? '<div style="font:500 10px/1.4 var(--font-mono);color:var(--muted);margin-top:3px">' + parts.join(' · ') + '</div>' : '';
    })() : '';
    return '<div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--border)">' +
      '<div style="width:32px;height:32px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;font:700 11px/1 var(--font-mono);color:#000;flex-shrink:0">' +
        (emp.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase() +
      '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font:600 13px/1 var(--font-sans);color:var(--text)">' + esc(emp.name||'') + '</div>' +
        '<div style="font:500 10px/1 var(--font-mono);color:var(--muted);margin-top:2px">' + esc(emp.job_title||emp.department||'') + '</div>' +
        deductHtml +
      '</div>' +
      '<div style="text-align:right;flex-shrink:0">' +
        '<div style="font:700 14px/1 var(--font-mono);color:' + valColor + '">' + (isNeg ? '−' : '') + fmtCur(nativeVal, cur) + '</div>' +
        (cur !== 'GBP' ? '<div style="font:500 10px/1 var(--font-mono);color:var(--muted);margin-top:3px">≈ ' + fmtGBP(gbpVal) + ' GBP</div>' : '') +
      '</div>' +
    '</div>';
  }).join('');

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML =
    '<div class="modal" style="max-width:520px;max-height:80vh;display:flex;flex-direction:column">' +
      '<div class="modal-header" style="flex-shrink:0">' +
        '<h3 class="modal-title">' + titles[key] + '</h3>' +
        '<button class="modal-close" onclick="this.closest(\'.modal-overlay\').remove()">×</button>' +
      '</div>' +
      '<div style="padding:0 20px 8px;flex-shrink:0">' +
        '<div style="font:500 11px/1 var(--font-mono);color:var(--muted)">' + notes[key] + '</div>' +
        (key === 'outstanding' ? '<div style="font:500 11px/1 var(--font-mono);color:var(--muted);margin-top:4px">Excludes bonuses · AED @ ' + BD_FX.AED.toFixed(4) + ' · PHP @ 0.0138 GBP</div>' : '') +
      '</div>' +
      '<div style="overflow-y:auto;padding:0 20px 8px;flex:1">' +
        (rowsHtml || '<div style="color:var(--muted);padding:20px 0;font:500 12px/1 var(--font-mono)">No data.</div>') +
      '</div>' +
      '<div style="padding:16px 20px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;background:var(--surface)">' +
        '<span style="font:600 11px/1 var(--font-mono);color:var(--muted)">TOTAL (' + empRows.length + ' employee' + (empRows.length !== 1 ? 's' : '') + ')</span>' +
        '<span style="font:700 18px/1 var(--font-mono);color:var(--text)">' + fmtGBP(totalGBP) + '</span>' +
      '</div>' +
    '</div>';
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('open'));
}

// ─── HR NOTES ─────────────────────────────────────────────────────────────────
async function toggleNotesSection(btn, empId) {
  const section = btn.closest('.sc-section');
  const wasOpen = section.classList.contains('open');
  section.classList.toggle('open');
  if (!wasOpen) await loadNotesList(empId);
}

async function loadNotesList(empId) {
  const container = document.getElementById(`notes-list-${empId}`);
  if (!container) return;
  const res = await fetch(`/api/employee-notes/${empId}`);
  if (!res.ok) { container.innerHTML = '<div class="sc-empty">Failed to load notes.</div>'; return; }
  const notes = await res.json();
  if (!notes.length) { container.innerHTML = '<div class="sc-empty">No notes yet.</div>'; return; }
  const NOTE_COLORS = { general: 'badge-grey', performance: 'badge-blue', hr: 'badge-purple', warning: 'badge-red' };
  container.innerHTML = notes.map(n => `
    <div class="sc-note-item">
      <div class="sc-note-meta">
        <span class="badge ${NOTE_COLORS[n.note_type] || 'badge-grey'}" style="font-size:0.62rem">${n.note_type}</span>
        <span class="sc-note-date">${new Date(n.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}</span>
        ${n.created_by_name ? `<span class="sc-note-author">by ${esc(n.created_by_name)}</span>` : ''}
        <button class="btn btn-danger btn-sm" style="margin-left:auto;padding:2px 8px" onclick="deleteNote(${n.id},${empId})">×</button>
      </div>
      <div class="sc-note-text">${esc(n.note)}</div>
    </div>`).join('');
}

function openNoteModal(empId) {
  document.getElementById('noteEmpId').value = empId;
  document.getElementById('noteType').value = 'general';
  document.getElementById('noteText').value = '';
  openModal('noteModal');
}

async function saveNote() {
  const employee_id = document.getElementById('noteEmpId').value;
  const note_type   = document.getElementById('noteType').value;
  const note        = document.getElementById('noteText').value.trim();
  if (!note) return showToast('Note text is required', 'error');
  const res = await fetch('/api/employee-notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_id, note, note_type })
  });
  if (!res.ok) { const e = await res.json(); return showToast(e.error, 'error'); }
  closeModal('noteModal');
  showToast('Note saved', 'success');
  await loadNotesList(employee_id);
}

async function deleteNote(id, empId) {
  if (!await showConfirm('Delete this note?')) return;
  await fetch(`/api/employee-notes/${id}`, { method: 'DELETE' });
  await loadNotesList(empId);
}

// ─── PAYROLL CSV EXPORT ───────────────────────────────────────────────────────
async function exportPayrollCSV() {
  const year = document.getElementById('salaryYear')?.value || new Date().getFullYear();
  showToast('Generating CSV…', 'info');
  const a = document.createElement('a');
  a.href = `/api/export/payroll-csv?year=${year}`;
  a.download = `payroll-${year}.csv`;
  a.click();
}

// ─── PRINT PAYSLIP ────────────────────────────────────────────────────────────
async function printPayslip(empId, empName) {
  const year  = document.getElementById('salaryYear')?.value || new Date().getFullYear();
  const month = new Date().getMonth() + 1;
  showToast('Preparing payslip…', 'info');
  const res = await fetch(`/api/salary-overview?year=${year}`);
  if (!res.ok) return showToast('Failed to load salary data', 'error');
  const data = await res.json();
  const emp  = data.find(e => e.employee_id === empId);
  if (!emp)  return showToast('Employee data not found', 'error');

  const sym   = currencySymbol(emp.currency || 'GBP');
  const paye  = emp.paye_breakdown;
  const annSal = parseFloat(emp.annual_salary) || 0;
  const grossM = paye ? paye.gross_monthly : annSal / 12;
  const netM   = paye ? paye.net_monthly   : annSal / 12;
  const monthName = MONTHS[month];

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>Payslip – ${empName} – ${monthName} ${year}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #0d1326; padding: 40px; max-width: 700px; margin: 0 auto; }
    .ps-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #4f46e5; padding-bottom: 16px; margin-bottom: 24px; }
    .ps-company { font-size: 1.4rem; font-weight: 800; color: #4f46e5; letter-spacing: -0.5px; }
    .ps-title { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px; color: #566880; margin-top: 2px; }
    .ps-period { text-align: right; }
    .ps-period-val { font-size: 1.1rem; font-weight: 700; }
    .ps-period-sub { font-size: 0.75rem; color: #566880; }
    .ps-employee { background: #f0eeff; border-radius: 10px; padding: 16px 20px; margin-bottom: 20px; display: flex; gap: 40px; flex-wrap: wrap; }
    .ps-emp-field label { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.5px; color: #7c6fcd; font-weight: 700; display: block; margin-bottom: 3px; }
    .ps-emp-field span { font-weight: 600; }
    .ps-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    .ps-table th { background: #e9eef6; padding: 9px 14px; text-align: left; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.5px; color: #566880; }
    .ps-table td { padding: 9px 14px; border-bottom: 1px solid #e4eaf3; }
    .ps-table tr:last-child td { border-bottom: none; }
    .ps-table .pos { color: #059669; font-weight: 700; }
    .ps-table .neg { color: #e11d48; font-weight: 700; }
    .ps-net { display: flex; justify-content: space-between; align-items: center; background: linear-gradient(135deg, #3730a3, #4f46e5); color: #fff; border-radius: 10px; padding: 16px 20px; margin-top: 16px; }
    .ps-net-label { font-size: 0.8rem; opacity: 0.8; text-transform: uppercase; letter-spacing: 0.5px; }
    .ps-net-val { font-size: 1.5rem; font-weight: 800; }
    .ps-footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e4eaf3; font-size: 0.72rem; color: #8698b2; text-align: center; }
    @media print { body { padding: 20px; } }
  </style></head><body>
  <div class="ps-header">
    <div>
      <div class="ps-company">EmpTracker</div>
      <div class="ps-title">Payslip</div>
    </div>
    <div class="ps-period">
      <div class="ps-period-val">${monthName} ${year}</div>
      <div class="ps-period-sub">Pay Period</div>
    </div>
  </div>
  <div class="ps-employee">
    <div class="ps-emp-field"><label>Employee</label><span>${esc(emp.name)}</span></div>
    ${emp.job_title ? `<div class="ps-emp-field"><label>Job Title</label><span>${esc(emp.job_title)}</span></div>` : ''}
    ${emp.department ? `<div class="ps-emp-field"><label>Department</label><span>${esc(emp.department)}</span></div>` : ''}
    <div class="ps-emp-field"><label>Employment Type</label><span>${emp.employment_type === 'self_employed' ? 'Self-Employed' : 'Payroll'}</span></div>
    <div class="ps-emp-field"><label>Currency</label><span>${emp.currency || 'GBP'}</span></div>
    ${emp.start_date ? `<div class="ps-emp-field"><label>Start Date</label><span>${emp.start_date}</span></div>` : ''}
  </div>
  <table class="ps-table">
    <thead><tr><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>
      <tr><td>Gross Monthly Salary</td><td class="pos" style="text-align:right">${sym}${grossM.toLocaleString('en-GB',{minimumFractionDigits:2})}</td></tr>
      ${paye ? `
      <tr><td>Income Tax (PAYE)</td><td class="neg" style="text-align:right">−${sym}${(paye.income_tax/12).toLocaleString('en-GB',{minimumFractionDigits:2})}</td></tr>
      <tr><td>National Insurance</td><td class="neg" style="text-align:right">−${sym}${(paye.national_insurance/12).toLocaleString('en-GB',{minimumFractionDigits:2})}</td></tr>
      ${paye.pension > 0 ? `<tr><td>Pension (${emp.pension_rate}%)</td><td class="neg" style="text-align:right">−${sym}${(paye.pension/12).toLocaleString('en-GB',{minimumFractionDigits:2})}</td></tr>` : ''}
      ` : ''}
    </tbody>
  </table>
  <div class="ps-net">
    <div><div class="ps-net-label">Net Monthly Pay</div></div>
    <div class="ps-net-val">${sym}${netM.toLocaleString('en-GB',{minimumFractionDigits:2})}</div>
  </div>
  <div class="ps-footer">Generated ${new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'})} · EmpTracker · Confidential</div>
  </body></html>`;

  const w = window.open('', '_blank', 'width=800,height=700');
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 400);
}

function togglePaymentsList(btn) {
  const list = btn.nextElementSibling;
  const open = list.classList.toggle('open');
  btn.textContent = (open ? '▼' : '▶') + btn.textContent.slice(1);
}

function openSalaryPaymentModal(empId = '') {
  const now = new Date();
  const sel = document.getElementById('spEmpId');
  sel.innerHTML = '';
  employees.forEach(e => {
    const opt = document.createElement('option');
    opt.value = e.id; opt.textContent = e.name; sel.appendChild(opt);
  });
  if (empId) sel.value = empId;
  document.getElementById('spYear').value  = now.getFullYear();
  document.getElementById('spMonth').value = now.getMonth() + 1;
  document.getElementById('spAmount').value = '';
  document.getElementById('spNotes').value  = '';
  // Auto-set currency from selected employee
  const emp = employees.find(e => String(e.id) === String(empId));
  document.getElementById('spCurrency').value = emp?.currency || 'GBP';
  openModal('salaryPayModal');
}

async function saveSalaryPayment() {
  const employee_id   = document.getElementById('spEmpId').value;
  const payment_year  = document.getElementById('spYear').value;
  const payment_month = document.getElementById('spMonth').value;
  const amount        = document.getElementById('spAmount').value;
  const notes         = document.getElementById('spNotes').value;
  const currency      = document.getElementById('spCurrency').value;
  if (!amount || parseFloat(amount) <= 0) return showToast('Enter a valid amount', 'error');
  const res = await fetch('/api/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_id, payment_year, payment_month, amount, notes, currency })
  });
  if (!res.ok) { const e = await res.json(); return showToast(e.error, 'error'); }
  closeModal('salaryPayModal');
  loadSalaryPage();
}

async function deleteSalaryPayment(id) {
  if (!await showConfirm('Delete this payment?')) return;
  await fetch(`/api/payments/${id}`, { method: 'DELETE' });
  loadSalaryPage();
}

function openOfficeDeductModal(empId) {
  document.getElementById('odEmpId').value = empId;
  document.getElementById('odDescription').value = '';
  document.getElementById('odAmount').value = '';
  document.getElementById('odDate').value = today();
  document.getElementById('odNotes').value = '';
  openModal('officeDeductModal');
}

async function saveOfficeDeduction() {
  const employee_id   = document.getElementById('odEmpId').value;
  const description   = document.getElementById('odDescription').value.trim();
  const amount        = document.getElementById('odAmount').value;
  const deduction_date = document.getElementById('odDate').value;
  const notes         = document.getElementById('odNotes').value;
  if (!description) return showToast('Description is required', 'error');
  if (!amount || parseFloat(amount) <= 0) return showToast('Enter a valid amount', 'error');
  const res = await fetch('/api/office-deductions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_id, description, amount, deduction_date, notes })
  });
  if (!res.ok) { const e = await res.json(); return showToast(e.error, 'error'); }
  closeModal('officeDeductModal');
  loadSalaryPage();
}

async function deleteOfficeDeduction(id) {
  if (!await showConfirm('Remove this deduction?')) return;
  await fetch(`/api/office-deductions/${id}`, { method: 'DELETE' });
  loadSalaryPage();
}

function openBonusModal(empId) {
  document.getElementById('bonusEmpId').value = empId;
  document.getElementById('bonusAmount').value = '';
  document.getElementById('bonusDate').value = today();
  document.getElementById('bonusReason').value = '';
  document.getElementById('bonusNotes').value = '';
  openModal('bonusModal');
}

async function saveBonusRecord() {
  const employee_id = document.getElementById('bonusEmpId').value;
  const amount      = document.getElementById('bonusAmount').value;
  const bonus_date  = document.getElementById('bonusDate').value;
  const reason      = document.getElementById('bonusReason').value.trim();
  const notes       = document.getElementById('bonusNotes').value.trim();
  if (!amount || parseFloat(amount) <= 0) return showToast('Enter a valid bonus amount', 'error');
  const res = await fetch('/api/bonuses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_id, amount, bonus_date, reason, notes })
  });
  if (!res.ok) { const e = await res.json(); return showToast(e.error, 'error'); }
  closeModal('bonusModal');
  loadSalaryPage();
}

async function deleteBonus(id) {
  if (!await showConfirm('Remove this bonus record?')) return;
  await fetch(`/api/bonuses/${id}`, { method: 'DELETE' });
  loadSalaryPage();
}

async function deleteSalaryHistory(id) {
  if (!await showConfirm('Remove this salary history entry?')) return;
  await fetch(`/api/salary-history/${id}`, { method: 'DELETE' });
  loadSalaryPage();
}

function fmtK(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n.toFixed(2);
}

// ─── CALENDAR ────────────────────────────────────────────────────────────────
let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth() + 1; // 1-based
let calData  = []; // raw rows from /api/calendar

let calReminders = [];

async function loadCalendar() {
  document.getElementById('calMonthLabel').textContent = `${MONTHS[calMonth]} ${calYear}`;

  const empFilter = document.getElementById('calEmpFilter').value;

  const [calRes, remRes, pendingRes] = await Promise.all([
    fetch(`/api/calendar?year=${calYear}&month=${calMonth}`),
    fetch(`/api/calendar-reminders?year=${calYear}&month=${calMonth}`),
    fetch(`/api/day-off-requests`)
  ]);
  calData = await calRes.json();
  calReminders = remRes.ok ? await remRes.json() : [];
  const pendingRequests = pendingRes.ok ? await pendingRes.json() : [];
  renderDayOffRequestsBanner(pendingRequests);
  updateCalendarBadge(pendingRequests.length);

  // Update calSub
  const calSub = document.getElementById('calSub');
  if (calSub) {
    const daysOffCount = calData.length;
    const reminderCount = calReminders.length;
    calSub.textContent = `// ${MONTHS[calMonth]} ${calYear} · ${daysOffCount} day${daysOffCount !== 1 ? 's' : ''} off · ${reminderCount} reminder${reminderCount !== 1 ? 's' : ''}`;
  }

  const byDate = {};
  calData.forEach(r => { if (!byDate[r.record_date]) byDate[r.record_date] = []; byDate[r.record_date].push(r); });

  const remindersByDate = {};
  calReminders.forEach(r => { if (!remindersByDate[r.virtual_date]) remindersByDate[r.virtual_date] = []; remindersByDate[r.virtual_date].push(r); });

  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';

  const firstDow = (new Date(calYear, calMonth - 1, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(calYear, calMonth, 0).getDate();
  const prevDays  = new Date(calYear, calMonth - 1, 0).getDate();
  const todayStr  = today();

  for (let i = 0; i < firstDow; i++) {
    const cell = document.createElement('div');
    cell.className = 'cal-cell other-month';
    cell.innerHTML = `<div class="cal-date">${prevDays - firstDow + i + 1}</div>`;
    grid.appendChild(cell);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dow = (new Date(calYear, calMonth - 1, d).getDay() + 6) % 7;
    const entries = (byDate[dateStr] || []).filter(r => !empFilter || String(r.employee_id) === empFilter);
    const remindersToday = remindersByDate[dateStr] || [];

    const cell = document.createElement('div');
    const classes = ['cal-cell'];
    if (dateStr === todayStr) classes.push('today');
    if (dow >= 5) classes.push('weekend');
    if (entries.length) classes.push('has-offs');
    if (remindersToday.length) classes.push('has-reminders');
    cell.className = classes.join(' ');

    const maxShow = 2;
    const chips = entries.slice(0, maxShow).map(r => {
      const cls = parseFloat(r.is_day_off) === 1 ? 'chip-full' : 'chip-half';
      return `<span class="cal-chip ${cls}">${esc(r.employee_name)}</span>`;
    }).join('');
    const more = entries.length > maxShow ? `<div class="cal-more">+${entries.length - maxShow} more</div>` : '';
    const dots = remindersToday.length
      ? `<div class="cal-reminder-dots">${remindersToday.map(r => `<span class="cal-reminder-dot cat-${r.category}" title="${esc(r.title)}"></span>`).join('')}</div>`
      : '';

    cell.innerHTML = `<div class="cal-date">${d}</div><div class="cal-chips">${chips}${more}</div>${dots}`;
    cell.addEventListener('click', () => openDayModal(dateStr, entries, remindersToday));
    grid.appendChild(cell);
  }

  const totalCells = firstDow + daysInMonth;
  const trailing = (7 - (totalCells % 7)) % 7;
  for (let i = 1; i <= trailing; i++) {
    const cell = document.createElement('div');
    cell.className = 'cal-cell other-month';
    cell.innerHTML = `<div class="cal-date">${i}</div>`;
    grid.appendChild(cell);
  }

  renderCalSummary(byDate, empFilter);
}

async function renderCalSummary(byDate, empFilter) {
  const summary = document.getElementById('calSummary');
  const CAT_ICONS = { rent:'🏠', subscription:'📦', deposit:'💳', utility:'⚡', other:'📌' };

  // Fetch upcoming reminders (next 60 days)
  let reminders = [];
  try {
    const r = await fetch('/api/calendar-reminders/upcoming?days=60');
    if (r.ok) reminders = await r.json();
  } catch {}

  const dates = Object.keys(byDate).sort();
  let daysHtml = '';
  let fullDaysTotal = 0, halfDaysTotal = 0;
  dates.forEach(date => {
    const entries = byDate[date].filter(r => !empFilter || String(r.employee_id) === empFilter);
    if (!entries.length) return;
    entries.forEach(r => {
      const v = parseFloat(r.is_day_off);
      if (v === 1) fullDaysTotal++;
      else if (v === 0.5) halfDaysTotal++;
    });
    const chips = entries.map(r => {
      const cls = parseFloat(r.is_day_off) === 1 ? 'chip-full' : 'chip-half';
      const label = parseFloat(r.is_day_off) === 1 ? 'Full' : 'Half';
      return `<div class="cal-sum-row"><span class="cal-chip ${cls}">${label}</span><span class="cal-sum-name">${esc(r.employee_name)}</span></div>`;
    }).join('');
    daysHtml += `<div class="cal-sum-item"><div class="cal-sum-date">${formatDate(date)}</div>${chips}</div>`;
  });

  let remHtml = '';
  reminders.forEach(r => {
    const sym = r.currency === 'AED' ? 'AED ' : r.currency === 'EUR' ? '€' : '£';
    const amt = r.amount ? `<span class="cal-sum-amt">${sym}${parseFloat(r.amount).toLocaleString('en-GB',{minimumFractionDigits:2})}</span>` : '';
    remHtml += `<div class="cal-sum-item">
      <div class="cal-sum-date">${r.virtual_date}</div>
      <div class="cal-sum-row">${CAT_ICONS[r.category] || '📌'} <span class="cal-sum-name">${esc(r.title)}</span>${amt}</div>
    </div>`;
  });

  summary.classList.add('hidden');

  // ── Upcoming panel (next 60 days) ──
  const upcoming = document.getElementById('calUpcoming');
  if (!upcoming) return;

  const MONS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const todayD = new Date(); todayD.setHours(0,0,0,0);
  const in60 = new Date(todayD); in60.setDate(in60.getDate() + 60);

  // Future day-offs (all employees, next 60 days)
  let upcomingDayOffs = [];
  try {
    const r = await fetch(`/api/calendar?year=${todayD.getFullYear()}&month=${todayD.getMonth()+1}`);
    const d2r = await fetch(`/api/calendar?year=${in60.getFullYear()}&month=${in60.getMonth()+1}`);
    const d1 = r.ok ? await r.json() : [];
    const d2 = d2r.ok ? await d2r.json() : [];
    upcomingDayOffs = [...d1, ...d2].filter(r => {
      const d = new Date(r.record_date); d.setHours(0,0,0,0);
      return d >= todayD && d <= in60;
    }).sort((a,b) => a.record_date.localeCompare(b.record_date));
  } catch {}

  const dayOffItems = upcomingDayOffs.slice(0,10).map(r => {
    const d = new Date(r.record_date);
    const typeLabel = parseFloat(r.is_day_off) === 1 ? 'Full day' : 'Half day';
    const cls = parseFloat(r.is_day_off) === 1 ? 'chip-full' : 'chip-half';
    return `<div class="cal-upcoming-item">
      <div class="cal-upcoming-badge">
        <div class="cal-upcoming-badge-day">${d.getUTCDate()}</div>
        <div class="cal-upcoming-badge-mon">${MONS_SHORT[d.getUTCMonth()]}</div>
      </div>
      <div style="flex:1;min-width:0">
        <div class="cal-upcoming-name">${esc(r.employee_name)}</div>
        <div class="cal-upcoming-sub"><span class="cal-chip ${cls}" style="font-size:9px;padding:1px 5px">${typeLabel}</span></div>
      </div>
    </div>`;
  }).join('') || '<div class="cal-upcoming-empty">No days off in the next 60 days</div>';

  const remItems = reminders.slice(0,10).map(r => {
    const d = new Date(r.virtual_date);
    const sym = r.currency === 'AED' ? 'AED ' : r.currency === 'EUR' ? '€' : '£';
    const amt = r.amount ? `<div class="cal-upcoming-amt">${sym}${parseFloat(r.amount).toLocaleString('en-GB',{minimumFractionDigits:2})}</div>` : '';
    const daysUntil = Math.round((d - todayD) / 86400000);
    const urgency = daysUntil <= 7 ? 'color:var(--negative);font-weight:700' : daysUntil <= 14 ? 'color:var(--warning);font-weight:600' : 'color:var(--muted)';
    return `<div class="cal-upcoming-item">
      <div class="cal-upcoming-badge">
        <div class="cal-upcoming-badge-day">${d.getUTCDate()}</div>
        <div class="cal-upcoming-badge-mon">${MONS_SHORT[d.getUTCMonth()]}</div>
      </div>
      <div style="flex:1;min-width:0">
        <div class="cal-upcoming-name">${esc(r.title)}</div>
        <div class="cal-upcoming-sub" style="${urgency}">${daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `in ${daysUntil} days`}</div>
      </div>
      ${amt}
    </div>`;
  }).join('') || '<div class="cal-upcoming-empty">No upcoming expense reminders</div>';

  upcoming.innerHTML = `
    <div class="cal-upcoming-section">
      <div class="cal-upcoming-head"><span class="cal-upcoming-icon">🏖</span> Upcoming Days Off</div>
      ${dayOffItems}
    </div>
    <div class="cal-upcoming-section">
      <div class="cal-upcoming-head"><span class="cal-upcoming-icon">🔔</span> Upcoming Expenses</div>
      ${remItems}
    </div>`;
}

function renderDayOffRequestsBanner(pending) {
  let banner = document.getElementById('dayOffRequestsBanner');
  if (!banner) {
    const calPage = document.getElementById('page-calendar');
    if (!calPage) return;
    banner = document.createElement('div');
    banner.id = 'dayOffRequestsBanner';
    calPage.insertBefore(banner, calPage.firstChild);
  }
  if (!pending.length) { banner.innerHTML = ''; return; }

  const MONS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const rows = pending.map(r => {
    const d = new Date(r.request_date);
    const typeLabel = parseFloat(r.is_day_off) === 1 ? 'Full day' : 'Half day';
    return '<div style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border)">' +
      '<div style="width:36px;text-align:center;background:#1a1f2e;border:1px solid var(--border);border-radius:6px;padding:5px 0;flex-shrink:0">' +
        '<div style="font:800 13px/1 var(--font-mono);color:var(--text)">' + d.getUTCDate() + '</div>' +
        '<div style="font:600 9px/1 var(--font-mono);color:var(--muted)">' + MONS[d.getUTCMonth()] + '</div>' +
      '</div>' +
      '<div style="flex:1">' +
        '<div style="font:600 13px/1 var(--font-sans);color:var(--text)">' + esc(r.employee_name) + '</div>' +
        '<div style="font:500 11px/1 var(--font-mono);color:var(--muted);margin-top:3px">' + typeLabel + (r.department ? ' · ' + esc(r.department) : '') + '</div>' +
        (r.reason ? '<div style="font:500 11px/1.4 var(--font-sans);color:var(--text-2);margin-top:4px;padding:4px 8px;background:var(--surface);border-radius:4px;border-left:2px solid var(--warning)">' + esc(r.reason) + '</div>' : '') +
      '</div>' +
      '<div style="display:flex;gap:6px">' +
        '<button class="btn btn-primary btn-sm" onclick="approveLeave(' + r.id + ')">Approve</button>' +
        '<button class="btn btn-danger btn-sm" onclick="declineLeave(' + r.id + ')">Decline</button>' +
      '</div>' +
    '</div>';
  }).join('');

  banner.innerHTML =
    '<div class="card" style="margin-bottom:16px;border:1px solid var(--warning)">' +
      '<div class="card-header" style="background:var(--warning)22">' +
        '<span class="card-title">Pending Day-Off Requests</span>' +
        '<span style="font:700 11px/1 var(--font-mono);color:var(--muted)">' + pending.length + ' pending</span>' +
      '</div>' +
      '<div>' + rows + '</div>' +
    '</div>';
}

async function approveLeave(id) {
  const res = await fetch('/api/day-off-requests/' + id + '/approve', { method: 'PUT' });
  if (res.ok) { showToast('Day off approved', 'success'); loadCalendar(); }
  else showToast('Failed to approve', 'error');
}

async function declineLeave(id) {
  const reason = prompt('Reason for declining (optional):') ?? '';
  const res = await fetch('/api/day-off-requests/' + id + '/decline', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason })
  });
  if (res.ok) { showToast('Request declined', 'success'); loadCalendar(); }
  else showToast('Failed to decline', 'error');
}

function openDayModal(dateStr, entries, remindersToday = []) {
  document.getElementById('dayModalTitle').textContent = formatDate(dateStr);
  const CAT_ICONS = { rent:'🏠', subscription:'📦', deposit:'💳', utility:'⚡', other:'📌' };
  const REC_LABEL = { none:'one-time', monthly:'monthly', yearly:'yearly' };

  let content = '';

  if (remindersToday.length) {
    content += `<div style="margin-bottom:14px">
      <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--warning);margin-bottom:8px">Expense Reminders</div>
      ${remindersToday.map(r => `
        <div class="cal-reminder-entry">
          <span style="font-size:1.1rem;flex-shrink:0">${CAT_ICONS[r.category] || '📌'}</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700">${esc(r.title)}${r.amount ? ` <span style="color:var(--warning);font-weight:800;margin-left:6px">${currencySymbol(r.currency)}${parseFloat(r.amount).toLocaleString('en-GB',{minimumFractionDigits:2})}</span>` : ''}</div>
            <div style="font-size:0.75rem;color:var(--muted);margin-top:2px">${REC_LABEL[r.recurrence] || 'one-time'}${r.notes ? ' · ' + esc(r.notes) : ''}</div>
          </div>
          <button class="btn btn-danger btn-sm" onclick="deleteCalReminder(${r.id})">Del</button>
        </div>`).join('')}
    </div>`;
  }

  if (entries.length) {
    content += `<div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin-bottom:8px">Days Off</div>`;
    content += entries.map(r => {
      const label = parseFloat(r.is_day_off) === 1 ? 'Full Day' : 'Half Day';
      const cls   = parseFloat(r.is_day_off) === 1 ? 'chip-full' : 'chip-half';
      const typeLabel = r.employment_type === 'self_employed' ? 'Self-Emp' : 'Payroll';
      return `<div class="day-off-entry">
        <span class="cal-chip ${cls}">${label}</span>
        <strong>${esc(r.employee_name)}</strong>
        <span class="badge badge-grey" style="font-size:0.72rem">${typeLabel}</span>
        ${r.notes ? `<span style="color:var(--muted);font-size:0.8rem">${esc(r.notes)}</span>` : ''}
        <button class="btn btn-danger btn-sm" style="margin-left:auto" onclick="deleteRecord(${r.record_id});closeModal('dayModal')">Remove</button>
      </div>`;
    }).join('');
  }

  if (!content) {
    content = `<p style="color:var(--muted);font-size:0.88rem">No entries for this date.</p>`;
  }

  document.getElementById('dayModalContent').innerHTML = content;
  document.getElementById('dayModalBookBtn').onclick = () => { closeModal('dayModal'); openRecordModalForDate(dateStr); };
  openModal('dayModal');
}

function openRecordModalForDate(dateStr) {
  document.getElementById('recId').value = '';
  document.getElementById('recEmpId').value = '';
  document.getElementById('recDate').value = dateStr;
  document.getElementById('recBreak').value = 40;
  document.getElementById('recPhone').value = 0;
  document.getElementById('recWasted').value = 0;
  document.getElementById('recLate').value = 0;
  document.getElementById('recDayOff').value = '1';
  document.getElementById('recNotes').value = '';
  document.getElementById('recFields').style.display = 'none';
  document.getElementById('recordModalTitle').textContent = 'Book Day Off – ' + dateStr;

  // Show employee selector and populate it
  const empRow = document.getElementById('recEmpRow');
  const empSel = document.getElementById('recEmpSelect');
  empSel.innerHTML = '<option value="">-- Select Employee --</option>';
  employees.forEach(e => {
    const opt = document.createElement('option');
    opt.value = e.id; opt.textContent = e.name;
    empSel.appendChild(opt);
  });
  empRow.classList.remove('hidden');

  updatePreview();
  openModal('recordModal');
}

function calPrevMonth() {
  calMonth--;
  if (calMonth < 1) { calMonth = 12; calYear--; }
  loadCalendar();
}

function calNextMonth() {
  calMonth++;
  if (calMonth > 12) { calMonth = 1; calYear++; }
  loadCalendar();
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function today() { return new Date().toISOString().slice(0, 10); }
function formatDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
}
function thisMonth() {
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
  const last = new Date(now.getFullYear(), now.getMonth()+1, 0);
  return { from, to: last.toISOString().slice(0,10) };
}
function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── TOAST NOTIFICATIONS ─────────────────────────────────────────────────────
function showToast(msg, type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.style.setProperty('--toast-dur', duration + 'ms');
  toast.innerHTML = `
    <div class="toast-body">
      <span class="toast-msg">${esc(String(msg))}</span>
      <button class="toast-close" onclick="dismissToast(this.parentElement.parentElement)">✕</button>
    </div>
    <div class="toast-progress"></div>`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  const timer = setTimeout(() => dismissToast(toast), duration);
  toast._timer = timer;
}

function dismissToast(toast) {
  if (!toast || toast._dismissing) return;
  toast._dismissing = true;
  clearTimeout(toast._timer);
  toast.classList.add('dismissing');
  toast.addEventListener('animationend', () => toast.remove(), { once: true });
  setTimeout(() => toast.remove(), 600);
}

// ─── CONFIRM / PROMPT DIALOGS ─────────────────────────────────────────────────
function showConfirm(msg) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.innerHTML = `
      <div class="modal" style="max-width:380px">
        <div class="modal-header"><span class="modal-title">Confirm</span></div>
        <div class="modal-body"><p style="margin:0 0 20px;font-size:0.92rem">${esc(msg)}</p>
          <div style="display:flex;gap:10px;justify-content:flex-end">
            <button class="btn btn-ghost" id="_cfCancel">Cancel</button>
            <button class="btn btn-danger" id="_cfOk">Confirm</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const cleanup = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelector('#_cfOk').onclick     = () => cleanup(true);
    overlay.querySelector('#_cfCancel').onclick  = () => cleanup(false);
    overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(false); });
  });
}

function showPrompt(msg, placeholder = '') {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.innerHTML = `
      <div class="modal" style="max-width:380px">
        <div class="modal-header"><span class="modal-title">${esc(msg)}</span></div>
        <div class="modal-body">
          <input id="_promptInput" class="form-control" placeholder="${esc(placeholder)}" style="margin-bottom:16px">
          <div style="display:flex;gap:10px;justify-content:flex-end">
            <button class="btn btn-ghost" id="_prCancel">Cancel</button>
            <button class="btn btn-primary" id="_prOk">OK</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#_promptInput');
    input.focus();
    const cleanup = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelector('#_prOk').onclick     = () => cleanup(input.value.trim() || null);
    overlay.querySelector('#_prCancel').onclick  = () => cleanup(null);
    overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(null); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') cleanup(input.value.trim() || null); });
  });
}

// ─── SALARY BADGE ─────────────────────────────────────────────────────────────
function updateSalaryBadge(count) {
  ['salaryNavBadge', 'salaryBottomBadge'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (count > 0) { el.textContent = count; el.classList.remove('hidden'); }
    else el.classList.add('hidden');
  });
}

function updateCalendarBadge(count) {
  ['calNavBadge', 'calBellBadge'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (count > 0) { el.textContent = count; el.classList.remove('hidden'); }
    else el.classList.add('hidden');
  });
}

async function refreshCalendarBadge() {
  try {
    const res = await fetch('/api/day-off-requests');
    if (res.ok) updateCalendarBadge((await res.json()).length);
  } catch {}
}

// ─── SALARY REMINDER PANEL ────────────────────────────────────────────────────
function getUnpaidThisMonth(overview, year, month) {
  return (overview || []).filter(emp => {
    if (emp.is_terminated || !emp.annual_salary || parseFloat(emp.annual_salary) <= 0) return false;
    if (emp.start_date) {
      const [sy, sm] = emp.start_date.slice(0, 7).split('-').map(Number);
      if (sy > year || (sy === year && sm > month)) return false;
    }
    const skipKey = `paySkip_${year}_${month}_${emp.employee_id}`;
    if (localStorage.getItem(skipKey)) return false;
    const paid = (emp.payments || []).some(p =>
      parseInt(p.payment_year) === year && parseInt(p.payment_month) === month
    );
    return !paid;
  });
}

async function renderSalaryReminderPanel() {
  const panel = document.getElementById('salaryReminderPanel');
  if (!panel) return;
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;

  try {
    const res = await fetch(`/api/salary-overview?year=${year}`);
    if (!res.ok) { panel.classList.add('hidden'); return; }
    const overview = await res.json();
    const unpaid   = getUnpaidThisMonth(overview, year, month);
    updateSalaryBadge(unpaid.length);

    if (!unpaid.length) { panel.classList.add('hidden'); return; }

    panel.classList.remove('hidden');
    const monthName = MONTHS[month];

    const seList      = unpaid.filter(e => e.employment_type === 'self_employed' && (e.currency || 'GBP') === 'GBP');
    const payrollList = unpaid.filter(e => e.employment_type === 'payroll'       && (e.currency || 'GBP') === 'GBP');
    const intlList    = unpaid.filter(e => (e.currency || 'GBP') !== 'GBP');

    function buildReminderRow(emp) {
      const sym = currencySymbol(emp.currency || 'GBP');
      const grossMonthly = (parseFloat(emp.annual_salary) || 0) / 12;
      const netMo = emp.net_monthly ? parseFloat(emp.net_monthly) : null;
      const displayAmount = netMo ?? grossMonthly;
      const taxLabel = netMo ? ` <span class="sr-net-label">(net take-home)</span>` : '';
      return `<div class="salary-reminder-row">
        <div class="salary-reminder-name">${esc(emp.name)}</div>
        <div class="salary-reminder-amount">${sym}${displayAmount.toLocaleString('en-GB',{minimumFractionDigits:2})} /mo${taxLabel}</div>
        <div class="salary-reminder-actions">
          <button class="btn btn-ghost btn-sm" onclick="skipSalaryReminder(${emp.employee_id},${year},${month})">Skip</button>
          <button class="btn btn-primary btn-sm" onclick="openSalaryPaymentModal(${emp.employee_id})">Log Payment</button>
        </div>
      </div>`;
    }

    function buildReminderSection(label, color, emps) {
      if (!emps.length) return '';
      return `<div class="sr-section">
        <div class="sr-section-hd" style="border-left:3px solid ${color}">
          <span class="sr-section-title" style="color:${color}">${label}</span>
          <span class="sr-section-count">${emps.length} to pay</span>
        </div>
        ${emps.map(buildReminderRow).join('')}
      </div>`;
    }

    panel.innerHTML = `
      <div class="salary-reminder-header">
        <span>💳 ${unpaid.length} employee${unpaid.length > 1 ? 's' : ''} not yet paid for ${monthName} ${year}</span>
        <button class="btn btn-ghost btn-sm" onclick="dismissAllReminders()">Dismiss all</button>
      </div>
      ${buildReminderSection('Self-Employed', '#d97706', seList)}
      ${buildReminderSection('Payroll', '#4f46e5', payrollList)}
      ${buildReminderSection('Internationals', '#0891b2', intlList)}`;
  } catch(e) {
    panel.classList.add('hidden');
  }
}

function skipSalaryReminder(empId, year, month) {
  localStorage.setItem(`paySkip_${year}_${month}_${empId}`, '1');
  renderSalaryReminderPanel();
}

function toggleSalaryReminder() {
  const body = document.getElementById('salaryReminderBody');
  const btn  = document.getElementById('salaryReminderToggleBtn');
  if (!body) return;
  const opening = body.style.display === 'none';
  body.style.display = opening ? '' : 'none';
  if (btn) btn.innerHTML = opening ? '&#9650; Hide' : '&#9660; Show';
  localStorage.setItem('salaryReminderOpen', opening ? '1' : '0');
}

function dismissAllReminders() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;
  const panel = document.getElementById('salaryReminderPanel');
  if (!panel) return;
  panel.querySelectorAll('.salary-reminder-row').forEach(row => {
    const btn = row.querySelector('button[onclick^="skipSalaryReminder"]');
    if (btn) btn.click();
  });
}

// ─── CALENDAR REMINDERS ───────────────────────────────────────────────────────
function openCalReminderModal(dateStr = null) {
  document.getElementById('crTitle').value    = '';
  document.getElementById('crCategory').value = 'other';
  document.getElementById('crDate').value     = dateStr || today();
  document.getElementById('crRecurrence').value = 'none';
  document.getElementById('crAmount').value   = '';
  document.getElementById('crCurrency').value = 'GBP';
  document.getElementById('crNotes').value    = '';
  document.getElementById('crVisibleToStaff').checked = false;
  openModal('calReminderModal');
}

async function saveCalReminder() {
  const title      = document.getElementById('crTitle').value.trim();
  const category   = document.getElementById('crCategory').value;
  const reminderDate = document.getElementById('crDate').value;
  const recurrence = document.getElementById('crRecurrence').value;
  const amount     = document.getElementById('crAmount').value;
  const currency   = document.getElementById('crCurrency').value;
  const notes      = document.getElementById('crNotes').value.trim();
  if (!title)        return showToast('Title is required', 'error');
  if (!reminderDate) return showToast('Date is required', 'error');
  const res = await fetch('/api/calendar-reminders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, category, reminder_date: reminderDate, recurrence, amount: amount || null, currency, notes, visible_to_staff: document.getElementById('crVisibleToStaff').checked })
  });
  if (!res.ok) { const e = await res.json(); return showToast(e.error || 'Save failed', 'error'); }
  closeModal('calReminderModal');
  showToast('Reminder saved', 'success');
  loadCalendar();
}

async function deleteCalReminder(id) {
  if (!await showConfirm('Delete this reminder? All recurrences will be removed.')) return;
  const res = await fetch(`/api/calendar-reminders/${id}`, { method: 'DELETE' });
  if (!res.ok) { showToast('Delete failed', 'error'); return; }
  showToast('Reminder deleted', 'success');
  closeModal('dayModal');
  loadCalendar();
}

// ─── DASHBOARD UPCOMING WIDGET ────────────────────────────────────────────────
function renderUpcomingWidget(upcoming) {
  const stats = document.getElementById('dashStats');
  if (!stats) return;
  const existing = document.getElementById('upcomingWidget');
  if (existing) existing.remove();
  if (!upcoming || !upcoming.length) return;

  const CAT_ICONS = { rent:'🏠', subscription:'📦', deposit:'💳', utility:'⚡', other:'📌' };
  const widget = document.createElement('div');
  widget.id = 'upcomingWidget';
  widget.className = 'dashboard-widget';
  widget.innerHTML = `
    <div class="dashboard-widget-header">Upcoming Reminders (next 7 days)</div>
    <div class="dashboard-widget-body">
      ${upcoming.map(r => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:1.1rem">${CAT_ICONS[r.category] || '📌'}</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:0.88rem">${esc(r.title)}</div>
            <div style="font-size:0.75rem;color:var(--muted)">${r.virtual_date}${r.amount ? ' · ' + currencySymbol(r.currency) + parseFloat(r.amount).toLocaleString('en-GB',{minimumFractionDigits:2}) : ''}</div>
          </div>
        </div>`).join('')}
    </div>`;
  stats.insertAdjacentElement('afterend', widget);
}

// ─── HOTEL EXPENSES ──────────────────────────────────────────────────────────

let hotelData = [];
let _hotelYearFilter = 'all';

async function loadHotelExpenses() {
  const res = await fetch('/api/hotel-expenses');
  if (!res.ok) { showToast('Failed to load hotel expenses', 'error'); return; }
  hotelData = await res.json();
  renderHotelSummary();
  renderHotelTable();
}

function setHotelYear(btn, yr) {
  _hotelYearFilter = yr;
  document.querySelectorAll('#hotelYearFilters .deal-q-btn').forEach(b => b.classList.toggle('active', b.dataset.hyr === yr));
  renderHotelSummary();
  renderHotelTable();
}

function hotelYearFiltered() {
  if (_hotelYearFilter === 'all') return hotelData;
  const yr = parseInt(_hotelYearFilter);
  return hotelData.filter(r => r.event_year === yr || r.event_year === String(yr));
}

function hotelCurrencySymbol(c) {
  if (c === 'GBP') return '£';
  if (c === 'EUR') return '€';
  if (c === 'CHF') return 'CHF ';
  if (c === 'AED') return 'AED ';
  return '$';
}

function fmtHotelNum(v) {
  if (v == null || v === '') return '—';
  return parseFloat(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtHotelAmount(v) {
  if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
  if (v >= 1000)    return (v / 1000).toFixed(1) + 'k';
  return v.toFixed(0);
}

function renderHotelSummary() {
  const yearData = hotelYearFiltered();

  function parseCost(str) {
    if (!str) return 0;
    return parseFloat(String(str).replace(/[^0-9.]/g, '')) || 0;
  }

  const byCur = {};
  function ensureCur(c) { byCur[c] = byCur[c] || { paid: 0, av: 0, cost: 0 }; }
  yearData.forEach(r => {
    const paidCur = r.paid_currency || r.currency || 'USD';
    const avCur   = r.av_currency   || r.currency || 'USD';
    const costCur = r.paid_currency || r.currency || 'USD';
    ensureCur(paidCur);
    if (r.paid_amount != null) byCur[paidCur].paid += parseFloat(r.paid_amount) || 0;
    if (r.av_amount != null && r.av_billing !== 'included') {
      ensureCur(avCur);
      byCur[avCur].av += parseFloat(r.av_amount) || 0;
    }
    const costNum = parseCost(r.cost);
    ensureCur(costCur);
    if (costNum > 0) byCur[costCur].cost += costNum;
  });

  const total  = yearData.length;
  const unpaid = yearData.filter(r => r.status !== 'paid').length;
  const fmtN = n => n.toLocaleString('en-GB', {minimumFractionDigits:2, maximumFractionDigits:2});

  const currencyCards = Object.entries(byCur).map(([cur, sums]) => {
    const sym = hotelCurrencySymbol(cur);
    const total_spent = sums.paid + sums.av;
    const outstanding = sums.cost > 0 ? Math.max(0, sums.cost - sums.paid) : null;
    return `
      <div class="hotel-fin-card">
        <div class="hotel-fin-currency">${cur}</div>
        <div class="hotel-fin-row">
          <span class="hotel-fin-lbl">Venue / Hotel Paid</span>
          <span class="hotel-fin-val hotel-fin-green">${sym}${fmtN(sums.paid)}</span>
        </div>
        <div class="hotel-fin-row">
          <span class="hotel-fin-lbl">AV (separate charges)</span>
          <span class="hotel-fin-val hotel-fin-blue">${sym}${fmtN(sums.av)}</span>
        </div>
        <div class="hotel-fin-row hotel-fin-total-row">
          <span class="hotel-fin-lbl">Total Spent</span>
          <span class="hotel-fin-val">${sym}${fmtN(total_spent)}</span>
        </div>
        ${outstanding !== null ? `<div class="hotel-fin-row" style="margin-top:6px;border-top:1px solid var(--border);padding-top:6px">
          <span class="hotel-fin-lbl">Outstanding</span>
          <span class="hotel-fin-val ${outstanding > 0 ? 'hotel-fin-red' : 'hotel-fin-green'}">${outstanding > 0 ? sym+fmtN(outstanding) : '✓ Settled'}</span>
        </div>` : ''}
      </div>`;
  }).join('');

  // GBP conversion rates (approximate)
  const TO_GBP = { GBP:1, USD:0.787, EUR:0.855, CHF:0.885, AED:0.2141, PHP:0.0138 };
  let gbpPaid = 0, gbpAv = 0, gbpCost = 0;
  Object.entries(byCur).forEach(([cur, sums]) => {
    const rate = TO_GBP[cur] || 0.787;
    gbpPaid += sums.paid * rate;
    gbpAv   += sums.av   * rate;
    gbpCost += sums.cost * rate;
  });
  const gbpTotal = gbpPaid + gbpAv;
  const gbpOutstanding = gbpCost > 0 ? Math.max(0, gbpCost - gbpPaid) : null;
  const gbpCard = `<div class="hotel-fin-card hotel-fin-card--gbp">
    <div class="hotel-fin-currency" style="color:var(--accent)">≈ GBP TOTAL <span style="font-size:9px;font-weight:400;opacity:0.7">estimated</span></div>
    <div class="hotel-fin-row"><span class="hotel-fin-lbl">Venue / Hotel</span><span class="hotel-fin-val hotel-fin-green">£${fmtN(gbpPaid)}</span></div>
    <div class="hotel-fin-row"><span class="hotel-fin-lbl">AV Charges</span><span class="hotel-fin-val hotel-fin-blue">£${fmtN(gbpAv)}</span></div>
    <div class="hotel-fin-row hotel-fin-total-row"><span class="hotel-fin-lbl">Total Spent</span><span class="hotel-fin-val">£${fmtN(gbpTotal)}</span></div>
    ${gbpOutstanding !== null ? `<div class="hotel-fin-row" style="margin-top:6px;border-top:1px solid var(--border);padding-top:6px"><span class="hotel-fin-lbl">Outstanding</span><span class="hotel-fin-val ${gbpOutstanding > 0 ? 'hotel-fin-red' : 'hotel-fin-green'}">${gbpOutstanding > 0 ? '£'+fmtN(gbpOutstanding) : '✓ Settled'}</span></div>` : ''}
    <div style="margin-top:8px;padding-top:6px;border-top:1px dashed var(--border);font:500 9px/1.5 var(--font-mono);color:var(--muted)">USD×0.787 · EUR×0.855<br>CHF×0.885 · AED×0.214</div>
  </div>`;

  document.getElementById('hotelSummary').innerHTML = `
    <div class="hotel-fin-strip">
      ${currencyCards}${gbpCard}
      <div class="hotel-fin-card hotel-fin-card--status">
        <div class="hotel-fin-currency">STATUS${_hotelYearFilter !== 'all' ? ` · ${_hotelYearFilter}` : ''}</div>
        <div class="hotel-fin-row"><span class="hotel-fin-lbl">Total Events</span><span class="hotel-fin-val">${total}</span></div>
        <div class="hotel-fin-row"><span class="hotel-fin-lbl">Fully Paid</span><span class="hotel-fin-val hotel-fin-green">${total - unpaid}</span></div>
        <div class="hotel-fin-row hotel-fin-total-row"><span class="hotel-fin-lbl">Still Outstanding</span><span class="hotel-fin-val ${unpaid > 0 ? 'hotel-fin-red' : 'hotel-fin-green'}">${unpaid > 0 ? unpaid : '✓ All clear'}</span></div>
      </div>
    </div>
  `;
}

function renderHotelTable() {
  const search = (document.getElementById('hotelSearch')?.value || '').toLowerCase();
  const statusF = document.getElementById('hotelStatusFilter')?.value || '';
  const yearData = hotelYearFiltered();
  const filtered = yearData.filter(r => {
    const matchSearch = !search || r.event_name.toLowerCase().includes(search) || (r.hotel||'').toLowerCase().includes(search);
    const matchStatus = !statusF || r.status === statusF;
    return matchSearch && matchStatus;
  });

  const tbody = document.getElementById('hotelTableBody');
  const empty = document.getElementById('hotelEmpty');
  document.getElementById('hotelRowCount').textContent = `${filtered.length} event${filtered.length !== 1 ? 's' : ''}`;

  if (!filtered.length) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const STATUS_BADGE = {
    paid:    '<span class="badge badge-green">Paid</span>',
    partial: '<span class="badge badge-yellow">Partial</span>',
    pending: '<span class="badge badge-grey">Pending</span>'
  };

  const CURRENCIES = ['USD','GBP','EUR','CHF','AED','CAD','AUD'];
  const curOpts = CURRENCIES.map(c => `<option>${c}</option>`).join('');

  tbody.innerHTML = filtered.map(r => {
    const rowClass = r.status === 'paid' ? 'hotel-row-paid' : r.status === 'partial' ? 'hotel-row-partial' : '';
    const rowCur  = r.currency || r.paid_currency || 'USD';
    const avSym   = hotelCurrencySymbol(rowCur);
    const paidSym = hotelCurrencySymbol(rowCur);

    function cellText(field, val, style='') {
      const display = val != null && val !== '' ? esc(String(val)) : '<span class="ht-empty">—</span>';
      return `<td class="ht-cell" data-id="${r.id}" data-field="${field}" data-val="${val != null ? esc(String(val)) : ''}" onclick="htEditCell(this)" style="${style}">${display}</td>`;
    }
    function cellNum(field, val, style='') {
      const display = val != null ? fmtHotelNum(val) : '<span class="ht-empty">—</span>';
      return `<td class="ht-cell ht-num" data-id="${r.id}" data-field="${field}" data-val="${val != null ? val : ''}" onclick="htEditCell(this)" style="${style}">${display}</td>`;
    }
    function cellCur(field, val) {
      return `<td class="ht-cell ht-cur-sel" data-id="${r.id}" data-field="${field}" data-val="${val||'USD'}">
        <select class="ht-select" onchange="htPatchField(${r.id},'${field}',this.value)" onclick="event.stopPropagation()">
          ${CURRENCIES.map(c=>`<option${c===(val||'USD')?' selected':''}>${c}</option>`).join('')}
        </select>
      </td>`;
    }

    const avBilling = r.av_billing === 'included'
      ? `<span class="hotel-incl-badge" style="margin-left:4px">incl.</span>`
      : '';

    const hasInvoice = !!r.invoice_name;
    const invoiceCell = hasInvoice
      ? `<div style="display:flex;gap:4px;align-items:center">
           <a href="/api/hotel-expenses/${r.id}/invoice" target="_blank" class="btn btn-ghost btn-sm" style="font-size:0.72rem;padding:3px 7px" title="${esc(r.invoice_name)}">📄 View</a>
           <button class="btn btn-danger btn-sm" style="padding:3px 6px" onclick="htDeleteInvoice(${r.id})" title="Remove invoice">×</button>
         </div>`
      : `<label class="ht-upload-btn" title="Upload invoice">
           📎 Upload
           <input type="file" accept=".pdf,.png,.jpg,.jpeg" style="display:none" onchange="htUploadInvoice(${r.id},this)">
         </label>`;

    return `<tr class="${rowClass}" id="htr-${r.id}">
      ${cellText('event_name', r.event_name, 'font-weight:700')}
      ${cellText('hotel', r.hotel||'')}
      ${cellText('cost', r.cost||'')}
      ${cellCur('currency', r.currency || r.paid_currency || 'USD')}
      ${cellNum('av_amount', r.av_amount)}
      <td class="ht-cell ht-cur-sel" data-id="${r.id}" data-field="av_billing" data-val="${r.av_billing||'separate'}">
        <select class="ht-select" onchange="htPatchField(${r.id},'av_billing',this.value)" onclick="event.stopPropagation()">
          <option value="separate"${(r.av_billing||'separate')==='separate'?' selected':''}>Sep.</option>
          <option value="included"${r.av_billing==='included'?' selected':''}>Incl.</option>
        </select>
      </td>
      ${cellNum('paid_amount', r.paid_amount, 'font-weight:600')}
      <td class="ht-cell ht-cur-sel" data-id="${r.id}" data-field="status">
        <select class="ht-select ht-status-sel" onchange="htPatchField(${r.id},'status',this.value);htUpdateRowClass(${r.id},this.value)" onclick="event.stopPropagation()">
          <option value="pending"${(r.status||'pending')==='pending'?' selected':''}>Pending</option>
          <option value="partial"${r.status==='partial'?' selected':''}>Partial</option>
          <option value="paid"${r.status==='paid'?' selected':''}>Paid</option>
        </select>
      </td>
      <td style="padding:4px 8px">${invoiceCell}</td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteHotelExpense(${r.id})">×</button></td>
    </tr>`;
  }).join('');
}

function toggleHotelDetail(id) {
  const detail = document.getElementById('hotel-detail-' + id);
  const chev   = document.getElementById('hotel-chev-' + id);
  if (!detail) return;
  const open = detail.style.display !== 'none';
  detail.style.display = open ? 'none' : 'table-row';
  if (chev) chev.style.transform = open ? '' : 'rotate(90deg)';
}

function openHotelModal(id) {
  const r = id ? hotelData.find(x => x.id === id) : null;
  document.getElementById('hotelModalTitle').textContent = r ? 'Edit Hotel Expense' : 'Add Hotel Expense';
  document.getElementById('hotelEditId').value = r ? r.id : '';
  document.getElementById('hotelEventName').value  = r ? r.event_name : '';
  document.getElementById('hotelHotelName').value  = r ? (r.hotel || '') : '';
  document.getElementById('hotelCost').value        = r ? (r.cost || '') : '';
  document.getElementById('hotelStatus').value      = r ? r.status : 'pending';
  document.getElementById('hotelRowCurrency').value = r ? (r.currency || r.paid_currency || 'USD') : 'USD';
  document.getElementById('hotelAvAmount').value    = r && r.av_amount != null ? r.av_amount : '';
  document.getElementById('hotelAvBilling').value   = r ? (r.av_billing || 'separate') : 'separate';
  document.getElementById('hotelPaidAmount').value  = r && r.paid_amount != null ? r.paid_amount : '';
  document.getElementById('hotelStaffHotel').value  = r && r.staff_hotel != null ? r.staff_hotel : '';
  document.getElementById('hotelFlights').value     = r && r.flights    != null ? r.flights    : '';
  document.getElementById('hotelPrinting').value    = r && r.printing   != null ? r.printing   : '';
  document.getElementById('hotelNotes').value       = r ? (r.notes || '') : '';
  document.getElementById('hotelEventYear').value   = r && r.event_year ? String(r.event_year) : '';
  document.getElementById('hotelModal').classList.add('open');
}

function closeHotelModal() {
  document.getElementById('hotelModal').classList.remove('open');
}

async function saveHotelExpense() {
  const id = document.getElementById('hotelEditId').value;
  const payload = {
    event_name:    document.getElementById('hotelEventName').value.trim(),
    hotel:         document.getElementById('hotelHotelName').value.trim(),
    cost:          document.getElementById('hotelCost').value.trim(),
    status:        document.getElementById('hotelStatus').value,
    currency:      document.getElementById('hotelRowCurrency').value,
    av_amount:     document.getElementById('hotelAvAmount').value || null,
    av_billing:    document.getElementById('hotelAvBilling').value,
    paid_amount:   document.getElementById('hotelPaidAmount').value || null,
    staff_hotel:    document.getElementById('hotelStaffHotel').value || null,
    flights:        document.getElementById('hotelFlights').value || null,
    printing:       document.getElementById('hotelPrinting').value || null,
    notes:          document.getElementById('hotelNotes').value.trim(),
    event_year:     document.getElementById('hotelEventYear').value || null
  };
  if (!payload.event_name) { showToast('Event name is required', 'error'); return; }
  const method = id ? 'PUT' : 'POST';
  const url    = id ? `/api/hotel-expenses/${id}` : '/api/hotel-expenses';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) { const e = await res.json(); showToast(e.error || 'Save failed', 'error'); return; }
  showToast(id ? 'Updated' : 'Added', 'success');
  closeHotelModal();
  loadHotelExpenses();
}

async function deleteHotelExpense(id) {
  if (!confirm('Delete this hotel expense record?')) return;
  const res = await fetch(`/api/hotel-expenses/${id}`, { method: 'DELETE' });
  if (!res.ok) { showToast('Delete failed', 'error'); return; }
  showToast('Deleted', 'success');
  loadHotelExpenses();
}

// ─── Hotel inline editing ─────────────────────────────────────────────────────

function htEditCell(td) {
  if (td.querySelector('input')) return; // already editing
  const id    = td.dataset.id;
  const field = td.dataset.field;
  const val   = td.dataset.val;
  const isNum = td.classList.contains('ht-num');

  const input = document.createElement('input');
  input.type  = isNum ? 'number' : 'text';
  input.value = val;
  input.className = 'ht-input';
  if (isNum) { input.step = '0.01'; input.min = '0'; }
  td.innerHTML = '';
  td.appendChild(input);
  input.focus();
  input.select();

  function commit() {
    const newVal = input.value.trim();
    if (newVal !== val) htPatchField(parseInt(id), field, newVal === '' ? null : (isNum ? parseFloat(newVal) : newVal));
    td.dataset.val = newVal;
    td.innerHTML = newVal !== '' ? esc(isNum ? fmtHotelNum(newVal) : newVal) : '<span class="ht-empty">—</span>';
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { td.innerHTML = val !== '' ? esc(isNum ? fmtHotelNum(val) : val) : '<span class="ht-empty">—</span>'; } });
}

async function htPatchField(id, field, value) {
  try {
    const res = await fetch(`/api/hotel-expenses/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value })
    });
    if (!res.ok) { showToast('Save failed', 'error'); return; }
    // Update local data
    const updated = await res.json();
    const idx = hotelData.findIndex(r => r.id === id);
    if (idx !== -1) hotelData[idx] = updated;
    renderHotelSummary();
    if (field === 'cost' || field === 'paid_amount' || field === 'currency') {
      renderHotelTable();
    }
  } catch { showToast('Save failed', 'error'); }
}

function htUpdateRowClass(id, status) {
  const tr = document.getElementById(`htr-${id}`);
  if (!tr) return;
  tr.className = status === 'paid' ? 'hotel-row-paid' : status === 'partial' ? 'hotel-row-partial' : '';
}

async function htUploadInvoice(id, input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) { showToast('File must be under 8 MB', 'error'); return; }
  const reader = new FileReader();
  reader.onload = async e => {
    const base64 = e.target.result.split(',')[1];
    const res = await fetch(`/api/hotel-expenses/${id}/invoice`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoice_name: file.name, invoice_data: base64 })
    });
    if (!res.ok) { showToast('Upload failed', 'error'); return; }
    showToast('Invoice saved', 'success');
    const idx = hotelData.findIndex(r => r.id === id);
    if (idx !== -1) hotelData[idx].invoice_name = file.name;
    renderHotelTable();
  };
  reader.readAsDataURL(file);
}

async function htDeleteInvoice(id) {
  if (!confirm('Remove stored invoice?')) return;
  const res = await fetch(`/api/hotel-expenses/${id}/invoice`, { method: 'DELETE' });
  if (!res.ok) { showToast('Failed', 'error'); return; }
  showToast('Invoice removed', 'success');
  const idx = hotelData.findIndex(r => r.id === id);
  if (idx !== -1) { hotelData[idx].invoice_name = null; hotelData[idx].invoice_data = null; }
  renderHotelTable();
}

// ─── HOLIDAY REQUEST NOTIFICATIONS ───────────────────────────────────────────

async function refreshNotifBadge() {
  try {
    const [hrRes, agRes] = await Promise.all([
      fetch('/api/holiday-requests/count'),
      fetch('/api/agenda-notifications')
    ]);
    const { count: hrCount } = hrRes.ok ? await hrRes.json() : { count: 0 };
    const agItems = agRes.ok ? await agRes.json() : [];
    const total = hrCount + agItems.length;
    const badge = document.getElementById('notifBadge');
    badge.textContent = total;
    badge.classList.toggle('hidden', total === 0);
    document.getElementById('notifBellBtn').classList.toggle('notif-has-pending', total > 0);
  } catch {}
}

function toggleNotifPanel() {
  const panel = document.getElementById('notifPanel');
  const isHidden = panel.classList.toggle('hidden');
  if (!isHidden) loadNotifPanel();
}

document.addEventListener('click', e => {
  const wrap = document.getElementById('notifBellWrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('notifPanel')?.classList.add('hidden');
  }
});

async function loadNotifPanel() {
  const list = document.getElementById('notifList');
  list.innerHTML = '<div class="notif-empty">Loading…</div>';
  try {
    const [hrRes, agRes] = await Promise.all([
      fetch('/api/holiday-requests?status=pending'),
      fetch('/api/agenda-notifications')
    ]);
    const hrItems = hrRes.ok ? await hrRes.json() : [];
    const agItems = agRes.ok ? await agRes.json() : [];
    if (!hrItems.length && !agItems.length) { list.innerHTML = '<div class="notif-empty">No pending notifications</div>'; return; }
    const agendaHtml = agItems.map(a => {
      const since = new Date(a.uploaded_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      return `<div class="notif-item" id="ag-notif-${a.id}">
        <div class="notif-item-name">📋 Agenda uploaded</div>
        <div class="notif-item-meta">${esc(a.employee_name)} · ${esc(a.event_name)} · ${since}</div>
        <div class="notif-item-actions">
          <button class="notif-approve-btn" onclick="dismissAgendaNotif(${a.id})">✓ Dismiss</button>
        </div>
      </div>`;
    }).join('');
    const hrHtml = hrItems.map(r => {
      const d = new Date(r.request_date);
      const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      const typeStr = r.day_type === 'half' ? 'Half Day' : 'Full Day';
      const since = new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      return `<div class="notif-item" id="notif-item-${r.id}">
        <div class="notif-item-name">${esc(r.employee_name)}</div>
        <div class="notif-item-meta">${dateStr} · ${typeStr} · Requested ${since}</div>
        ${r.note ? `<div class="notif-item-note">"${esc(r.note)}"</div>` : ''}
        <div class="notif-item-actions">
          <button class="notif-approve-btn" onclick="reviewHolidayRequest(${r.id},'approve')">✓ Approve</button>
          <button class="notif-deny-btn" onclick="reviewHolidayRequest(${r.id},'deny')">✕ Deny</button>
        </div>
      </div>`;
    }).join('');
    list.innerHTML = agendaHtml + hrHtml;
  } catch { list.innerHTML = '<div class="notif-empty">Failed to load</div>'; }
}

async function dismissAgendaNotif(id) {
  await fetch(`/api/agenda-notifications/${id}/read`, { method: 'PUT' });
  document.getElementById(`ag-notif-${id}`)?.remove();
  const remaining = document.querySelectorAll('#notifList .notif-item').length;
  if (!remaining) document.getElementById('notifList').innerHTML = '<div class="notif-empty">No pending notifications</div>';
  refreshNotifBadge();
}

async function reviewHolidayRequest(id, action) {
  const res = await fetch(`/api/holiday-requests/${id}/${action}`, { method: 'PUT' });
  if (!res.ok) { const e = await res.json(); showToast(e.error || 'Failed', 'error'); return; }
  showToast(action === 'approve' ? 'Request approved' : 'Request denied', action === 'approve' ? 'success' : 'error');
  document.getElementById(`notif-item-${id}`)?.remove();
  const remaining = document.querySelectorAll('#notifList .notif-item').length;
  if (!remaining) document.getElementById('notifList').innerHTML = '<div class="notif-empty">No pending requests</div>';
  refreshNotifBadge();
}

// ─── SUBSCRIPTIONS ────────────────────────────────────────────────────────────

const SUB_FX = { GBP: 1, USD: 0.79, AED: 1/4.67, PHP: 0.014 };
const CYCLE_MONTHS = { monthly: 1, quarterly: 3, annually: 12, one_off: 0 };
let subsData = [];
let _subCycleFilter = 'all';

function setSubFilter(cycle) {
  _subCycleFilter = cycle;
  document.querySelectorAll('#subCycleFilters .deal-q-btn').forEach(b => b.classList.toggle('active', b.dataset.cycle === cycle));
  renderSubTable();
}

function subToGBPPerMonth(s) {
  const rate = SUB_FX[s.currency] || 1;
  const months = CYCLE_MONTHS[s.billing_cycle];
  if (!months) return 0;
  return (parseFloat(s.amount) * rate) / months;
}

async function loadSubscriptions() {
  try {
    const res = await fetch('/api/subscriptions');
    subsData = await res.json();
    renderSubTotals();
    renderSubTable();
  } catch { showToast('Failed to load subscriptions', 'error'); }
}

function renderSubTotals() {
  const activeOnlyChk = document.getElementById('subActiveOnly');
  const activeOnly = !activeOnlyChk || activeOnlyChk.checked;
  let filtered = _subCycleFilter === 'all' ? subsData : subsData.filter(s => s.billing_cycle === _subCycleFilter);
  const active = activeOnly ? filtered.filter(s => s.active) : filtered;
  const perMonth = active.reduce((a, s) => a + subToGBPPerMonth(s), 0);
  const perYear = active.reduce((a, s) => {
    const rate = SUB_FX[s.currency] || 1;
    const months = CYCLE_MONTHS[s.billing_cycle];
    return a + (months ? parseFloat(s.amount) * rate * (12 / months) : parseFloat(s.amount) * rate);
  }, 0);
  document.getElementById('subTotals').innerHTML = `
    <div style="display:flex;gap:14px;flex-wrap:wrap">
      <div class="dash-mini-card dash-mini--indigo" style="flex:1;min-width:160px">
        <div class="dash-mini-label">Total / Month (GBP)</div>
        <div class="dash-mini-value">£${fmt(perMonth)}</div>
      </div>
      <div class="dash-mini-card dash-mini--green" style="flex:1;min-width:160px">
        <div class="dash-mini-label">Total / Year (GBP)</div>
        <div class="dash-mini-value">£${fmt(perYear)}</div>
      </div>
      <div class="dash-mini-card" style="flex:1;min-width:160px">
        <div class="dash-mini-label">Active Subscriptions</div>
        <div class="dash-mini-value">${active.length}</div>
      </div>
    </div>`;
}

function renderSubTable() {
  const tbody = document.getElementById('subTableBody');
  const empty = document.getElementById('subEmpty');
  const count = document.getElementById('subCount');
  const activeOnlyChk = document.getElementById('subActiveOnly');
  const activeOnly = !activeOnlyChk || activeOnlyChk.checked;
  let filtered = _subCycleFilter === 'all' ? subsData : subsData.filter(s => s.billing_cycle === _subCycleFilter);
  if (activeOnly) filtered = filtered.filter(s => s.active);
  count.textContent = `${filtered.length} of ${subsData.length} subscription${subsData.length !== 1 ? 's' : ''}`;
  if (!filtered.length) { tbody.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  const symMap = { GBP:'£', USD:'$', AED:'AED ', PHP:'₱' };
  const now = new Date(); now.setHours(0,0,0,0);
  const in30 = new Date(now); in30.setDate(in30.getDate() + 30);
  tbody.innerHTML = filtered.map(s => {
    const sym = symMap[s.currency] || '';
    const perMonth = subToGBPPerMonth(s);
    const months = CYCLE_MONTHS[s.billing_cycle];
    const perYear = months ? perMonth * 12 : parseFloat(s.amount) * (SUB_FX[s.currency] || 1);
    const cycleLabel = { monthly:'Monthly', quarterly:'Quarterly', annually:'Annually', one_off:'One-Off' }[s.billing_cycle] || s.billing_cycle;
    let renewalHtml = '—';
    if (s.renewal_date) {
      const rd = new Date(s.renewal_date); rd.setHours(0,0,0,0);
      const renewalStr = rd.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
      if (rd < now) {
        renewalHtml = `<span class="sub-renewal-overdue">${renewalStr}</span>`;
      } else if (rd <= in30) {
        renewalHtml = `<span class="sub-renewal-warn">${renewalStr}</span>`;
      } else {
        renewalHtml = renewalStr;
      }
    }
    const activeDot = s.active
      ? '<span style="color:var(--success);font-size:1.1em;vertical-align:middle">●</span>'
      : '<span style="color:var(--muted);font-size:1.1em;vertical-align:middle">●</span>';
    const rowCycleClass = `sub-row-${s.billing_cycle}`;
    return `<tr class="${rowCycleClass}${s.active ? '' : ' sub-inactive'}">
      <td>${activeDot} ${esc(s.name)}</td>
      <td>${sym}${fmt(parseFloat(s.amount))}</td>
      <td>${cycleLabel}</td>
      <td>£${fmt(perMonth)}</td>
      <td>£${fmt(perYear)}</td>
      <td>${renewalHtml}</td>
      <td style="max-width:160px;white-space:normal;font-size:0.8rem;color:var(--muted)">${esc(s.notes||'')}</td>
      <td>
        <button class="btn-icon" title="Edit" onclick="openSubModal(${s.id})">✏️</button>
        <button class="btn-icon" title="${s.active ? 'Deactivate' : 'Activate'}" onclick="toggleSubActive(${s.id},${!s.active})">
          ${s.active ? '⏸️' : '▶️'}
        </button>
        <button class="btn-icon btn-icon--danger" title="Delete" onclick="deleteSub(${s.id})">🗑️</button>
      </td>
    </tr>`;
  }).join('');
}

function openSubModal(id) {
  document.getElementById('subEditId').value = id || '';
  document.getElementById('subModalTitle').textContent = id ? 'Edit Subscription' : 'Add Subscription';
  if (id) {
    const s = subsData.find(x => x.id === id);
    if (!s) return;
    document.getElementById('subName').value = s.name;
    document.getElementById('subCurrency').value = s.currency;
    document.getElementById('subAmount').value = s.amount;
    document.getElementById('subCycle').value = s.billing_cycle;
    document.getElementById('subRenewal').value = s.renewal_date ? s.renewal_date.split('T')[0] : '';
    document.getElementById('subNotes').value = s.notes || '';
  } else {
    document.getElementById('subName').value = '';
    document.getElementById('subCurrency').value = 'GBP';
    document.getElementById('subAmount').value = '';
    document.getElementById('subCycle').value = 'monthly';
    document.getElementById('subRenewal').value = '';
    document.getElementById('subNotes').value = '';
  }
  openModal('subModal');
}

async function saveSub() {
  const id = document.getElementById('subEditId').value;
  const name = document.getElementById('subName').value.trim();
  if (!name) { showToast('Name is required', 'error'); return; }
  const amount = parseFloat(document.getElementById('subAmount').value);
  if (isNaN(amount) || amount < 0) { showToast('Enter a valid amount', 'error'); return; }
  const body = {
    name, vendor: '',
    currency: document.getElementById('subCurrency').value,
    amount, billing_cycle: document.getElementById('subCycle').value,
    renewal_date: document.getElementById('subRenewal').value || null,
    notes: document.getElementById('subNotes').value.trim()
  };
  const method = id ? 'PUT' : 'POST';
  const url = id ? `/api/subscriptions/${id}` : '/api/subscriptions';
  const res = await fetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if (!res.ok) { const e = await res.json(); showToast(e.error || 'Save failed', 'error'); return; }
  showToast(id ? 'Subscription updated' : 'Subscription added', 'success');
  closeModal('subModal');
  loadSubscriptions();
}

async function toggleSubActive(id, active) {
  const res = await fetch(`/api/subscriptions/${id}`, { method: 'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ active }) });
  if (!res.ok) { showToast('Update failed', 'error'); return; }
  const idx = subsData.findIndex(s => s.id === id);
  if (idx !== -1) subsData[idx].active = active;
  renderSubTotals();
  renderSubTable();
}

async function deleteSub(id) {
  if (!confirm('Delete this subscription?')) return;
  const res = await fetch(`/api/subscriptions/${id}`, { method: 'DELETE' });
  if (!res.ok) { showToast('Delete failed', 'error'); return; }
  showToast('Subscription deleted', 'success');
  loadSubscriptions();
}

// ─── PORTFOLIO ────────────────────────────────────────────────────────────────

let portfolioData = [];

async function loadPortfolio() {
  try {
    const res = await fetch('/api/portfolio-events');
    portfolioData = await res.json();
    renderPortfolioGrid();
  } catch { showToast('Failed to load portfolio', 'error'); }
}

function renderPortfolioGrid() {
  const grid = document.getElementById('portfolioGrid');
  const empty = document.getElementById('portfolioEmpty');
  if (!portfolioData.length) { grid.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  grid.innerHTML = portfolioData.map(ev => {
    const dateStr = ev.event_date ? new Date(ev.event_date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : 'TBD';
    const won = parseFloat(ev.total_won) || 0;
    const pipeline = parseFloat(ev.total_pipeline) || 0;
    const outstanding = Math.max(0, pipeline - won);
    const dealCount = parseInt(ev.deal_count) || 0;
    return `<div class="port-card">
      <div class="port-card-header">
        <div class="port-card-title">${esc(ev.name)}</div>
        <div style="display:flex;gap:6px">
          <button class="btn-icon" title="Edit" onclick="openPortfolioModal(${ev.id})">✏️</button>
          <button class="btn-icon btn-icon--danger" title="Delete" onclick="deletePortfolioEvent(${ev.id})">🗑️</button>
        </div>
      </div>
      <div class="port-card-meta">
        ${ev.event_date ? `<span>📅 ${dateStr}</span>` : ''}
        ${ev.location ? `<span>📍 ${esc(ev.location)}</span>` : ''}
      </div>
      <div class="port-card-stats">
        <div class="port-stat">
          <div class="port-stat-label">Revenue Made</div>
          <div class="port-stat-val port-stat--green">£${fmt(won)}</div>
        </div>
        <div class="port-stat">
          <div class="port-stat-label">Outstanding</div>
          <div class="port-stat-val ${outstanding > 0 ? 'port-stat--amber' : ''}">£${fmt(outstanding)}</div>
        </div>
      </div>
      ${ev.companies ? `<div class="port-card-companies"><span style="font-size:0.72rem;color:var(--muted)">Companies: </span>${esc(ev.companies)}</div>` : ''}
      ${ev.notes ? `<div class="port-card-notes">${esc(ev.notes)}</div>` : ''}
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
        <button onclick="togglePortfolioDeals(this,${ev.id})" style="background:none;border:none;cursor:pointer;font-size:0.78rem;color:var(--primary);font-weight:600;padding:0;display:flex;align-items:center;gap:5px">
          <span class="port-deal-arrow" style="display:inline-block;transition:transform .2s">▶</span>
          ${dealCount} deal${dealCount !== 1 ? 's' : ''} linked
        </button>
        <div class="port-deals-list" style="display:none;margin-top:8px"></div>
      </div>
    </div>`;
  }).join('');
}

async function togglePortfolioDeals(btn, eventId) {
  const arrow = btn.querySelector('.port-deal-arrow');
  const list = btn.nextElementSibling;
  const isOpen = list.style.display !== 'none';

  if (isOpen) {
    list.style.display = 'none';
    arrow.style.transform = '';
    return;
  }

  arrow.style.transform = 'rotate(90deg)';
  list.style.display = 'block';
  list.innerHTML = '<div style="font-size:0.75rem;color:var(--muted)">Loading…</div>';

  try {
    const res = await fetch(`/api/portfolio-events/${eventId}/deals`);
    const deals = res.ok ? await res.json() : [];
    if (!deals.length) {
      list.innerHTML = '<div style="font-size:0.75rem;color:var(--muted)">No deals linked yet.</div>';
      return;
    }
    const symMap = { GBP:'£', USD:'$', AED:'AED ', PHP:'₱', EUR:'€' };
    list.innerHTML = deals.map(d => {
      const sym = symMap[d.currency] || '£';
      const paid = parseFloat(d.paid_inc_vat) || 0;
      const amt = parseFloat(d.amount) || 0;
      const isPaid = paid > 0;
      const isPartial = isPaid && paid < amt;
      const statusDot = isPaid && !isPartial
        ? `<span style="color:#16a34a;font-size:11px;font-weight:700">● Paid</span>`
        : isPartial
        ? `<span style="color:#d97706;font-size:11px;font-weight:700">● Part paid</span>`
        : `<span style="color:var(--muted);font-size:11px">○ Unpaid</span>`;
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
        <div>
          <div style="font:600 13px/1.3 var(--font-sans);color:var(--text)">${esc(d.company)}</div>
          <div style="margin-top:2px">${statusDot}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font:700 13px/1 var(--font-sans);color:var(--text)">${sym}${fmt(amt)}</div>
          ${isPaid ? `<div style="font-size:11px;color:#16a34a;margin-top:2px">paid ${sym}${fmt(paid)}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  } catch {
    list.innerHTML = '<div style="font-size:0.75rem;color:var(--negative)">Failed to load deals.</div>';
  }
}

function viewEventDeals(eventId, eventName) {
  _dealEventFilter = String(eventId);
  navigate('deals');
  // Ensure deals are loaded then apply filter
  const apply = () => {
    const sel = document.getElementById('dealEventFilter');
    if (sel) {
      // Ensure the option exists (loadDeals populates it)
      let opt = Array.from(sel.options).find(o => o.value === String(eventId));
      if (!opt) {
        opt = new Option(eventName, String(eventId));
        sel.add(opt);
      }
      sel.value = String(eventId);
    }
    renderDealsTable();
  };
  if (dealsData.length) { apply(); }
  else { loadDeals().then(apply); }
}

function openPortfolioModal(id) {
  document.getElementById('portEditId').value = id || '';
  document.getElementById('portfolioModalTitle').textContent = id ? 'Edit Event' : 'Add Event';
  if (id) {
    const ev = portfolioData.find(x => x.id === id);
    if (!ev) return;
    document.getElementById('portName').value = ev.name;
    document.getElementById('portDate').value = ev.event_date ? ev.event_date.split('T')[0] : '';
    document.getElementById('portLocation').value = ev.location || '';
    document.getElementById('portNotes').value = ev.notes || '';
  } else {
    document.getElementById('portName').value = '';
    document.getElementById('portDate').value = '';
    document.getElementById('portLocation').value = '';
    document.getElementById('portNotes').value = '';
  }
  openModal('portfolioModal');
}

async function savePortfolioEvent() {
  const id = document.getElementById('portEditId').value;
  const name = document.getElementById('portName').value.trim();
  if (!name) { showToast('Event name is required', 'error'); return; }
  const body = {
    name, event_date: document.getElementById('portDate').value || null,
    location: document.getElementById('portLocation').value.trim(),
    notes: document.getElementById('portNotes').value.trim()
  };
  const method = id ? 'PUT' : 'POST';
  const url = id ? `/api/portfolio-events/${id}` : '/api/portfolio-events';
  const res = await fetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if (!res.ok) { const e = await res.json(); showToast(e.error || 'Save failed', 'error'); return; }
  showToast(id ? 'Event updated' : 'Event added', 'success');
  closeModal('portfolioModal');
  loadPortfolio();
}

async function deletePortfolioEvent(id) {
  if (!confirm('Delete this event? Associated deal allocations will also be removed.')) return;
  const res = await fetch(`/api/portfolio-events/${id}`, { method: 'DELETE' });
  if (!res.ok) { showToast('Delete failed', 'error'); return; }
  showToast('Event deleted', 'success');
  loadPortfolio();
}

// ─── DEAL TRACKER ─────────────────────────────────────────────────────────────

const DEAL_STAGES = ['Prospect','Qualified','Proposal','Negotiation','Won','Lost'];
const DEAL_STAGE_COLOR = { Prospect:'#64748b', Qualified:'#7c3aed', Proposal:'#2563eb', Negotiation:'#d97706', Won:'#16a34a', Lost:'#dc2626' };
const DEAL_VAT_QUARTERS = {
  Q1: [11, 12, 1],   // Nov, Dec, Jan
  Q2: [2, 3, 4],     // Feb, Mar, Apr
  Q3: [5, 6, 7],     // May, Jun, Jul
  Q4: [8, 9, 10]     // Aug, Sep, Oct
};
let dealsData = [];
let _dealInv1 = null;
let _dealInv2 = null;
let _dealQFilter = 'all';
let _dealYearFilter = 'all';
let _dealEventFilter = '';
let _dealRangeFrom = '';  // YYYY-MM
let _dealRangeTo   = '';  // YYYY-MM
let _selectedDealIds = new Set();
let _lastInvoiceId = null;
let _nextInvoiceNum = null;
let _importRows = [];

async function loadDeals() {
  try {
    const [dealsRes, invRes] = await Promise.all([
      fetch('/api/deals'),
      fetch('/api/deals/last-invoice')
    ]);
    dealsData = await dealsRes.json();
    // Populate event filter dropdown from deals' events arrays
    const evtSel = document.getElementById('dealEventFilter');
    if (evtSel) {
      const evtMap = {};
      dealsData.forEach(d => (d.events||[]).forEach(ev => { if (ev.event_id) evtMap[ev.event_id] = ev.event_name; }));
      const current = evtSel.value;
      evtSel.innerHTML = '<option value="">All Events</option>' +
        Object.entries(evtMap).map(([id,name]) => `<option value="${id}"${String(id)===current?'selected':''}>${esc(name)}</option>`).join('');
    }
    const invData = await invRes.json();
    _lastInvoiceId = invData.id;
    _nextInvoiceNum = invData.next_number;
    // Update last invoice banner
    const banner = document.getElementById('dealLastInvoice');
    const link = document.getElementById('dealLastInvLink');
    const nextEl = document.getElementById('dealNextInvNum');
    if (invData.invoice_number) {
      banner.style.display = 'flex';
      link.textContent = invData.invoice_number;
      link.dataset.dealId = invData.id;
      // Build prefix + next
      const prefix = invData.invoice_number.replace(/\d+$/, '');
      const nextNum = invData.next_number;
      nextEl.textContent = prefix + String(nextNum).padStart(3, '0');
      document.getElementById('dealNextInvNum').dataset.prefix = prefix;
      document.getElementById('dealNextInvNum').dataset.num = nextNum;
    } else {
      banner.style.display = 'none';
    }
    renderDealsTable();
  } catch { showToast('Failed to load deals', 'error'); }
}

function scrollToLastInvoice(e) {
  e.preventDefault();
  if (!_lastInvoiceId) return;
  const row = document.getElementById(`deal-row-${_lastInvoiceId}`);
  if (row) {
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add('deal-row-highlight');
    setTimeout(() => row.classList.remove('deal-row-highlight'), 2000);
  }
}

function copyNextInvoice() {
  const el = document.getElementById('dealNextInvNum');
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => showToast('Copied!', 'success'));
}

function setDealYear(btn, yr) {
  _dealYearFilter = yr;
  document.querySelectorAll('#dealYearFilters .deal-q-btn').forEach(b => b.classList.toggle('active', b.dataset.yr === yr));
  renderDealsTable();
}

function addDealYear() {
  const yr = prompt('Enter year (e.g. 2028):');
  if (!yr || !/^\d{4}$/.test(yr.trim())) return;
  const container = document.getElementById('dealYearFilters');
  const addBtn = container.querySelector('.deal-q-add');
  const btn = document.createElement('button');
  btn.className = 'deal-q-btn';
  btn.dataset.yr = yr.trim();
  btn.textContent = yr.trim();
  btn.onclick = () => setDealYear(btn, yr.trim());
  container.insertBefore(btn, addBtn);
}

function setDealQ(btn, q) {
  _dealQFilter = q;
  document.querySelectorAll('[data-q]').forEach(b => b.classList.toggle('active', b.dataset.q === q));
  renderDealsTable();
}

function setDealRange() {
  _dealRangeFrom = document.getElementById('dealRangeFrom')?.value || '';
  _dealRangeTo   = document.getElementById('dealRangeTo')?.value   || '';
  const active = _dealRangeFrom || _dealRangeTo;
  document.getElementById('dealRangeClear')?.classList.toggle('hidden', !active);
  // When a range is active, clear Q/year filters so they don't conflict
  if (active) {
    _dealQFilter = 'all';
    _dealYearFilter = 'all';
    document.querySelectorAll('[data-q]').forEach(b => b.classList.toggle('active', b.dataset.q === 'all'));
    document.querySelectorAll('[data-yr]').forEach(b => b.classList.toggle('active', b.dataset.yr === 'all'));
  }
  renderDealsTable();
}

function clearDealRange() {
  _dealRangeFrom = ''; _dealRangeTo = '';
  const from = document.getElementById('dealRangeFrom');
  const to   = document.getElementById('dealRangeTo');
  if (from) from.value = '';
  if (to)   to.value   = '';
  document.getElementById('dealRangeClear')?.classList.add('hidden');
  renderDealsTable();
}

function setDealEvent(eventId) {
  _dealEventFilter = eventId;
  renderDealsTable();
}

function dealPassesFilter(d) {
  const q = _dealQFilter;
  const yr = _dealYearFilter;
  const search = (document.getElementById('dealSearch')?.value || '').trim().toLowerCase();
  const byFilter = document.getElementById('dealByFilter')?.value || '';
  if (search && ![(d.company||''),(d.title||''),(d.contact_name||''),(d.invoice_number||'')].some(s => s.toLowerCase().includes(search))) return false;
  if (byFilter && (d.initials||'').toUpperCase() !== byFilter.toUpperCase()) return false;
  if (_dealEventFilter) {
    const evtId = String(_dealEventFilter);
    if (!Array.isArray(d.events) || !d.events.some(ev => String(ev.event_id) === evtId)) return false;
  }
  // Q1/Q2/Q3/Q4 and Year tabs → invoice_date (tax purposes)
  const invDateStr   = d.invoice_date ? String(d.invoice_date).slice(0, 10) : null;
  const invYear      = invDateStr ? parseInt(invDateStr.slice(0, 4), 10) : null;
  const invMonthNum  = invDateStr ? parseInt(invDateStr.slice(5, 7), 10) : null;
  // Range filter → deal_month field (business month, independent of invoice date)
  // deal_month stored as "YY - Mon" text; convert to YYYY-MM for comparison
  const MONTHS_SHORT_F = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dealMonthStr = (() => {
    const raw = (d.deal_month || '').trim();
    if (!raw) {
      // fall back to invoice_date
      if (!invDateStr) return null;
      return invDateStr.slice(0, 7); // YYYY-MM
    }
    // parse "YY - Mon" → YYYY-MM
    const m = raw.match(/^(\d{2})\s*[-–]\s*([A-Za-z]{3})/);
    if (!m) return null;
    const yr2 = parseInt(m[1], 10);
    const fullYr = yr2 >= 0 && yr2 <= 99 ? (yr2 >= 50 ? 1900 + yr2 : 2000 + yr2) : yr2;
    const mo = MONTHS_SHORT_F.findIndex(mn => mn.toLowerCase() === m[2].toLowerCase()) + 1;
    if (!mo) return null;
    return `${fullYr}-${String(mo).padStart(2,'0')}`;
  })();
  if (_dealRangeFrom || _dealRangeTo) {
    if (!dealMonthStr) return false;
    if (_dealRangeFrom && dealMonthStr < _dealRangeFrom) return false;
    if (_dealRangeTo   && dealMonthStr > _dealRangeTo)   return false;
    return true;
  }
  if (yr !== 'all') {
    // fiscal_year takes priority; fall back to invoice_date calendar year
    const dealYear = d.fiscal_year ? String(d.fiscal_year) : (invYear ? String(invYear) : null);
    if (!dealYear || dealYear !== yr) return false;
  }
  if (q !== 'all') {
    const months = DEAL_VAT_QUARTERS[q];
    if (!invMonthNum) return false;
    if (!months.includes(invMonthNum)) return false;
  }
  return true;
}

function renderDealsTable() {
  const filtered = dealsData.filter(dealPassesFilter);
  const tbody = document.getElementById('dealsTableBody');
  const empty = document.getElementById('dealsEmpty');
  const tfoot = document.getElementById('dealsTfoot');

  if (!filtered.length) {
    tbody.innerHTML = ''; tfoot.innerHTML = '';
    empty.classList.remove('hidden');
    renderDealTotals([], tfoot);
    return;
  }
  empty.classList.add('hidden');

  // Populate "By" dropdown with unique initials from all deals
  const byEl = document.getElementById('dealByFilter');
  if (byEl) {
    const currentBy = byEl.value;
    const allInitials = [...new Set(dealsData.map(d => (d.initials||'').toUpperCase()).filter(Boolean))].sort();
    byEl.innerHTML = '<option value="">All Reps</option>' +
      allInitials.map(i => `<option value="${esc(i)}"${i === currentBy ? ' selected' : ''}>${esc(i)}</option>`).join('');
  }

  const symMap = { GBP:'£', USD:'$', AED:'AED ', PHP:'₱', EUR:'€' };
  const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  tbody.innerHTML = filtered.map(d => {
    const sym = symMap[d.currency] || '£';
    // deal_month is the business month (editable). Fall back to invoice_date if blank.
    const dealMonthVal = d.deal_month || (d.invoice_date ? (() => {
      const yy = d.invoice_date.slice(2, 4);
      const mo = parseInt(d.invoice_date.slice(5, 7), 10) - 1;
      return `${yy} - ${MONTHS_SHORT[mo]}`;
    })() : '');
    const invDateStr = d.invoice_date ? new Date(d.invoice_date).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '';

    // Auto-colour logic based on payment
    const paidAmt  = parseFloat(d.paid_inc_vat) || 0;
    const dealAmt  = parseFloat(d.amount) || 0;
    const hasPaid  = d.paid_inc_vat != null && paidAmt > 0;
    const isPartial = hasPaid && paidAmt < dealAmt;
    const rowClass = hasPaid ? 'deal-row-paid' : '';

    const inv1 = d.invoice1_name ? `<a class="deal-inv-link" href="/api/deals/${d.id}/invoice/1" target="_blank" title="${esc(d.invoice1_name)}" onclick="event.stopPropagation()">📄</a>` : '';
    const inv2 = d.invoice2_name ? `<a class="deal-inv-link" href="/api/deals/${d.id}/invoice/2" target="_blank" title="${esc(d.invoice2_name)}" onclick="event.stopPropagation()">📄</a>` : '';

    // Editable cell helper
    const ec = (field, type, val, display, extra='') => {
      const hlKey = `dhl:${d.id}-${field}`;
      const isHl = localStorage.getItem(hlKey) === '1';
      const hlCls = isHl ? ' deal-cell-orange' : '';
      return `<td class="deal-cell-edit${hlCls}" data-id="${d.id}" data-field="${field}" data-type="${type}" data-val="${String(val??'').replace(/"/g,'&quot;')}" data-hlkey="${hlKey}" onclick="dealCellClick(this)" ${extra}>${display}</td>`;
    };

    // Paid cell: orange background if partial payment
    const paidDisplay = hasPaid ? `${sym}${fmt(paidAmt)}` : '<span style="color:var(--muted)">—</span>';
    const paidExtra = `class="deal-num" style="text-align:right${isPartial ? ';background:rgba(234,88,12,.28)' : ''}"`;

    // Notes: truncated display
    const notesDisplay = d.notes
      ? `<span class="deal-notes-cell" title="${esc(d.notes)}">${esc(d.notes)}</span>`
      : '<span style="color:var(--muted);font-size:0.8rem">—</span>';

    const coHlKey = `dhl:${d.id}-company`;
    const coHl = localStorage.getItem(coHlKey) === '1';

    const isFlagged = d.is_flagged || false;
    const isSelected = _selectedDealIds.has(d.id);
    const finalRowClass = (isFlagged ? 'deal-row-flagged' : rowClass) + (isSelected ? ' deal-row-selected' : '');
    return `<tr id="deal-row-${d.id}" class="${finalRowClass}">
      <td style="text-align:center;padding:0 2px">
        <input type="checkbox" class="deal-select-cb" ${isSelected?'checked':''} onclick="event.stopPropagation();toggleDealSelect(${d.id})" style="cursor:pointer;width:14px;height:14px">
        <button onclick="event.stopPropagation();dealToggleFlag(${d.id})" title="Flag row" style="background:none;border:none;cursor:pointer;font-size:15px;color:${isFlagged?'#f59e0b':'var(--border)'};padding:4px;line-height:1">⚑</button>
      </td>
      ${ec('deal_month','text',d.deal_month||'', dealMonthVal ? `<span class="deal-month-disp">${esc(dealMonthVal)}</span>` : '<span style="color:var(--muted)">—</span>', 'style="text-align:center"')}
      <td class="deal-cell-company${coHl?' deal-cell-orange':''}" data-id="${d.id}" data-hlkey="${coHlKey}" onclick="dealCompanyClick(event,${d.id},this)" title="Click to open deal · Shift+click to highlight"><strong class="deal-co-link">${esc(d.company||d.title)}</strong></td>
      ${ec('paid_inc_vat','number',d.paid_inc_vat??'', paidDisplay, `class="deal-num dt-r" oncontextmenu="dealCellContextMenu(event,this)"${isPartial?' style="background:rgba(234,88,12,.28)"':''}`)}
      ${ec('amount','number',d.amount||0, `${sym}${fmt(dealAmt)}`, 'class="deal-num dt-r"')}
      ${ec('tax_vat','number',d.tax_vat??'', d.tax_vat ? `${sym}${fmt(parseFloat(d.tax_vat))}` : '<span style="color:var(--muted)">—</span>', 'class="deal-num dt-r"')}
      ${ec('invoice_date','date',d.invoice_date||'', `${invDateStr||'<span style="color:var(--muted)">—</span>'}`)}
      ${ec('bank','select-bank',d.bank||'', `${esc(d.bank||'')||'<span style="color:var(--muted)">—</span>'}`)}
      <td class="deal-cell-inv" data-id="${d.id}" onclick="openDealInvoicePanel(${d.id})" title="Click to upload / view invoices" style="cursor:pointer">
        <span style="font-family:monospace;font-size:0.72rem;color:${d.invoice_number?'var(--text)':'var(--muted)'}">${d.invoice_number ? esc(d.invoice_number) : '—'}</span>
        ${(d.invoice1_name||d.invoice2_name) ? `<span style="margin-left:4px;font-size:11px" title="${[d.invoice1_name,d.invoice2_name].filter(Boolean).join(', ')}">📎</span>` : ''}
      </td>
      <td class="deal-cell-toggle" onclick="dealToggleBool(${d.id},'signature_received',${!!d.signature_received})" style="text-align:center;cursor:pointer" title="Click to toggle">${d.signature_received ? '✅' : '<span style="color:var(--muted)">—</span>'}</td>
      ${ec('initials','text',d.initials||'', d.initials ? `<span class="deal-initials-badge">${esc(d.initials)}</span>` : '<span style="color:var(--muted)">—</span>', 'style="text-align:center"')}
      ${ec('notes','textarea',d.notes||'', notesDisplay)}
      <td style="text-align:center">
        <button class="btn-icon btn-icon--danger" title="Delete" onclick="deleteDeal(${d.id})">🗑️</button>
      </td>
    </tr>`;
  }).join('');

  window._dealCurrentFiltered = filtered;
  renderDealTotals(filtered, tfoot);
  renderDealsByInitials(filtered);
  updateDealSelectionUI();
}

let _dealCellMenuTd = null;
function dealCellContextMenu(evt, td) {
  evt.preventDefault();
  _dealCellMenuTd = td;
  const menu = document.getElementById('dealCellMenu');
  const isHl = td.classList.contains('deal-cell-orange');
  document.getElementById('dealCellMenuHL').style.display = isHl ? 'none' : 'block';
  document.getElementById('dealCellMenuClear').style.display = isHl ? 'block' : 'none';
  menu.style.display = 'block';
  const x = Math.min(evt.clientX, window.innerWidth - 200);
  const y = Math.min(evt.clientY, window.innerHeight - 80);
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';
  const close = () => { menu.style.display = 'none'; document.removeEventListener('click', close); document.removeEventListener('contextmenu', close); };
  setTimeout(() => { document.addEventListener('click', close); document.addEventListener('contextmenu', close); }, 0);
}
function dealCellMenuAction(action) {
  const td = _dealCellMenuTd;
  if (!td) return;
  const hlKey = td.dataset.hlkey;
  if (!hlKey) return;
  if (action === 'hl') { localStorage.setItem(hlKey, '1'); td.classList.add('deal-cell-orange'); }
  else { localStorage.removeItem(hlKey); td.classList.remove('deal-cell-orange'); }
  document.getElementById('dealCellMenu').style.display = 'none';
}

function dealCompanyClick(evt, id, td) {
  if (evt.shiftKey) {
    const hlKey = td.dataset.hlkey || `dhl:${id}-company`;
    const isHl = localStorage.getItem(hlKey) === '1';
    if (isHl) { localStorage.removeItem(hlKey); td.classList.remove('deal-cell-orange'); }
    else { localStorage.setItem(hlKey, '1'); td.classList.add('deal-cell-orange'); }
    return;
  }
  openDealModal(id);
}

function dealCellClick(td) {
  // Don't open editor if clicking a link/button inside the cell
  if (event.target.tagName === 'A' || event.target.tagName === 'BUTTON' || event.target.closest('a,button')) return;
  // Shift+click = toggle orange highlight
  if (event.shiftKey) {
    const hlKey = td.dataset.hlkey;
    if (hlKey) {
      const isHl = localStorage.getItem(hlKey) === '1';
      if (isHl) { localStorage.removeItem(hlKey); td.classList.remove('deal-cell-orange'); }
      else { localStorage.setItem(hlKey, '1'); td.classList.add('deal-cell-orange'); }
    }
    return;
  }
  // Already editing
  if (td.querySelector('input,select')) return;
  const id = parseInt(td.dataset.id);
  const field = td.dataset.field;
  const type = td.dataset.type;
  const val = td.dataset.val;
  const originalHTML = td.innerHTML;

  let input;
  if (type === 'select') {
    input = document.createElement('select');
    input.className = 'deal-inline-select';
    DEAL_STAGES.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = s;
      if (s === val) opt.selected = true;
      input.appendChild(opt);
    });
  } else if (type === 'select-bank') {
    input = document.createElement('select');
    input.className = 'deal-inline-select';
    ['','HSBC','Stripe'].forEach(s => {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = s || '—';
      if (s === val) opt.selected = true;
      input.appendChild(opt);
    });
  } else if (type === 'textarea') {
    input = document.createElement('textarea');
    input.className = 'deal-inline-input';
    input.value = val;
    input.rows = 2;
    input.style.resize = 'vertical';
    input.style.minHeight = '48px';
  } else {
    input = document.createElement('input');
    input.className = 'deal-inline-input';
    input.type = type === 'number' ? 'number' : type === 'date' ? 'date' : 'text';
    input.value = val;
    if (type === 'number') { input.step = '0.01'; input.min = '0'; }
    if (field === 'initials') { input.maxLength = 4; input.style.textTransform = 'uppercase'; input.style.width = '46px'; }
    if (field === 'invoice_number') input.style.fontFamily = 'monospace';
  }

  td.innerHTML = '';
  td.appendChild(input);
  input.focus();
  if (input.tagName !== 'TEXTAREA' && (input.type === 'text' || input.type === 'number')) input.select();

  const commit = async () => {
    let newVal = input.value;
    if (field === 'initials') newVal = newVal.toUpperCase();
    if (type === 'number') newVal = newVal === '' ? null : parseFloat(newVal);
    if (type === 'date') newVal = newVal || null;
    td.innerHTML = originalHTML; // restore immediately for snappy feel
    const ok = await dealPatchField(id, field, newVal);
    if (ok) {
      const idx = dealsData.findIndex(d => d.id === id);
      if (idx !== -1) dealsData[idx][field] = newVal;
      // Instantly update row green/white when paid amount changes
      if (field === 'paid_inc_vat') {
        const row = document.getElementById(`deal-row-${id}`);
        if (row) {
          const paid = parseFloat(newVal) || 0;
          row.classList.toggle('deal-row-paid', paid > 0);
        }
      }
      renderDealsTable();
    }
  };

  const cancel = () => { td.innerHTML = originalHTML; };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (type !== 'textarea' || e.ctrlKey || e.metaKey)) { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.removeEventListener('blur', commit); cancel(); }
  });
}

function openDealInvoicePanel(dealId) {
  const deal = dealsData.find(d => d.id === dealId);
  if (!deal) return;
  const body = document.getElementById('dealInvoicePanelBody');

  function slotHtml(n) {
    const name = n === 1 ? deal.invoice1_name : deal.invoice2_name;
    const label = n === 1 ? 'Invoice 1' : 'Invoice 2';
    return `<div id="dealInvSlot${n}" style="border:1px solid var(--border);border-radius:10px;padding:14px 16px">
      <div style="font:700 12px/1 var(--font-mono);text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin-bottom:10px">${label}</div>
      ${name
        ? `<div style="display:flex;align-items:center;gap:10px">
            <a href="/api/deals/${dealId}/invoice/${n}" target="_blank" style="font-size:13px;font-weight:600;color:var(--primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(name)}">📄 ${esc(name)}</a>
            <button class="btn btn-ghost btn-sm" style="color:var(--negative);flex-shrink:0" onclick="dealInvoiceDelete(${dealId},${n})">Remove</button>
          </div>`
        : `<label style="display:flex;align-items:center;gap:10px;cursor:pointer">
            <span style="font-size:13px;color:var(--muted)">No file uploaded</span>
            <input type="file" accept=".pdf,.doc,.docx" style="display:none" onchange="dealInvoiceUpload(event,${dealId},${n})">
            <button class="btn btn-ghost btn-sm" onclick="this.previousElementSibling.click()">Upload PDF / Word</button>
          </label>`
      }
    </div>`;
  }

  body.innerHTML = slotHtml(1) + slotHtml(2);
  openModal('dealInvoicePanel');
}

async function dealInvoiceUpload(evt, dealId, n) {
  const file = evt.target.files[0];
  if (!file) return;
  const allowed = ['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  if (!allowed.includes(file.type)) { showToast('Only PDF or Word files allowed', 'error'); return; }
  const reader = new FileReader();
  reader.onload = async e => {
    const base64 = e.target.result.split(',')[1];
    const res = await fetch(`/api/deals/${dealId}/invoice/${n}`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ invoice_name: file.name, invoice_data: base64 })
    });
    if (!res.ok) { showToast('Upload failed', 'error'); return; }
    showToast('Invoice uploaded', 'success');
    const idx = dealsData.findIndex(d => d.id === dealId);
    if (idx !== -1) {
      if (n === 1) { dealsData[idx].invoice1_name = file.name; dealsData[idx].invoice1_data = base64; }
      else         { dealsData[idx].invoice2_name = file.name; dealsData[idx].invoice2_data = base64; }
    }
    openDealInvoicePanel(dealId);
    renderDealsTable();
  };
  reader.readAsDataURL(file);
}

async function dealInvoiceDelete(dealId, n) {
  if (!confirm(`Remove invoice ${n}?`)) return;
  const res = await fetch(`/api/deals/${dealId}/invoice/${n}`, { method: 'DELETE' });
  if (!res.ok) { showToast('Remove failed', 'error'); return; }
  showToast('Invoice removed', 'success');
  const idx = dealsData.findIndex(d => d.id === dealId);
  if (idx !== -1) {
    if (n === 1) { dealsData[idx].invoice1_name = null; dealsData[idx].invoice1_data = null; }
    else         { dealsData[idx].invoice2_name = null; dealsData[idx].invoice2_data = null; }
  }
  openDealInvoicePanel(dealId);
  renderDealsTable();
}

async function dealToggleFlag(id) {
  const idx = dealsData.findIndex(d => d.id === id);
  if (idx === -1) return;
  const newVal = !dealsData[idx].is_flagged;
  const ok = await dealPatchField(id, 'is_flagged', newVal);
  if (ok) {
    dealsData[idx].is_flagged = newVal;
    const row = document.getElementById(`deal-row-${id}`);
    if (row) {
      const paid = parseFloat(dealsData[idx].paid_inc_vat) || 0;
      row.className = newVal ? 'deal-row-flagged' : (paid > 0 ? 'deal-row-paid' : '');
    }
    // Update flag button color immediately
    const btn = row?.querySelector('button[title="Flag row"]');
    if (btn) btn.style.color = newVal ? '#f59e0b' : 'var(--border)';
  }
}

async function dealToggleBool(id, field, currentVal) {
  const newVal = !currentVal;
  const ok = await dealPatchField(id, field, newVal);
  if (ok) {
    const idx = dealsData.findIndex(d => d.id === id);
    if (idx !== -1) dealsData[idx][field] = newVal;
    renderDealsTable();
  }
}

async function dealPatchField(id, field, value) {
  try {
    const res = await fetch(`/api/deals/${id}/field`, {
      method: 'PATCH', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ field, value })
    });
    if (!res.ok) { const e = await res.json(); showToast(e.error || 'Save failed', 'error'); return false; }
    return true;
  } catch { showToast('Save failed', 'error'); return false; }
}

function showDealColorPicker(e, id) {
  e.stopPropagation();
  document.querySelectorAll('.deal-color-picker').forEach(el => el.remove());
  const colors = [
    { status:'none',    label:'Clear',   bg:'transparent', border:'#aaa', icon:'⬜' },
    { status:'paid',    label:'Paid',    bg:'#16a34a',      icon:'🟢' },
    { status:'flagged', label:'Flag',    bg:'#ca8a04',      icon:'🚩' },
    { status:'issue',   label:'Issue',   bg:'#ea580c',      icon:'🟠' },
    { status:'urgent',  label:'Urgent',  bg:'#dc2626',      icon:'🔴' },
  ];
  const picker = document.createElement('div');
  picker.className = 'deal-color-picker';
  picker.innerHTML = colors.map(c => `
    <button class="dcp-btn" title="${c.label}"
      style="background:${c.bg};border:2px solid ${c.border||c.bg}"
      onclick="cycleDealStatus(${id},'${c.status}');document.querySelectorAll('.deal-color-picker').forEach(el=>el.remove())">
      <span>${c.icon}</span>
      <span class="dcp-label">${c.label}</span>
    </button>`).join('');
  const rect = e.currentTarget.getBoundingClientRect();
  picker.style.position = 'fixed';
  picker.style.top = (rect.bottom + 6) + 'px';
  picker.style.left = Math.max(4, rect.left - 60) + 'px';
  document.body.appendChild(picker);
  setTimeout(() => document.addEventListener('click', () => document.querySelectorAll('.deal-color-picker').forEach(el=>el.remove()), { once: true }), 10);
}

function renderDealTotals(filtered, tfoot) {
  const totalPaid = filtered.reduce((a,d) => a + (parseFloat(d.paid_inc_vat)||0), 0);
  const totalDeal = filtered.reduce((a,d) => a + (parseFloat(d.amount)||0), 0);
  const totalTax = filtered.reduce((a,d) => a + (parseFloat(d.tax_vat)||0), 0);
  const remaining = totalDeal - totalPaid;
  tfoot.innerHTML = `<tr class="deal-totals-row">
    <td colspan="3" style="font-weight:700;font-size:0.82rem">Totals (${filtered.length} deals)</td>
    <td style="text-align:right;font-weight:700">£${fmt(totalPaid)}</td>
    <td style="text-align:right;font-weight:700">£${fmt(totalDeal)}</td>
    <td style="text-align:right;font-weight:700">£${fmt(totalTax)}</td>
    <td colspan="7" style="font-size:0.8rem;color:var(--muted)">
      Outstanding: <strong style="color:${remaining > 0 ? 'var(--danger)' : 'var(--success)'}">£${fmt(Math.abs(remaining))}</strong>
      ${_dealQFilter !== 'all' ? `&nbsp;·&nbsp; VAT: <strong>£${fmt(totalTax)}</strong>` : ''}
    </td>
  </tr>`;

  // Store filtered for VAT breakdown
  window._dealTotalsFiltered = filtered;

  document.getElementById('dealTotals').innerHTML = `
    <div class="deal-stat-cards">
      <div class="deal-stat-card">
        <div class="deal-stat-label">Total Paid</div>
        <div class="deal-stat-value">£${fmt(totalPaid)}</div>
      </div>
      <div class="deal-stat-card ds--green">
        <div class="deal-stat-label">Total Revenue</div>
        <div class="deal-stat-value">£${fmt(totalDeal)}</div>
      </div>
      <div class="deal-stat-card ds--alert">
        <div class="deal-stat-label">Outstanding</div>
        <div class="deal-stat-value">£${fmt(Math.max(0,remaining))}</div>
      </div>
      <div class="deal-stat-card ds--indigo" onclick="openVatBreakdown()" style="cursor:pointer" title="Click to see VAT breakdown by company">
        <div class="deal-stat-label">VAT${_dealQFilter !== 'all' ? ' '+_dealQFilter : ' Total'} <span style="font-size:9px;opacity:0.7">▼ breakdown</span></div>
        <div class="deal-stat-value">£${fmt(totalTax)}</div>
      </div>
    </div>`;
}

function openVatBreakdown() {
  const filtered = window._dealTotalsFiltered || [];
  const withVat = filtered.filter(d => parseFloat(d.tax_vat) > 0)
    .sort((a,b) => {
      const da = a.invoice_date || '';
      const db = b.invoice_date || '';
      return da < db ? -1 : da > db ? 1 : 0;
    });
  const totalTax = filtered.reduce((a,d) => a + (parseFloat(d.tax_vat)||0), 0);

  const rows = withVat.map(d => {
    const vat = parseFloat(d.tax_vat);
    const pct = totalTax > 0 ? ((vat / totalTax) * 100).toFixed(1) : 0;
    const invDate = d.invoice_date ? new Date(d.invoice_date).toLocaleDateString('en-GB',{month:'short',year:'2-digit'}) : '—';
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font:600 13px/1.3 var(--font-sans);color:var(--text)">${esc(d.company||d.title)}</div>
        <div style="font:500 11px/1 var(--font-mono);color:var(--muted);margin-top:3px">${invDate}${d.invoice_number ? ' · ' + esc(d.invoice_number) : ''}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;margin-left:16px">
        <div style="font:700 14px/1 var(--font-sans);color:var(--accent)">£${fmt(vat)}</div>
        <div style="font:500 10px/1 var(--font-mono);color:var(--muted);margin-top:3px">${pct}%</div>
      </div>
    </div>`;
  }).join('');

  const label = _dealQFilter !== 'all' ? `VAT ${_dealQFilter}` : 'VAT Total';
  document.getElementById('vatBreakdownTitle').textContent = `${label} — Company Breakdown`;
  document.getElementById('vatBreakdownBody').innerHTML = rows +
    `<div style="display:flex;justify-content:space-between;padding:12px 0 0;font:700 14px/1 var(--font-sans)">
      <span>Total</span><span style="color:var(--accent)">£${fmt(totalTax)}</span>
    </div>`;
  openModal('vatBreakdownModal');
}

// ─── EMPLOYEE PORTAL ──────────────────────────────────────────────────────────
async function checkUserRole() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function initEmployeePortal(user) {
  window.currentUser = user;

  initSidebarCollapse();

  // Wire logout
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  // Hide non-allowed nav items
  const EMP_PAGES = ['dashboard', 'calendar', 'portfolio', 'eventkit'];
  document.querySelectorAll('.nav-item').forEach(el => {
    if (!EMP_PAGES.includes(el.dataset.page)) el.style.display = 'none';
  });
  document.querySelectorAll('.bottom-nav-item').forEach(el => {
    if (!EMP_PAGES.includes(el.dataset.page)) el.style.display = 'none';
  });
  const addEmpBtn = document.getElementById('addEmpBtn');
  if (addEmpBtn) addEmpBtn.style.display = 'none';

  document.title = 'LPGP – My Portal';

  // Override navigate
  window.navigate = function(page) {
    if (!EMP_PAGES.includes(page)) return;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(n => n.classList.remove('active'));
    const pageEl = document.getElementById('page-' + page);
    if (pageEl) pageEl.classList.add('active');
    document.querySelectorAll('[data-page="' + page + '"]').forEach(n => n.classList.add('active'));
    if (page === 'dashboard')  loadEmployeeDashboard(user);
    if (page === 'calendar')   loadEmployeeCalendar();
    if (page === 'portfolio')  loadEmployeePortfolio();
    if (page === 'eventkit')   loadEmployeeKitPage();
  };

  // Attach click handlers since admin init was skipped
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => window.navigate(el.dataset.page));
  });
  document.querySelectorAll('.bottom-nav-item').forEach(el => {
    el.addEventListener('click', () => window.navigate(el.dataset.page));
  });

  // Poll notifications
  loadEmpNotifications();
  setInterval(loadEmpNotifications, 30000);

  // Show dashboard
  window.navigate('dashboard');
}

// ─── ACCOUNTS PORTAL ─────────────────────────────────────────────────────────
async function initAccountsPortal(user) {
  window.currentUser = user;
  initSidebarCollapse();

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  const initials = user.username.slice(0,2).toUpperCase();
  document.getElementById('userLabel').innerHTML =
    '<div class="sidebar-user-pill"><div class="sidebar-user-avatar">' + esc(initials) + '</div>' +
    '<span class="sidebar-user-name">' + esc(user.username) + '</span>' +
    '<span class="sidebar-user-role" style="font:500 9px/1 var(--font-mono);color:var(--accent);text-transform:uppercase;letter-spacing:.5px">Accounts</span></div>';

  document.title = 'LPGP – Accounts';

  const ACC_PAGES = ['dashboard', 'calendar', 'deals'];

  // Hide pages not allowed
  document.querySelectorAll('.nav-item').forEach(el => {
    if (!ACC_PAGES.includes(el.dataset.page)) el.style.display = 'none';
  });
  document.querySelectorAll('.nav-section-label').forEach(el => el.style.display = 'none');

  window.navigate = function(page) {
    if (!ACC_PAGES.includes(page)) return;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(n => n.classList.remove('active'));
    const pageEl = document.getElementById('page-' + page);
    if (pageEl) pageEl.classList.add('active');
    document.querySelectorAll('[data-page="' + page + '"]').forEach(n => n.classList.add('active'));
    const titles = { dashboard: 'Accounts Dashboard', calendar: 'Calendar', deals: 'Deal Tracker' };
    document.getElementById('pageTitle').textContent = titles[page] || page;
    if (page === 'dashboard') loadAccountsDashboard(user);
    if (page === 'calendar')  loadCalendar();
    if (page === 'deals')     loadDealTracker();
  };

  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => { if (ACC_PAGES.includes(el.dataset.page)) window.navigate(el.dataset.page); });
  });

  window.navigate('dashboard');
}

async function loadAccountsDashboard(user) {
  const page = document.getElementById('page-dashboard');
  if (!page) return;
  page.innerHTML = '<div style="padding:32px 24px"><div style="font:500 11px/1 var(--font-mono);color:var(--muted)">Loading…</div></div>';

  let deals = [];
  try {
    const r = await fetch('/api/deal-tracker');
    if (r.ok) deals = await r.json();
  } catch(e) {}

  const active = deals.filter(d => d.status !== 'cancelled');
  const totalPaid  = active.reduce((s,d) => s + (parseFloat(d.paid_inc_vat)||0), 0);
  const totalDeal  = active.reduce((s,d) => s + (parseFloat(d.deal_amount)||0), 0);
  const outstanding = totalDeal - totalPaid;
  const fmtAmt = v => '£' + v.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2});

  let lastInv = '', nextInv = '';
  let maxN = -1;
  active.forEach(d => {
    if (!d.invoice_number) return;
    const m = String(d.invoice_number).match(/(\d+)\s*$/);
    if (m) { const n = parseInt(m[1]); if (n > maxN) { maxN = n; lastInv = d.invoice_number; } }
  });
  if (maxN >= 0) nextInv = lastInv.replace(/\d+$/, String(maxN + 1));

  const card = (label, val, color) =>
    '<div style="flex:1;min-width:140px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px 20px">' +
      '<div style="font:600 9px/1 var(--font-mono);color:var(--muted);letter-spacing:.5px;text-transform:uppercase;margin-bottom:8px">' + label + '</div>' +
      '<div style="font:700 22px/1 var(--font-sans);color:' + (color||'var(--text)') + '">' + val + '</div>' +
    '</div>';

  const greeting = 'Good ' + (new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening') + ', ' + user.username;

  page.innerHTML =
    '<div style="padding:28px 24px">' +
      '<div style="margin-bottom:24px">' +
        '<div style="font:700 20px/1.2 var(--font-sans);color:var(--text);margin-bottom:4px">' + esc(greeting) + '</div>' +
        '<div style="font:500 11px/1 var(--font-mono);color:var(--muted)">Accounts overview · ' + active.length + ' active deal' + (active.length!==1?'s':'') + '</div>' +
      '</div>' +

      '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">' +
        card('Total Paid', fmtAmt(totalPaid), 'var(--positive)') +
        card('Total Deal Value', fmtAmt(totalDeal)) +
        card('Outstanding', fmtAmt(outstanding), outstanding > 0 ? 'var(--negative)' : 'var(--positive)') +
        (lastInv ?
          '<div style="flex:1;min-width:180px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px 20px">' +
            '<div style="font:600 9px/1 var(--font-mono);color:var(--muted);letter-spacing:.5px;text-transform:uppercase;margin-bottom:8px">Last Invoice</div>' +
            '<div style="font:600 12px/1.3 var(--font-mono);color:var(--text);word-break:break-all">' + esc(lastInv) + '</div>' +
            '<div style="font:500 11px/1 var(--font-mono);color:var(--primary);margin-top:10px">Next → ' + esc(nextInv) + '</div>' +
          '</div>'
        : '') +
      '</div>' +

      '<div style="display:flex;gap:12px;flex-wrap:wrap">' +
        '<button class="btn btn-primary" onclick="window.navigate(\'deals\')" style="gap:8px">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>' +
          'Open Deal Tracker' +
        '</button>' +
        '<button class="btn btn-ghost" onclick="window.navigate(\'calendar\')" style="gap:8px">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
          'View Calendar' +
        '</button>' +
      '</div>' +
    '</div>';
}

async function loadEmpNotifications() {
  const res = await fetch('/api/employee/notifications');
  if (!res.ok) return;
  const notifs = await res.json();
  const unread = notifs.filter(n => !n.is_read).length;

  // Badge button above Sign Out in sidebar-footer
  let badge = document.getElementById('empNotifBadge');
  if (!badge) {
    badge = document.createElement('button');
    badge.id = 'empNotifBadge';
    badge.className = 'btn btn-ghost btn-sm';
    badge.style.cssText = 'width:100%;justify-content:center;margin-bottom:6px;gap:6px';
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.parentNode.insertBefore(badge, logoutBtn);
  }
  badge.onclick = () => openEmpNotificationsModal(notifs);
  const bellSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
  if (unread > 0) {
    badge.innerHTML = bellSvg + ' Notifications <span style="background:var(--negative);color:#fff;font:700 9px/1 var(--font-mono);padding:2px 5px;border-radius:8px;margin-left:2px">' + unread + '</span>';
    badge.style.borderColor = 'var(--negative)';
    badge.style.color = 'var(--text)';
  } else {
    badge.innerHTML = bellSvg + ' Notifications';
    badge.style.borderColor = '';
    badge.style.color = '';
  }
}

function openEmpNotificationsModal(notifs) {
  fetch('/api/employee/notifications/read-all', { method: 'PUT' });
  setTimeout(loadEmpNotifications, 500);

  const existing = document.getElementById('empNotifModal');
  if (existing) existing.remove();

  const TYPE_COLOR = { approved: 'var(--positive)', declined: 'var(--negative)', info: 'var(--primary)' };
  const TYPE_ICON  = { approved: '✓', declined: '✕', info: 'ℹ' };
  const rows = notifs.length
    ? notifs.map(n => {
        const d = new Date(n.created_at).toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'});
        const color = TYPE_COLOR[n.type] || 'var(--muted)';
        const icon  = TYPE_ICON[n.type]  || 'ℹ';
        const unreadDot = !n.is_read ? '<span style="width:6px;height:6px;border-radius:50%;background:var(--negative);display:inline-block;margin-right:6px;flex-shrink:0;margin-top:2px"></span>' : '';
        return '<div style="display:flex;gap:10px;padding:14px 0;border-bottom:1px solid var(--border)">' +
          unreadDot +
          '<div style="flex:1">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
              '<span style="font:700 11px/1 var(--font-mono);text-transform:uppercase;color:' + color + '">' + icon + ' ' + n.type + '</span>' +
              '<span style="font:500 10px/1 var(--font-mono);color:var(--muted)">' + d + '</span>' +
            '</div>' +
            '<div style="font:500 13px/1.5 var(--font-sans);color:var(--text)">' + esc(n.message) + '</div>' +
          '</div>' +
        '</div>';
      }).join('')
    : '<div style="color:var(--muted);font-size:0.85rem;padding:24px 0;text-align:center">No notifications yet</div>';

  const modal = document.createElement('div');
  modal.id = 'empNotifModal';
  modal.className = 'modal-overlay';
  modal.innerHTML =
    '<div class="modal" style="max-width:440px">' +
      '<div class="modal-header"><span class="modal-title">Notifications</span>' +
        '<button class="modal-close" onclick="document.getElementById(\'empNotifModal\').remove()">×</button></div>' +
      '<div style="padding:0 20px 4px;max-height:440px;overflow-y:auto">' + rows + '</div>' +
      '<div style="padding:14px 20px;border-top:1px solid var(--border)">' +
        '<button class="btn btn-ghost btn-sm" style="width:100%" onclick="document.getElementById(\'empNotifModal\').remove()">Close</button>' +
      '</div>' +
    '</div>';
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

async function loadEmployeeDashboard(user) {
  const el = document.getElementById('dashStats');
  if (!el) return;
  el.innerHTML = '<div class="skeleton" style="height:200px;border-radius:16px"></div>';

  try {
    const [profileRes, remindersRes, salaryRes] = await Promise.all([
      fetch('/api/employee/profile'),
      fetch('/api/employee/reminders'),
      fetch('/api/employee/salary')
    ]);
    const profile   = profileRes.ok   ? await profileRes.json()   : {};
    const reminders = remindersRes.ok  ? await remindersRes.json() : [];
    const sal       = salaryRes.ok    ? await salaryRes.json()    : null;

    const daysUsed      = parseFloat(profile.days_used) || 0;
    const allowance     = profile.allowance_days || 20;
    const excessDays    = parseFloat(profile.excess_days) || 0;
    const excessDeduct  = parseFloat(profile.excess_deduction) || 0;
    const remaining     = Math.max(0, allowance - daysUsed);
    const pct           = Math.min(100, Math.round((daysUsed / allowance) * 100));
    const initials      = (profile.name || '?').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
    const barColor      = pct > 80 ? 'var(--negative)' : pct > 60 ? 'var(--warning)' : 'var(--positive)';
    const MONS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

    window._empReminders = reminders;
    function remindersCardHtml() {
      const pending = (window._empReminders||[]).filter(r => !r.is_done);
      const done    = (window._empReminders||[]).filter(r => r.is_done);
      const fmtDate = d => { if (!d) return ''; const dt = new Date(d+'T12:00:00'); return dt.toLocaleDateString('en-GB',{day:'numeric',month:'short'}); };
      const itemHtml = r => {
        const isPast = r.reminder_date && r.reminder_date.slice(0,10) < new Date().toLocaleDateString('en-CA');
        return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">' +
          '<div onclick="empToggleReminder(' + r.id + ')" style="width:18px;height:18px;border:2px solid ' + (r.is_done?'var(--primary)':'var(--border)') + ';border-radius:4px;flex-shrink:0;cursor:pointer;display:flex;align-items:center;justify-content:center;background:' + (r.is_done?'var(--primary)':'transparent') + '">' +
            (r.is_done ? '<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"><polyline points="2,6 5,9 10,3"/></svg>' : '') +
          '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font:600 13px/1 var(--font-sans);color:' + (r.is_done?'var(--dim)':'var(--text)') + ';' + (r.is_done?'text-decoration:line-through':'') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(r.title) + '</div>' +
            (r.reminder_date ? '<div style="font:500 10px/1 var(--font-mono);color:' + (isPast&&!r.is_done?'var(--negative)':'var(--muted)') + ';margin-top:3px">' + fmtDate(r.reminder_date) + (isPast&&!r.is_done?' · overdue':'') + '</div>' : '') +
          '</div>' +
          '<button onclick="empDeleteReminder(' + r.id + ')" style="background:none;border:none;color:var(--dim);cursor:pointer;font-size:14px;padding:2px 4px;flex-shrink:0">×</button>' +
        '</div>';
      };
      const listHtml = pending.map(itemHtml).join('') + (done.length ? '<div style="font:600 9px/1 var(--font-mono);color:var(--dim);letter-spacing:.5px;margin:10px 0 4px">COMPLETED</div>' + done.slice(0,3).map(itemHtml).join('') : '');
      return '<div id="empRemindersList">' + (listHtml || '<div style="color:var(--muted);font:500 12px/1.5 var(--font-mono);padding:12px 0;text-align:center">No reminders yet.<br>Add one below.</div>') + '</div>' +
        '<div style="display:flex;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">' +
          '<input id="empReminderInput" class="form-control" style="flex:1;font-size:12px;padding:7px 10px" placeholder="Add a reminder..." onkeydown="if(event.keyCode===13)empAddReminder()">' +
          '<input id="empReminderDate" class="form-control" type="date" style="width:130px;font-size:12px;padding:7px 8px">' +
          '<button class="btn btn-primary btn-sm" onclick="empAddReminder()">+</button>' +
        '</div>';
    }

    // ── Salary card HTML (employee read-only view) ──
    let salHtml = '';
    if (sal && sal.annual_salary > 0) {
      const s = sal;
      const sSym = s.currency === 'GBP' ? '£' : s.currency === 'USD' ? '$' : (s.currency + ' ');
      const paye = s.paye_breakdown;
      const monthlyVal = paye ? paye.net_monthly : s.annual_salary / 12;
      const monthlyLbl = paye ? 'Take-home / mo' : 'Monthly pay';
      const monthlySub = paye
        ? ('after PAYE + NI' + (paye.pension > 0 ? ' + pension' : ''))
        : (sSym + s.annual_salary.toLocaleString('en-GB',{maximumFractionDigits:0}) + '/yr');
      const netRemaining = parseFloat(s.net_remaining) || 0;
      const isOverpaid   = netRemaining < 0;
      const outColor = isOverpaid ? 'var(--positive)' : netRemaining === 0 ? 'var(--muted)' : 'var(--negative)';
      const pctPaid  = parseInt(s.pct_paid) || 0;
      const barW     = Math.min(100, pctPaid);
      const barCol   = pctPaid >= 100 ? 'var(--positive)' : pctPaid > 60 ? 'var(--primary)' : 'var(--warning)';

      // First-month logic (same as admin salary card)
      const fm = s.first_month_full;
      const isPartialFirstMonth = fm && fm.first_month_days < fm.first_month_total_days;
      const payeNetFactor = paye && s.annual_salary > 0 ? paye.net_annual / s.annual_salary : 1;
      let sugFirstMonthNet = isPartialFirstMonth ? parseFloat((fm.first_month_pay * payeNetFactor).toFixed(2)) : null;
      let fmMeta2 = isPartialFirstMonth ? {
        monthName: MONTHS[parseInt(fm.first_month.split('-')[1]) - 1] || fm.first_month,
        daysWorked: fm.first_month_days, daysTotal: fm.first_month_total_days
      } : null;
      if (sugFirstMonthNet === null && s.start_date) {
        const sd2 = new Date(s.start_date + 'T00:00:00');
        if (sd2.getDate() > 1) {
          const dim = new Date(sd2.getFullYear(), sd2.getMonth() + 1, 0).getDate();
          const dw  = dim - sd2.getDate() + 1;
          const nm  = paye ? paye.net_monthly : s.annual_salary / 12;
          sugFirstMonthNet = parseFloat((nm * (dw / dim)).toFixed(2));
          fmMeta2 = { monthName: MONTHS[sd2.getMonth()], daysWorked: dw, daysTotal: dim };
        }
      }
      const showFM = sugFirstMonthNet !== null && fmMeta2 && !isOverpaid;

      const payments = Array.isArray(s.payments) ? s.payments : [];
      const paymentsHtml = payments.length
        ? payments.map(p => '<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--border);font:500 12px/1 var(--font-mono);color:var(--muted)">' +
            '<span>' + (MONTHS[p.payment_month - 1] || p.payment_month) + ' ' + p.payment_year + '</span>' +
            '<span style="color:var(--positive)">+' + sSym + parseFloat(p.amount||0).toLocaleString('en-GB',{minimumFractionDigits:2}) + '</span>' +
          '</div>').join('')
        : '<div style="color:var(--muted);font:500 12px/1 var(--font-mono);padding:12px 0">No payments yet this year.</div>';

      salHtml =
        '<div class="card" style="margin-top:16px">' +
          '<div class="card-header"><span class="card-title">My Pay — ' + s.year + '</span>' +
            '<span style="font:700 11px/1 var(--font-mono);color:var(--muted)">' + (s.employment_type === 'self_employed' ? 'SELF-EMPLOYED' : 'PAYROLL') + '</span>' +
          '</div>' +
          // Progress bar
          '<div style="padding:18px 20px;border-bottom:1px solid var(--border)">' +
            '<div style="display:flex;justify-content:space-between;font:600 12px/1 var(--font-mono);color:var(--muted);margin-bottom:10px">' +
              '<span>Payments received</span><span style="color:' + barCol + '">' + pctPaid + '%</span>' +
            '</div>' +
            '<div style="height:8px;background:var(--border);border-radius:4px">' +
              '<div style="height:100%;width:' + barW + '%;background:' + barCol + ';border-radius:4px;transition:width .4s"></div>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;font:500 11px/1 var(--font-mono);color:var(--muted);margin-top:8px">' +
              '<span>' + sSym + parseFloat(s.total_paid).toLocaleString('en-GB',{minimumFractionDigits:2}) + ' received</span>' +
              '<span>' + sSym + parseFloat(s.salary_target).toLocaleString('en-GB',{minimumFractionDigits:2}) + ' target</span>' +
            '</div>' +
          '</div>' +
          // Stat row
          '<div style="display:flex;border-bottom:1px solid var(--border)">' +
            '<div style="flex:1;padding:16px 20px;border-right:1px solid var(--border)">' +
              '<div style="font:600 9px/1 var(--font-mono);text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:8px">' + monthlyLbl + '</div>' +
              '<div style="font:700 22px/1 var(--font-mono);color:var(--text)">' + sSym + monthlyVal.toLocaleString('en-GB',{maximumFractionDigits:0}) + '</div>' +
              '<div style="font:500 10px/1 var(--font-mono);color:var(--muted);margin-top:6px">' + monthlySub + '</div>' +
            '</div>' +
            (showFM
              ? '<div style="flex:1;padding:16px 20px;border-right:1px solid var(--border);background:rgba(251,191,36,0.05)">' +
                  '<div style="font:600 9px/1 var(--font-mono);text-transform:uppercase;letter-spacing:1px;color:#f59e0b;margin-bottom:8px">1st Month Due</div>' +
                  '<div style="font:700 22px/1 var(--font-mono);color:#f59e0b">' + sSym + Math.round(sugFirstMonthNet).toLocaleString('en-GB') + '</div>' +
                  '<div style="font:500 10px/1 var(--font-mono);color:var(--muted);margin-top:6px">' + fmMeta2.daysWorked + ' of ' + fmMeta2.daysTotal + ' days · ' + fmMeta2.monthName + '</div>' +
                '</div>'
              : '') +
            '<div style="flex:1;padding:16px 20px">' +
              '<div style="font:600 9px/1 var(--font-mono);text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:8px">Year Balance</div>' +
              '<div style="font:700 22px/1 var(--font-mono);color:' + outColor + '">' + (isOverpaid ? '−' : '') + sSym + Math.abs(netRemaining).toLocaleString('en-GB',{maximumFractionDigits:0}) + '</div>' +
              '<div style="font:500 10px/1 var(--font-mono);color:var(--muted);margin-top:6px">' + (isOverpaid ? 'overpaid' : s.year + ' balance') + '</div>' +
            '</div>' +
          '</div>' +
          // PAYE breakdown (if applicable)
          (paye ? '<div style="padding:16px 20px;border-bottom:1px solid var(--border);display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">' +
              '<div style="text-align:center">' +
                '<div style="font:600 9px/1 var(--font-mono);text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:6px">Income Tax</div>' +
                '<div style="font:700 16px/1 var(--font-mono);color:var(--text)">' + sSym + paye.income_tax.toLocaleString('en-GB',{minimumFractionDigits:0}) + '</div>' +
                '<div style="font:500 10px/1 var(--font-mono);color:var(--muted);margin-top:4px">per year</div>' +
              '</div>' +
              '<div style="text-align:center;border-left:1px solid var(--border);border-right:1px solid var(--border)">' +
                '<div style="font:600 9px/1 var(--font-mono);text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:6px">National Ins.</div>' +
                '<div style="font:700 16px/1 var(--font-mono);color:var(--text)">' + sSym + paye.national_insurance.toLocaleString('en-GB',{minimumFractionDigits:0}) + '</div>' +
                '<div style="font:500 10px/1 var(--font-mono);color:var(--muted);margin-top:4px">per year</div>' +
              '</div>' +
              '<div style="text-align:center">' +
                '<div style="font:600 9px/1 var(--font-mono);text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:6px">Take-home</div>' +
                '<div style="font:700 16px/1 var(--font-mono);color:var(--positive)">' + sSym + paye.net_annual.toLocaleString('en-GB',{minimumFractionDigits:0}) + '</div>' +
                '<div style="font:500 10px/1 var(--font-mono);color:var(--muted);margin-top:4px">per year</div>' +
              '</div>' +
            '</div>'
          : '') +
          // Payments list
          '<div style="padding:16px 20px">' +
            '<div style="font:600 10px/1 var(--font-mono);text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:12px">Payments (' + payments.length + ')</div>' +
            paymentsHtml +
          '</div>' +
        '</div>';
    }

    el.innerHTML =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:0">' +
        // Profile card
        '<div class="card">' +
          '<div style="padding:24px">' +
            '<div style="display:flex;align-items:center;gap:16px;margin-bottom:20px">' +
              '<div style="width:52px;height:52px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;font:800 18px/1 var(--font-mono);color:#000;flex-shrink:0">' + initials + '</div>' +
              '<div>' +
                '<div style="font:700 18px/1 var(--font-sans);color:var(--text)">' + esc(profile.name||'') + '</div>' +
                '<div style="font:500 12px/1 var(--font-mono);color:var(--muted);margin-top:4px">' + esc([profile.job_title, profile.department].filter(Boolean).join(' · ')) + '</div>' +
              '</div>' +
            '</div>' +
            (profile.start_date ? '<div style="font:500 11px/1 var(--font-mono);color:var(--muted);margin-bottom:16px">Since ' + profile.start_date + '</div>' : '') +
            '<div style="font:600 10px/1 var(--font-mono);text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:8px">Days Off ' + (profile.year||new Date().getFullYear()) + '</div>' +
            '<div style="display:flex;justify-content:space-between;font:600 12px/1 var(--font-mono);color:var(--muted);margin-bottom:6px">' +
              '<span>' + daysUsed + ' used</span>' +
              (excessDays > 0
                ? '<span style="color:var(--negative)">' + excessDays + ' excess day' + (excessDays !== 1 ? 's' : '') + '</span>'
                : '<span style="color:' + barColor + '">' + remaining + ' remaining</span>') +
            '</div>' +
            '<div style="height:8px;background:var(--border);border-radius:4px;margin-bottom:8px">' +
              '<div style="height:100%;width:' + pct + '%;background:' + barColor + ';border-radius:4px"></div>' +
            '</div>' +
            '<div style="font:500 11px/1 var(--font-mono);color:var(--muted)">' + daysUsed + ' used · ' + allowance + ' allowed</div>' +
            (excessDays > 0
              ? '<div style="margin-top:8px;padding:8px 10px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:6px;font:500 10px/1.4 var(--font-mono);color:var(--negative)">' +
                  excessDays + ' excess day' + (excessDays !== 1 ? 's' : '') + ' · ' +
                  (excessDeduct > 0 ? '£' + excessDeduct.toLocaleString('en-GB',{minimumFractionDigits:2}) + ' deducted from salary' : 'deduction calculated at year end') +
                '</div>'
              : '') +
          '</div>' +
        '</div>' +
        // My Reminders card
        '<div class="card" id="empRemindersCard">' +
          '<div class="card-header"><span class="card-title">My Reminders</span>' +
            '<span style="font:700 11px/1 var(--font-mono);color:var(--muted)">' + ((window._empReminders||[]).filter(r=>!r.is_done).length||'') + (((window._empReminders||[]).filter(r=>!r.is_done).length) ? ' pending' : 'PERSONAL') + '</span>' +
          '</div>' +
          '<div style="padding:4px 18px 14px">' + remindersCardHtml() + '</div>' +
        '</div>' +
      '</div>' +
      salHtml;

    // Hide the other dashboard panels
    ['contractExpiryPanel','headcountPanel','upcomingPanel','activityPanel'].forEach(id => {
      const e = document.getElementById(id);
      if (e) e.innerHTML = '';
    });
    const dashTable = document.querySelector('.card .table-wrap');
    // hide the full employee summary table section
    const dashTableCard = document.getElementById('dashTable');
    if (dashTableCard) {
      const card = dashTableCard.closest('.card');
      if (card) card.style.display = 'none';
    }

  } catch(e) {
    el.innerHTML = '<div class="alert alert-error">Failed to load profile: ' + e.message + '</div>';
  }
}

// ─── DEAL TRACKER ─────────────────────────────────────────────────────────────
let _dealData      = [];
let _dealFromMonth = '';
let _dealToMonth   = '';
let _dealSearch    = '';
let _dealYear      = '';

async function loadDealTracker() {
  const page = document.getElementById('page-deals');
  if (!page) return;
  page.innerHTML = '<div class="skeleton" style="height:500px;border-radius:16px;margin:24px"></div>';
  try {
    const res = await fetch('/api/deal-tracker');
    _dealData = res.ok ? await res.json() : [];
    renderDealTracker();
  } catch(e) {
    page.innerHTML = '<div style="padding:24px"><div class="alert alert-error">Failed to load deals: ' + e.message + '</div></div>';
  }
}

function renderDealTracker() {
  const page = document.getElementById('page-deals');
  if (!page) return;

  const ROW_COLORS = {
    green:  { bg: 'rgba(34,197,94,0.12)',  dot: '#22c55e' },
    orange: { bg: 'rgba(251,146,60,0.14)', dot: '#fb923c' },
    red:    { bg: 'rgba(239,68,68,0.14)',  dot: '#ef4444' },
    yellow: { bg: 'rgba(250,204,21,0.18)', dot: '#facc15' },
    none:   { bg: 'transparent',           dot: 'var(--border)' },
  };

  const fmtAmt = v => (v == null || v === '') ? '' : '£' + parseFloat(v).toLocaleString('en-GB', {minimumFractionDigits:2, maximumFractionDigits:2});
  const fmtDate = d => { if (!d) return ''; const dt = new Date(String(d).slice(0,10)+'T12:00:00'); return isNaN(dt)?'':dt.toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'2-digit'}); };

  const allActive = _dealData.filter(r => r.status !== 'cancelled');
  const cancelled = _dealData.filter(r => r.status === 'cancelled');

  // Apply filters
  const active = allActive.filter(r => {
    // Text search
    if (_dealSearch) {
      const q = _dealSearch.toLowerCase();
      const hay = ((r.company||'') + ' ' + (r.invoice_number||'') + ' ' + (r.bank||'') + ' ' + (r.notes||'')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    // Date range filter
    if (_dealFromMonth || _dealToMonth) {
      const m = r.date_invoice_issued ? String(r.date_invoice_issued).slice(0,7) : null;
      if (!m) return false;
      if (_dealFromMonth && m < _dealFromMonth) return false;
      if (_dealToMonth   && m > _dealToMonth)   return false;
    }
    return true;
  });

  // Collect years present in data for the year dropdown
  const yearsInData = [...new Set(allActive.map(r => r.date_invoice_issued ? String(r.date_invoice_issued).slice(0,4) : null).filter(Boolean))].sort();

  // Totals (active filtered only)
  const totalPaid  = active.reduce((s,r) => s + (parseFloat(r.paid_inc_vat)||0), 0);
  const totalDeal  = active.reduce((s,r) => s + (parseFloat(r.deal_amount)||0), 0);
  const totalVat   = active.reduce((s,r) => s + (parseFloat(r.tax_vat)||0), 0);
  const remaining  = totalDeal - totalPaid;

  // Latest invoice number (scan all deals, not just filtered)
  let _lastInvNum = '', _nextInvNum = '';
  (function() {
    let maxN = -1, maxRaw = '';
    _dealData.forEach(r => {
      if (!r.invoice_number) return;
      const m = String(r.invoice_number).match(/(\d+)\s*$/);
      if (m) { const n = parseInt(m[1]); if (n > maxN) { maxN = n; maxRaw = r.invoice_number; } }
    });
    if (maxN >= 0) {
      _lastInvNum = maxRaw;
      _nextInvNum = maxRaw.replace(/\d+$/, String(maxN + 1));
    }
  })();

  const colW = ['80px','200px','110px','110px','90px','90px','90px','90px','160px','200px','90px','80px','55px'];
  const colH = ['Month','Company','Paid inc VAT','Deal','Tax/VAT','Invoice Date','Date Paid','Bank','Invoice Number','Notes','Sent','Signed','Init'];
  const headerCols =
    '<div style="width:36px;min-width:36px;border-right:1px solid var(--border);flex-shrink:0"></div>' +
    colH.map((h,i) => '<div style="width:' + colW[i] + ';min-width:' + colW[i] + ';padding:8px 10px;font:700 10px/1 var(--font-mono);color:var(--muted);letter-spacing:.5px;text-transform:uppercase;border-right:1px solid var(--border);flex-shrink:0">' + h + '</div>').join('');

  const buildRows = list => list.map(r => {
    const effectiveColor = r.is_flagged ? 'yellow' : (r.row_color || 'none');
    const c = ROW_COLORS[effectiveColor] || ROW_COLORS.none;
    const flagged = r.is_flagged;
    const flagBtn =
      '<div style="width:36px;min-width:36px;border-right:1px solid var(--border);flex-shrink:0;display:flex;align-items:center;justify-content:center">' +
        '<button onclick="toggleDealFlag(' + r.id + ',event)" title="' + (flagged?'Remove flag':'Flag row') + '" style="background:none;border:none;cursor:pointer;padding:4px;font-size:15px;line-height:1;color:' + (flagged?'#facc15':'var(--dim)') + ';transition:color .15s">⚑</button>' +
      '</div>';

    const mkCell = (w, content, onclick, cursor) =>
      '<div onclick="' + onclick + '" style="width:' + w + ';min-width:' + w + ';padding:10px;border-right:1px solid var(--border);flex-shrink:0;display:flex;align-items:center;cursor:' + (cursor||'text') + '">' + content + '</div>';
    const ie = field => 'startDealInlineEdit(' + r.id + ',\'' + field + '\',event)';

    return '<div style="display:flex;align-items:stretch;border-bottom:1px solid var(--border);background:' + c.bg + ';border-left:3px solid ' + c.dot + ';transition:filter .15s" onmouseenter="this.style.filter=\'brightness(1.08)\'" onmouseleave="this.style.filter=\'\'">' +
      flagBtn +
      mkCell(colW[0],  '<span style="font:600 11px/1.3 var(--font-mono);color:var(--muted)">' + esc(r.month_label||'') + '</span>', ie('month_label')) +
      mkCell(colW[1],  '<span style="font:600 13px/1.3 var(--font-sans);color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block">' + esc(r.company) + '</span>', 'openDealModal(' + r.id + ')', 'pointer') +
      mkCell(colW[2],  '<span style="font:700 12px/1 var(--font-mono);color:var(--text)">' + esc(fmtAmt(r.paid_inc_vat)) + '</span>', ie('paid_inc_vat')) +
      mkCell(colW[3],  '<span style="font:600 12px/1 var(--font-mono);color:var(--muted)">' + esc(fmtAmt(r.deal_amount)) + '</span>', ie('deal_amount')) +
      mkCell(colW[4],  '<span style="font:500 11px/1 var(--font-mono);color:var(--muted)">' + esc(fmtAmt(r.tax_vat)) + '</span>', ie('tax_vat')) +
      mkCell(colW[5],  '<span style="font:500 11px/1 var(--font-mono);color:var(--muted)">' + esc(fmtDate(r.date_invoice_issued)) + '</span>', ie('date_invoice_issued')) +
      mkCell(colW[6],  '<span style="font:600 11px/1 var(--font-mono);color:' + (r.date_paid?'var(--positive)':'var(--muted)') + '">' + esc(fmtDate(r.date_paid)) + '</span>', ie('date_paid')) +
      mkCell(colW[7],  '<span style="font:500 11px/1 var(--font-mono);color:var(--muted)">' + esc(r.bank||'') + '</span>', ie('bank')) +
      mkCell(colW[8],  r.invoice_number
        ? '<span style="font:500 10px/1.3 var(--font-mono);color:var(--primary);text-decoration:underline;text-underline-offset:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block">' + esc(r.invoice_number) + ' 📎</span>'
        : '<span style="font:500 10px/1.3 var(--font-mono);color:var(--dim)">+ upload</span>',
        'openInvoiceModal(' + r.id + ',event)', 'pointer') +
      mkCell(colW[9],  '<span style="font:500 11px/1.4 var(--font-sans);color:var(--text);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">' + esc(r.notes||'') + '</span>', ie('notes')) +
      mkCell(colW[10], '<span style="font:600 10px/1 var(--font-mono);color:' + (r.invoice_sent&&r.invoice_sent!=='no'?'var(--positive)':'var(--muted)') + '">' + esc(r.invoice_sent==='no'?'—':r.invoice_sent) + '</span>', ie('invoice_sent'), 'pointer') +
      mkCell(colW[11], '<span style="font:600 10px/1 var(--font-mono);color:' + (r.signature_received==='yes'?'var(--positive)':'var(--muted)') + '">' + esc(r.signature_received==='yes'?'yes':'—') + '</span>', ie('signature_received'), 'pointer') +
      mkCell(colW[12], '<span style="font:700 11px/1 var(--font-mono);color:var(--text)">' + esc(r.initials||'') + '</span>', ie('initials')) +
    '</div>';
  }).join('');

  const rowsHtml       = buildRows(active);
  const cancelledHtml  = buildRows(cancelled);

  const fmtTotal = v => '£' + v.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2});

  page.innerHTML =
    '<div style="padding:20px 24px 0;display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
      '<h2 style="font:700 20px/1 var(--font-sans);color:var(--text);flex:1">Deal Tracker</h2>' +
      '<button class="btn btn-ghost btn-sm" onclick="dealAutoColour()" title="Set green where paid, no colour where unpaid">Auto-colour rows</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="openDealImport()" style="gap:6px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Import Excel / CSV</button>' +
      '<button class="btn btn-primary btn-sm" onclick="openDealModal(null)">+ Add Deal</button>' +
    '</div>' +

    // Summary cards
    '<div style="padding:16px 24px;display:flex;gap:12px;flex-wrap:wrap">' +
      '<div style="flex:1;min-width:140px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px">' +
        '<div style="font:600 9px/1 var(--font-mono);color:var(--muted);letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px">Total Paid</div>' +
        '<div style="font:700 18px/1 var(--font-sans);color:var(--positive)">' + fmtTotal(totalPaid) + '</div>' +
      '</div>' +
      '<div style="flex:1;min-width:140px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px">' +
        '<div style="font:600 9px/1 var(--font-mono);color:var(--muted);letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px">Total Deal Value</div>' +
        '<div style="font:700 18px/1 var(--font-sans);color:var(--text)">' + fmtTotal(totalDeal) + '</div>' +
      '</div>' +
      '<div style="flex:1;min-width:140px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px">' +
        '<div style="font:600 9px/1 var(--font-mono);color:var(--muted);letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px">Tax / VAT</div>' +
        '<div style="font:700 18px/1 var(--font-sans);color:var(--text)">' + fmtTotal(totalVat) + '</div>' +
      '</div>' +
      '<div style="flex:1;min-width:140px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px">' +
        '<div style="font:600 9px/1 var(--font-mono);color:var(--muted);letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px">Remaining</div>' +
        '<div style="font:700 18px/1 var(--font-sans);color:' + (remaining > 0 ? 'var(--negative)' : 'var(--positive)') + '">' + fmtTotal(remaining) + '</div>' +
      '</div>' +
      (_lastInvNum ? (
        '<div style="flex:1;min-width:180px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px">' +
          '<div style="font:600 9px/1 var(--font-mono);color:var(--muted);letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px">Last Invoice</div>' +
          '<div style="font:600 11px/1.3 var(--font-mono);color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + esc(_lastInvNum) + '">' + esc(_lastInvNum) + '</div>' +
          '<div style="font:500 10px/1 var(--font-mono);color:var(--primary);margin-top:8px">Next → ' + esc(_nextInvNum) + '</div>' +
        '</div>'
      ) : '') +
    '</div>' +

    // Filter bar
    (function(){
      const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const monthOpts = (selected, placeholder) =>
        '<option value="">' + placeholder + '</option>' +
        MONTHS.map((m,i) => { const v = String(i+1).padStart(2,'0'); return '<option value="' + v + '"' + (selected===v?' selected':'') + '>' + m + '</option>'; }).join('');
      const yearOpts = yearsInData.map(y => '<option value="' + y + '"' + (_dealYear===y?' selected':'') + '>' + y + '</option>').join('');

      const fromMo = _dealFromMonth ? _dealFromMonth.slice(5,7) : '';
      const toMo   = _dealToMonth   ? _dealToMonth.slice(5,7)   : '';
      const isFiltered = _dealFromMonth || _dealToMonth || _dealSearch;

      return '<div style="padding:0 24px 14px">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 14px;background:var(--surface);border:1px solid var(--border);border-radius:10px">' +
          // Text search
          '<input id="dealSearchInput" class="form-control" style="width:180px;font-size:12px;padding:6px 10px" placeholder="Search company, invoice…" value="' + esc(_dealSearch) + '" oninput="_dealSearch=this.value;renderDealTracker()">' +
          '<div style="width:1px;height:24px;background:var(--border);margin:0 4px"></div>' +
          // Year
          '<select class="form-control" style="width:90px;font-size:12px;padding:6px 8px" onchange="dealSetYear(this.value)"><option value="">All years</option>' + yearOpts + '</select>' +
          // Quick quarters (fiscal: Q1=Nov-Jan, Q2=Feb-Apr, Q3=May-Jul, Q4=Aug-Oct)
          (function(){
            const aq = _activeQuarter();
            const qLabels = ['Q1 Nov–Jan','Q2 Feb–Apr','Q3 May–Jul','Q4 Aug–Oct'];
            return '<div style="display:flex;gap:4px">' +
              qLabels.map((lbl,i) => {
                const isActive = aq === i+1;
                return '<button onclick="dealSetQuarter(' + (i+1) + ')" title="' + lbl + '" style="padding:5px 10px;font:700 11px/1 var(--font-mono);border-radius:6px;border:1px solid var(--border);background:' + (isActive?'var(--primary)':'var(--surface)') + ';color:' + (isActive?'#fff':'var(--text)') + ';cursor:pointer;white-space:nowrap">' + lbl + '</button>';
              }).join('') +
            '</div>';
          })()+
          '<div style="width:1px;height:24px;background:var(--border);margin:0 4px"></div>' +
          // Custom from/to month
          '<span style="font:600 10px/1 var(--font-mono);color:var(--muted)">FROM</span>' +
          '<select class="form-control" style="width:80px;font-size:12px;padding:6px 8px" onchange="dealSetFromMonth(this.value)">' + monthOpts(fromMo,'Month') + '</select>' +
          '<span style="font:600 10px/1 var(--font-mono);color:var(--muted)">TO</span>' +
          '<select class="form-control" style="width:80px;font-size:12px;padding:6px 8px" onchange="dealSetToMonth(this.value)">' + monthOpts(toMo,'Month') + '</select>' +
          (isFiltered
            ? '<button class="btn btn-ghost btn-sm" onclick="dealClearFilters()" style="color:var(--negative)">✕ Clear</button>' +
              '<span style="font:600 11px/1 var(--font-mono);color:var(--primary)">' + active.length + ' / ' + allActive.length + ' deals</span>'
            : '') +
        '</div>' +
      '</div>';
    })()+

    // Table
    '<div style="padding:0 24px 32px">' +
      '<div style="border:1px solid var(--border);border-radius:12px;overflow:hidden">' +
        '<div style="overflow-x:auto">' +
          '<div style="min-width:1400px">' +
            // Header
            '<div style="display:flex;background:var(--surface-2,var(--surface));border-bottom:2px solid var(--border)">' + headerCols + '</div>' +
            // Rows
            (rowsHtml || '<div style="padding:40px;text-align:center;color:var(--muted);font:500 13px/1 var(--font-mono)">No deals yet. Click "+ Add Deal" to get started.</div>') +
            // Totals
            (rowsHtml ? '<div style="display:flex;align-items:stretch;border-top:2px solid var(--border);background:rgba(250,204,21,0.06)">' +
              // flag spacer
              '<div style="width:36px;min-width:36px;border-right:1px solid var(--border);flex-shrink:0"></div>' +
              // TOTAL label in Month col
              '<div style="width:80px;min-width:80px;padding:10px 10px;border-right:1px solid var(--border);flex-shrink:0;display:flex;align-items:center"><span style="font:800 11px/1 var(--font-mono);color:var(--warning);letter-spacing:.5px">TOTAL</span></div>' +
              // Company col empty
              '<div style="width:200px;min-width:200px;border-right:1px solid var(--border);flex-shrink:0"></div>' +
              // Paid inc VAT
              '<div style="width:110px;min-width:110px;padding:8px 10px;border-right:1px solid var(--border);flex-shrink:0">' +
                '<div style="font:600 8px/1 var(--font-mono);color:var(--muted);letter-spacing:.6px;text-transform:uppercase;margin-bottom:5px">Paid Amount</div>' +
                '<div style="font:800 12px/1 var(--font-mono);color:var(--text)">' + fmtTotal(totalPaid) + '</div>' +
              '</div>' +
              // Deal Amount
              '<div style="width:110px;min-width:110px;padding:8px 10px;border-right:1px solid var(--border);flex-shrink:0">' +
                '<div style="font:600 8px/1 var(--font-mono);color:var(--muted);letter-spacing:.6px;text-transform:uppercase;margin-bottom:5px">Deal Amount</div>' +
                '<div style="font:800 12px/1 var(--font-mono);color:var(--text)">' + fmtTotal(totalDeal) + '</div>' +
              '</div>' +
              // VAT
              '<div style="width:90px;min-width:90px;padding:8px 10px;border-right:1px solid var(--border);flex-shrink:0">' +
                '<div style="font:600 8px/1 var(--font-mono);color:var(--muted);letter-spacing:.6px;text-transform:uppercase;margin-bottom:5px">VAT Amount</div>' +
                '<div style="font:800 12px/1 var(--font-mono);color:var(--text)">' + fmtTotal(totalVat) + '</div>' +
              '</div>' +
              // Remaining spans the rest
              '<div style="flex:1;padding:8px 16px;display:flex;align-items:center">' +
                '<div>' +
                  '<div style="font:600 8px/1 var(--font-mono);color:var(--muted);letter-spacing:.6px;text-transform:uppercase;margin-bottom:5px">Remaining</div>' +
                  '<div style="font:800 15px/1 var(--font-mono);color:' + (remaining>0?'var(--negative)':'var(--positive)') + '">' + fmtTotal(remaining) + '</div>' +
                '</div>' +
              '</div>' +
            '</div>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    // Cancelled section
    (cancelled.length ?
      '<div style="padding:0 24px 32px">' +
        '<details>' +
          '<summary style="cursor:pointer;list-style:none;display:flex;align-items:center;gap:10px;padding:12px 16px;border:1px solid var(--border);border-radius:10px;background:var(--surface);font:600 13px/1 var(--font-sans);color:var(--muted);user-select:none">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>' +
            '<span style="flex:1">Cancelled Deals</span>' +
            '<span style="font:700 11px/1 var(--font-mono);background:rgba(239,68,68,0.12);color:var(--negative);padding:3px 8px;border-radius:20px">' + cancelled.length + '</span>' +
          '</summary>' +
          '<div style="margin-top:8px;border:1px solid var(--border);border-radius:10px;overflow:hidden">' +
            '<div style="overflow-x:auto"><div style="min-width:1400px;opacity:.7">' +
              '<div style="display:flex;background:var(--surface-2,var(--surface));border-bottom:2px solid var(--border)">' + headerCols + '</div>' +
              cancelledHtml +
            '</div></div>' +
          '</div>' +
        '</details>' +
      '</div>'
    : '') ;
}

function dealSetYear(y) {
  _dealYear = y;
  if (y) { _dealFromMonth = (parseInt(y)-1) + '-11'; _dealToMonth = y + '-10'; }
  else    { _dealFromMonth = ''; _dealToMonth = ''; }
  renderDealTracker();
}
// Fiscal quarters: Q1=Nov-Jan, Q2=Feb-Apr, Q3=May-Jul, Q4=Aug-Oct
function dealSetQuarter(q) {
  const y = parseInt(_dealYear || String(new Date().getFullYear()));
  _dealYear = String(y);
  if      (q === 1) { _dealFromMonth = (y-1) + '-11'; _dealToMonth = y + '-01'; }
  else if (q === 2) { _dealFromMonth = y + '-02';      _dealToMonth = y + '-04'; }
  else if (q === 3) { _dealFromMonth = y + '-05';      _dealToMonth = y + '-07'; }
  else              { _dealFromMonth = y + '-08';      _dealToMonth = y + '-10'; }
  renderDealTracker();
}
function _activeQuarter() {
  if (!_dealFromMonth || !_dealToMonth) return 0;
  const y = parseInt(_dealYear || _dealFromMonth.slice(0,4));
  if (_dealFromMonth === (y-1)+'-11' && _dealToMonth === y+'-01') return 1;
  if (_dealFromMonth === y+'-02'     && _dealToMonth === y+'-04') return 2;
  if (_dealFromMonth === y+'-05'     && _dealToMonth === y+'-07') return 3;
  if (_dealFromMonth === y+'-08'     && _dealToMonth === y+'-10') return 4;
  return 0;
}
function dealSetFromMonth(mo) {
  const y = _dealYear || String(new Date().getFullYear());
  _dealYear      = y;
  _dealFromMonth = mo ? y + '-' + mo : '';
  renderDealTracker();
}
function dealSetToMonth(mo) {
  const y = _dealYear || String(new Date().getFullYear());
  _dealYear      = y;
  _dealToMonth   = mo ? y + '-' + mo : '';
  renderDealTracker();
}
function dealClearFilters() {
  _dealFromMonth = ''; _dealToMonth = ''; _dealSearch = ''; _dealYear = '';
  renderDealTracker();
}

function openDealModal(id) {
  const deal = id ? _dealData.find(d => d.id === id) : null;
  const v = k => deal ? (deal[k] != null ? deal[k] : '') : '';
  const fmtDateInput = d => { if (!d) return ''; return String(d).slice(0,10); };

  const colorOpts = [
    { val:'green',  label:'Green — Paid' },
    { val:'orange', label:'Orange — Partial / Incomplete' },
    { val:'red',    label:'Red — Overdue / Problem' },
    { val:'none',   label:'No colour' },
  ];
  const colorSel = colorOpts.map(o => '<option value="' + o.val + '"' + (v('row_color')===o.val||(!v('row_color')&&o.val==='green')?' selected':'') + '>' + o.label + '</option>').join('');
  const sentOpts = ['no','yes','yes-pdf'].map(o => '<option value="' + o + '"' + (v('invoice_sent')===o?' selected':'') + '>' + (o==='no'?'No':o==='yes'?'Yes':'Yes (PDF)') + '</option>').join('');
  const sigOpts  = ['no','yes'].map(o => '<option value="' + o + '"' + (v('signature_received')===o?' selected':'') + '>' + (o==='no'?'No':'Yes') + '</option>').join('');
  const statusSel = ['active','cancelled'].map(o => '<option value="' + o + '"' + ((v('status')||'active')===o?' selected':'') + '>' + (o==='active'?'Active':'Cancelled') + '</option>').join('');

  const html =
    '<div class="modal-overlay active" id="dealModal" onclick="if(event.target===this)closeDealModal()">' +
    '<div class="modal" style="max-width:680px;width:95vw">' +
    '<div class="modal-header">' +
      '<h2>' + (deal ? 'Edit Deal' : 'Add Deal') + '</h2>' +
      '<button class="modal-close" onclick="closeDealModal()">✕</button>' +
    '</div>' +
    '<div style="padding:20px;display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
      '<div class="form-group" style="grid-column:1/-1">' +
        '<label class="form-label">Company *</label>' +
        '<input id="dlCompany" class="form-control" value="' + esc(v('company')) + '" placeholder="Company name">' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Month Label</label>' +
        '<input id="dlMonth" class="form-control" value="' + esc(v('month_label')) + '" placeholder="e.g. 26-Jan">' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Row Colour</label>' +
        '<select id="dlColor" class="form-control">' + colorSel + '</select>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Status</label>' +
        '<select id="dlStatus" class="form-control">' + statusSel + '</select>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Deal Amount (£)</label>' +
        '<input id="dlDeal" class="form-control" type="number" step="0.01" value="' + esc(v('deal_amount')) + '" placeholder="0.00">' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Paid inc VAT (£)</label>' +
        '<input id="dlPaid" class="form-control" type="number" step="0.01" value="' + esc(v('paid_inc_vat')) + '" placeholder="0.00">' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Tax / VAT (£)</label>' +
        '<input id="dlVat" class="form-control" type="number" step="0.01" value="' + esc(v('tax_vat')) + '" placeholder="0.00">' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Invoice Date</label>' +
        '<input id="dlInvDate" class="form-control" type="date" value="' + esc(fmtDateInput(v('date_invoice_issued'))) + '">' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Date Paid</label>' +
        '<input id="dlPaidDate" class="form-control" type="date" value="' + esc(fmtDateInput(v('date_paid'))) + '">' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Bank / Payment via</label>' +
        '<input id="dlBank" class="form-control" value="' + esc(v('bank')) + '" placeholder="HSBC / Stripe / etc.">' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Invoice Number</label>' +
        '<input id="dlInvNum" class="form-control" value="' + esc(v('invoice_number')) + '" placeholder="LPGPCONNECTCOMLTD…">' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Invoice &amp; Agreement Sent</label>' +
        '<select id="dlSent" class="form-control">' + sentOpts + '</select>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Signature Received</label>' +
        '<select id="dlSig" class="form-control">' + sigOpts + '</select>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Initials</label>' +
        '<input id="dlInitials" class="form-control" value="' + esc(v('initials')) + '" placeholder="MR / CS">' +
      '</div>' +
      '<div class="form-group" style="grid-column:1/-1">' +
        '<label class="form-label">Notes</label>' +
        '<textarea id="dlNotes" class="form-control" rows="3" placeholder="Any notes…">' + esc(v('notes')) + '</textarea>' +
      '</div>' +
    '</div>' +
    '<div style="padding:0 20px 20px;display:flex;gap:10px;justify-content:flex-end">' +
      (deal ? '<button class="btn btn-ghost btn-sm" style="color:var(--negative)" onclick="deleteDeal(' + id + ')">Delete</button><span style="flex:1"></span>' : '') +
      '<button class="btn btn-ghost btn-sm" onclick="closeDealModal()">Cancel</button>' +
      '<button class="btn btn-primary btn-sm" onclick="saveDeal(' + (id||'null') + ')">Save</button>' +
    '</div>' +
    '</div></div>';

  let existing = document.getElementById('dealModal');
  if (existing) existing.remove();
  document.body.insertAdjacentHTML('beforeend', html);
  document.getElementById('dlCompany').focus();
}

function closeDealModal() {
  const m = document.getElementById('dealModal');
  if (m) m.remove();
}

async function saveDeal(id) {
  const company = document.getElementById('dlCompany').value.trim();
  if (!company) { showToast('Company name is required', 'error'); return; }
  const payload = {
    company,
    month_label:        document.getElementById('dlMonth').value.trim(),
    row_color:          document.getElementById('dlColor').value,
    status:             document.getElementById('dlStatus').value,
    deal_amount:        document.getElementById('dlDeal').value || null,
    paid_inc_vat:       document.getElementById('dlPaid').value || null,
    tax_vat:            document.getElementById('dlVat').value || null,
    date_invoice_issued:document.getElementById('dlInvDate').value || null,
    date_paid:          document.getElementById('dlPaidDate').value || null,
    bank:               document.getElementById('dlBank').value.trim(),
    invoice_number:     document.getElementById('dlInvNum').value.trim(),
    invoice_sent:       document.getElementById('dlSent').value,
    signature_received: document.getElementById('dlSig').value,
    initials:           document.getElementById('dlInitials').value.trim(),
    notes:              document.getElementById('dlNotes').value.trim(),
  };
  try {
    const url  = id ? '/api/deal-tracker/' + id : '/api/deal-tracker';
    const meth = id ? 'PUT' : 'POST';
    const res  = await fetch(url, { method: meth, headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');
    if (id) {
      const idx = _dealData.findIndex(d => d.id === id);
      if (idx !== -1) _dealData[idx] = data; else _dealData.push(data);
    } else {
      _dealData.push(data);
    }
    closeDealModal();
    renderDealTracker();
    showToast(id ? 'Deal updated' : 'Deal added', 'success');
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function deleteDeal(id) {
  if (!confirm('Delete this deal?')) return;
  try {
    const res = await fetch('/api/deal-tracker/' + id, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    _dealData = _dealData.filter(d => d.id !== id);
    closeDealModal();
    renderDealTracker();
    showToast('Deal deleted', 'success');
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function dealAutoColour() {
  try {
    const res  = await fetch('/api/deal-tracker/auto-colour', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    await loadDealTracker();
    showToast('Colours updated: ' + data.updated + ' rows changed', 'success');
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function toggleDealFlag(id, event) {
  event.stopPropagation();
  const deal = _dealData.find(d => d.id === id);
  if (!deal) return;
  const payload = Object.assign({}, deal, { is_flagged: !deal.is_flagged });
  try {
    const res  = await fetch('/api/deal-tracker/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    let updated;
    try { updated = JSON.parse(text); } catch(e) { throw new Error('Server returned: ' + text.slice(0,120)); }
    if (!res.ok) throw new Error(updated.error || 'Save failed');
    const idx = _dealData.findIndex(d => d.id === id);
    if (idx !== -1) _dealData[idx] = updated;
    renderDealTracker();
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

function startDealInlineEdit(id, field, event) {
  event.stopPropagation();
  const deal = _dealData.find(d => d.id === id);
  if (!deal) return;
  const cell = event.currentTarget;
  const origHtml = cell.innerHTML;

  const iBase = 'width:100%;background:transparent;border:none;border-bottom:2px solid var(--primary);outline:none;color:var(--text);padding:2px 0;font:inherit';
  const numFields  = ['paid_inc_vat','deal_amount','tax_vat'];
  const dateFields = ['date_invoice_issued','date_paid'];

  let inp;
  if (numFields.includes(field)) {
    inp = document.createElement('input');
    inp.type = 'number'; inp.step = '0.01';
    inp.value = deal[field] != null ? parseFloat(deal[field]) : '';
    inp.style.cssText = iBase + ';font:700 12px/1 var(--font-mono)';
  } else if (dateFields.includes(field)) {
    inp = document.createElement('input');
    inp.type = 'date';
    inp.value = deal[field] ? String(deal[field]).slice(0,10) : '';
    inp.style.cssText = iBase + ';font:500 11px/1 var(--font-mono)';
  } else if (field === 'invoice_sent') {
    inp = document.createElement('select');
    inp.style.cssText = iBase + ';font:600 10px/1 var(--font-mono)';
    [['no','No'],['yes','Yes'],['yes-pdf','Yes (PDF)']].forEach(([v,l]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = l;
      if (deal[field] === v) o.selected = true;
      inp.appendChild(o);
    });
  } else if (field === 'signature_received') {
    inp = document.createElement('select');
    inp.style.cssText = iBase + ';font:600 10px/1 var(--font-mono)';
    [['no','No'],['yes','Yes']].forEach(([v,l]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = l;
      if (deal[field] === v) o.selected = true;
      inp.appendChild(o);
    });
  } else {
    inp = document.createElement('input');
    inp.type = 'text';
    inp.value = deal[field] || '';
    inp.style.cssText = iBase + ';font:500 12px/1 var(--font-mono)';
  }
  inp.style.width = '100%';

  cell.innerHTML = '';
  cell.appendChild(inp);
  inp.focus();
  if (inp.select && inp.type !== 'date') inp.select();

  let done = false;
  const save = async () => {
    if (done) return; done = true;
    let val = inp.value;
    if (numFields.includes(field))  val = val === '' ? null : parseFloat(val);
    if (dateFields.includes(field)) val = val === '' ? null : val;
    const payload = Object.assign({}, deal, { [field]: val });
    try {
      const res  = await fetch('/api/deal-tracker/' + id, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
      const text = await res.text();
      let updated; try { updated = JSON.parse(text); } catch(e) { throw new Error(text.slice(0,120)); }
      if (!res.ok) throw new Error(updated.error || 'Save failed');
      const idx = _dealData.findIndex(d => d.id === id);
      if (idx !== -1) _dealData[idx] = updated;
      renderDealTracker();
    } catch(e) { showToast('Error: ' + e.message, 'error'); cell.innerHTML = origHtml; }
  };
  const cancel = () => { done = true; cell.innerHTML = origHtml; };

  if (inp.tagName === 'SELECT') {
    inp.addEventListener('change', () => { inp.blur(); });
    inp.addEventListener('blur', save);
  } else {
    inp.addEventListener('blur', save);
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); inp.blur(); }
      if (e.key === 'Escape') { cancel(); }
    });
  }
}

// ─── INVOICE DOCUMENTS ────────────────────────────────────────────────────────
async function openInvoiceModal(dealId, event) {
  if (event) event.stopPropagation();
  const deal = _dealData.find(d => d.id === dealId);
  let existing = document.getElementById('invoiceDocModal');
  if (existing) existing.remove();

  const html =
    '<div class="modal-overlay active" id="invoiceDocModal" onclick="if(event.target===this)closeInvoiceModal()">' +
    '<div class="modal" style="max-width:520px;width:95vw">' +
    '<div class="modal-header">' +
      '<div>' +
        '<h2 style="margin:0">Invoice Documents</h2>' +
        (deal && deal.invoice_number ? '<div style="font:500 11px/1 var(--font-mono);color:var(--muted);margin-top:4px">' + esc(deal.invoice_number) + '</div>' : '') +
      '</div>' +
      '<button class="modal-close" onclick="closeInvoiceModal()">✕</button>' +
    '</div>' +
    '<div style="padding:20px">' +
      '<div id="invoiceDocList"><div style="text-align:center;padding:20px;color:var(--muted);font:500 12px/1 var(--font-mono)">Loading…</div></div>' +
      '<div style="margin-top:18px;padding-top:18px;border-top:1px solid var(--border)">' +
        '<div style="font:600 11px/1 var(--font-mono);color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Upload</div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
          '<label style="flex:1;min-width:140px;display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;border:2px dashed var(--border);border-radius:8px;cursor:pointer;font:600 12px/1 var(--font-sans);color:var(--text);transition:border-color .2s" onmouseenter="this.style.borderColor=\'var(--primary)\'" onmouseleave="this.style.borderColor=\'\'">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
            'Upload PDF' +
            '<input type="file" accept=".pdf,application/pdf" style="display:none" onchange="uploadInvoiceFile(' + dealId + ',this,\'pdf\')">' +
          '</label>' +
          '<label style="flex:1;min-width:140px;display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;border:2px dashed var(--border);border-radius:8px;cursor:pointer;font:600 12px/1 var(--font-sans);color:var(--text);transition:border-color .2s" onmouseenter="this.style.borderColor=\'var(--primary)\'" onmouseleave="this.style.borderColor=\'\'">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>' +
            'Upload Word Doc' +
            '<input type="file" accept=".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style="display:none" onchange="uploadInvoiceFile(' + dealId + ',this,\'word\')">' +
          '</label>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '</div></div>';

  document.body.insertAdjacentHTML('beforeend', html);
  loadInvoiceFiles(dealId);
}

function closeInvoiceModal() {
  const m = document.getElementById('invoiceDocModal');
  if (m) m.remove();
}

async function loadInvoiceFiles(dealId) {
  const list = document.getElementById('invoiceDocList');
  if (!list) return;
  try {
    const res  = await fetch('/api/deal-tracker/' + dealId + '/invoices');
    const docs = res.ok ? await res.json() : [];
    if (!docs.length) {
      list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font:500 12px/1.5 var(--font-mono)">No documents uploaded yet.</div>';
      return;
    }
    const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b/1024).toFixed(0) + ' KB' : (b/1048576).toFixed(1) + ' MB';
    const icon = t => t === 'pdf'
      ? '<div style="width:32px;height:32px;background:rgba(239,68,68,0.12);border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px">📄</div>'
      : '<div style="width:32px;height:32px;background:rgba(59,130,246,0.12);border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px">📝</div>';
    list.innerHTML = docs.map(d =>
      '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">' +
        icon(d.file_type) +
        '<div style="flex:1;min-width:0">' +
          '<div style="font:600 12px/1 var(--font-sans);color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(d.file_name) + '</div>' +
          '<div style="font:500 10px/1 var(--font-mono);color:var(--muted);margin-top:3px">' + fmtSize(d.file_size||0) + ' · ' + d.file_type.toUpperCase() + '</div>' +
        '</div>' +
        '<button onclick="downloadInvoiceFile(' + d.id + ',\'' + esc(d.file_name) + '\',\'' + d.file_type + '\')" style="background:none;border:1px solid var(--border);border-radius:6px;padding:5px 10px;cursor:pointer;font:600 11px/1 var(--font-mono);color:var(--text)">↓ Download</button>' +
        '<button onclick="deleteInvoiceFile(' + d.id + ',' + dealId + ')" style="background:none;border:none;color:var(--dim);cursor:pointer;font-size:16px;padding:4px">×</button>' +
      '</div>'
    ).join('');
  } catch(e) {
    list.innerHTML = '<div style="color:var(--negative);font:500 12px/1 var(--font-mono);padding:10px">Failed to load: ' + esc(e.message) + '</div>';
  }
}

async function uploadInvoiceFile(dealId, input, fileType) {
  const file = (input.files||[])[0];
  if (!file) return;
  const MAX = 10 * 1024 * 1024;
  if (file.size > MAX) { showToast('File too large (max 10 MB)', 'error'); return; }
  const list = document.getElementById('invoiceDocList');
  if (list) list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font:500 12px/1 var(--font-mono)">Uploading…</div>';
  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const res = await fetch('/api/deal-tracker/' + dealId + '/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_name: file.name, file_type: fileType, file_data: base64, file_size: file.size })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    showToast('Uploaded: ' + file.name, 'success');
    loadInvoiceFiles(dealId);
  } catch(e) { showToast('Upload failed: ' + e.message, 'error'); if (list) loadInvoiceFiles(dealId); }
  input.value = '';
}

async function downloadInvoiceFile(id, fileName, fileType) {
  try {
    const res  = await fetch('/api/deal-invoices/' + id + '/download');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Download failed');
    const mimeMap = { pdf: 'application/pdf', word: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    const mime = mimeMap[fileType] || 'application/octet-stream';
    const link = document.createElement('a');
    link.href = 'data:' + mime + ';base64,' + data.file_data;
    link.download = data.file_name || fileName;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  } catch(e) { showToast('Download failed: ' + e.message, 'error'); }
}

async function deleteInvoiceFile(id, dealId) {
  if (!confirm('Delete this document?')) return;
  try {
    const res = await fetch('/api/deal-invoices/' + id, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    showToast('Document deleted', 'success');
    loadInvoiceFiles(dealId);
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

// ─── DEAL IMPORT ──────────────────────────────────────────────────────────────
function openDealImport() {
  let existing = document.getElementById('dealImportModal');
  if (existing) existing.remove();
  const html =
    '<div class="modal-overlay active" id="dealImportModal" onclick="if(event.target===this)closeDealImport()">' +
    '<div class="modal" style="max-width:560px;width:95vw">' +
    '<div class="modal-header"><h2>Import from Excel / CSV</h2><button class="modal-close" onclick="closeDealImport()">✕</button></div>' +
    '<div style="padding:20px">' +
      '<p style="font:500 13px/1.6 var(--font-sans);color:var(--muted);margin-bottom:16px">Select your Excel (.xlsx) or CSV file. Columns are matched automatically by header name.</p>' +
      '<div style="border:2px dashed var(--border);border-radius:10px;padding:36px;text-align:center;cursor:pointer;transition:border-color .2s" id="dealDropZone" onclick="document.getElementById(\'dealImportFile\').click()" ondragover="event.preventDefault();this.style.borderColor=\'var(--primary)\'" ondragleave="this.style.borderColor=\'\'" ondrop="event.preventDefault();this.style.borderColor=\'\';processDealImportFile({files:event.dataTransfer.files})">' +
        '<div style="font-size:36px;margin-bottom:8px">📂</div>' +
        '<div style="font:600 13px/1 var(--font-sans);color:var(--text)">Click to choose file or drag &amp; drop</div>' +
        '<div style="font:500 11px/1 var(--font-mono);color:var(--muted);margin-top:6px">.xlsx · .xls · .csv</div>' +
      '</div>' +
      '<input type="file" id="dealImportFile" accept=".xlsx,.xls,.csv" style="display:none" onchange="processDealImportFile(this)">' +
      '<div id="dealImportPreview" style="margin-top:16px"></div>' +
    '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

function closeDealImport() {
  const m = document.getElementById('dealImportModal');
  if (m) m.remove();
}

async function processDealImportFile(input) {
  const file = (input.files||[])[0];
  if (!file) return;
  const preview = document.getElementById('dealImportPreview');
  preview.innerHTML = '<div style="text-align:center;padding:16px;color:var(--muted);font:500 12px/1 var(--font-mono)">Parsing file…</div>';

  // Lazy-load SheetJS
  if (!window.XLSX) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = window.XLSX.read(e.target.result, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = window.XLSX.utils.sheet_to_json(ws, { raw: false, defval: '' });
      const mapped = raw.map(mapDealImportRow).filter(r => r.company && !['total','remaining'].includes((r.company+'').toLowerCase().trim()));
      showDealImportPreview(mapped);
    } catch(err) {
      preview.innerHTML = '<div class="alert alert-error">Could not parse file: ' + esc(err.message) + '</div>';
    }
  };
  reader.readAsArrayBuffer(file);
}

function mapDealImportRow(row) {
  const find = (...keys) => {
    for (const k of keys) {
      const match = Object.keys(row).find(rk => rk.toLowerCase().replace(/[^a-z0-9]/g,'') === k.toLowerCase().replace(/[^a-z0-9]/g,''));
      if (match !== undefined) return row[match];
    }
    return '';
  };
  const parseAmt = v => {
    if (v == null || v === '') return null;
    const n = parseFloat(String(v).replace(/[£$€,\s]/g,''));
    return isNaN(n) ? null : n;
  };
  const parseDate = v => {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v)?null:v.toISOString().slice(0,10);
    const s = String(v).trim();
    if (!s) return null;
    // DD/MM/YY or DD/MM/YYYY
    const m1 = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
    if (m1) {
      const [, d, mo, y] = m1;
      const year = y.length === 2 ? '20' + y : y;
      const dt = new Date(year + '-' + mo.padStart(2,'0') + '-' + d.padStart(2,'0'));
      if (!isNaN(dt)) return dt.toISOString().slice(0,10);
    }
    const dt = new Date(s);
    return isNaN(dt) ? null : dt.toISOString().slice(0,10);
  };
  const normSent = v => {
    const s = String(v||'').toLowerCase().trim();
    if (s.includes('pdf')) return 'yes-pdf';
    if (s === 'yes' || s === 'y') return 'yes';
    return 'no';
  };
  const normSig = v => {
    const s = String(v||'').toLowerCase().trim();
    return (s === 'yes' || s === 'y') ? 'yes' : 'no';
  };
  return {
    month_label:         String(find('month','month label') || ''),
    company:             String(find('company') || ''),
    paid_inc_vat:        parseAmt(find('paidincvat','paid inc vat','paid','paid inc. vat')),
    deal_amount:         parseAmt(find('deal','deal amount','dealamount')),
    tax_vat:             parseAmt(find('taxvat','tax/vat','tax vat','tax','vat')),
    date_invoice_issued: parseDate(find('dateinvoiceissued','date invoice issued','invoice date','invoicedate')),
    date_paid:           parseDate(find('datepaid','date paid','paiddate')),
    bank:                String(find('bari','bank','payment via','paymentvia','payment method') || ''),
    invoice_number:      String(find('invoicenumber','invoice number','invoice no','invoice#') || ''),
    notes:               String(find('notes','note') || ''),
    invoice_sent:        normSent(find('invoice&agreementsent','invoiceagreementsent','invoice sent','invoicesent','sent')),
    signature_received:  normSig(find('signaturereceived','signature received','signature','signed')),
    initials:            String(find('initials','initial') || ''),
    row_color:           (parseAmt(find('paidincvat','paid inc vat','paid','paid inc. vat')) ? 'green' : 'none'),
  };
}

function showDealImportPreview(rows) {
  const preview = document.getElementById('dealImportPreview');
  if (!rows.length) {
    preview.innerHTML = '<div class="alert alert-error">No valid rows found. Make sure your file has a "Company" column header.</div>';
    return;
  }
  window._dealImportRows = rows;
  const fmtA = v => v != null ? '£' + parseFloat(v).toLocaleString('en-GB',{minimumFractionDigits:2}) : '—';
  const sample = rows.slice(0,6);
  const tableRows = sample.map(r =>
    '<tr>' +
    '<td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + esc(r.month_label) + '</td>' +
    '<td style="padding:6px 8px;border-bottom:1px solid var(--border);font-weight:600">' + esc(r.company) + '</td>' +
    '<td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + fmtA(r.paid_inc_vat) + '</td>' +
    '<td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + fmtA(r.deal_amount) + '</td>' +
    '<td style="padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted)">' + esc(r.bank) + '</td>' +
    '</tr>'
  ).join('');
  preview.innerHTML =
    '<div style="margin-bottom:10px;padding:10px 14px;background:rgba(34,197,94,0.1);border-radius:8px;font:600 12px/1 var(--font-mono);color:var(--positive)">' +
      rows.length + ' rows ready to import' + (rows.length > 6 ? ' (showing first 6 below)' : '') +
    '</div>' +
    '<div style="overflow-x:auto;border-radius:8px;border:1px solid var(--border);margin-bottom:14px">' +
    '<table style="width:100%;border-collapse:collapse;font:500 11px/1 var(--font-mono)">' +
    '<thead><tr style="background:var(--surface)">' +
      '<th style="padding:8px;text-align:left;border-bottom:2px solid var(--border)">Month</th>' +
      '<th style="padding:8px;text-align:left;border-bottom:2px solid var(--border)">Company</th>' +
      '<th style="padding:8px;text-align:left;border-bottom:2px solid var(--border)">Paid</th>' +
      '<th style="padding:8px;text-align:left;border-bottom:2px solid var(--border)">Deal</th>' +
      '<th style="padding:8px;text-align:left;border-bottom:2px solid var(--border)">Bank</th>' +
    '</tr></thead>' +
    '<tbody>' + tableRows + '</tbody>' +
    '</table></div>' +
    '<div style="display:flex;gap:10px;justify-content:flex-end">' +
      '<button class="btn btn-ghost btn-sm" onclick="closeDealImport()">Cancel</button>' +
      '<button class="btn btn-primary btn-sm" onclick="confirmDealImport()">Import ' + rows.length + ' rows</button>' +
    '</div>';
}

async function confirmDealImport() {
  const rows = window._dealImportRows || [];
  if (!rows.length) return;
  const btn = document.querySelector('#dealImportModal .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Importing…'; }
  try {
    const res = await fetch('/api/deal-tracker/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deals: rows })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import failed');
    closeDealImport();
    await loadDealTracker();
    showToast('Imported ' + (data.count || rows.length) + ' deals successfully', 'success');
  } catch(e) {
    showToast('Import failed: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Import ' + rows.length + ' rows'; }
  }
}

// ─── EMPLOYEE REMINDERS ───────────────────────────────────────────────────────
async function empToggleReminder(id) {
  try {
    await fetch('/api/employee/reminders/' + id + '/done', { method: 'PATCH' });
    const res = await fetch('/api/employee/reminders');
    window._empReminders = res.ok ? await res.json() : window._empReminders;
    const card = document.getElementById('empRemindersCard');
    if (card) {
      const inner = card.querySelector('[style*="padding:4px"]');
      if (inner) inner.innerHTML = empRemindersHtmlStandalone();
    }
  } catch(e) { console.warn('Toggle reminder failed', e); }
}

async function empDeleteReminder(id) {
  try {
    await fetch('/api/employee/reminders/' + id, { method: 'DELETE' });
    const res = await fetch('/api/employee/reminders');
    window._empReminders = res.ok ? await res.json() : (window._empReminders||[]).filter(r => r.id !== id);
    const card = document.getElementById('empRemindersCard');
    if (card) {
      const inner = card.querySelector('[style*="padding:4px"]');
      if (inner) inner.innerHTML = empRemindersHtmlStandalone();
    }
  } catch(e) { console.warn('Delete reminder failed', e); }
}

async function empAddReminder() {
  const inp = document.getElementById('empReminderInput');
  const dt  = document.getElementById('empReminderDate');
  if (!inp || !inp.value.trim()) return;
  try {
    await fetch('/api/employee/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: inp.value.trim(), reminder_date: dt ? dt.value || null : null })
    });
    if (inp) inp.value = '';
    if (dt)  dt.value  = '';
    const res = await fetch('/api/employee/reminders');
    window._empReminders = res.ok ? await res.json() : window._empReminders;
    const card = document.getElementById('empRemindersCard');
    if (card) {
      const inner = card.querySelector('[style*="padding:4px"]');
      if (inner) inner.innerHTML = empRemindersHtmlStandalone();
    }
  } catch(e) { console.warn('Add reminder failed', e); }
}

function empRemindersHtmlStandalone() {
  const reminders = window._empReminders || [];
  const pending = reminders.filter(r => !r.is_done);
  const done    = reminders.filter(r => r.is_done);
  const fmtDate = d => { if (!d) return ''; const dt = new Date(d+'T12:00:00'); return dt.toLocaleDateString('en-GB',{day:'numeric',month:'short'}); };
  const itemHtml = r => {
    const isPast = r.reminder_date && r.reminder_date.slice(0,10) < new Date().toLocaleDateString('en-CA');
    return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">' +
      '<div onclick="empToggleReminder(' + r.id + ')" style="width:18px;height:18px;border:2px solid ' + (r.is_done?'var(--primary)':'var(--border)') + ';border-radius:4px;flex-shrink:0;cursor:pointer;display:flex;align-items:center;justify-content:center;background:' + (r.is_done?'var(--primary)':'transparent') + '">' +
        (r.is_done ? '<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"><polyline points="2,6 5,9 10,3"/></svg>' : '') +
      '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font:600 13px/1 var(--font-sans);color:' + (r.is_done?'var(--dim)':'var(--text)') + ';' + (r.is_done?'text-decoration:line-through':'') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(r.title) + '</div>' +
        (r.reminder_date ? '<div style="font:500 10px/1 var(--font-mono);color:' + (isPast&&!r.is_done?'var(--negative)':'var(--muted)') + ';margin-top:3px">' + fmtDate(r.reminder_date) + (isPast&&!r.is_done?' · overdue':'') + '</div>' : '') +
      '</div>' +
      '<button onclick="empDeleteReminder(' + r.id + ')" style="background:none;border:none;color:var(--dim);cursor:pointer;font-size:14px;padding:2px 4px;flex-shrink:0">×</button>' +
    '</div>';
  };
  const listHtml = pending.map(itemHtml).join('') + (done.length ? '<div style="font:600 9px/1 var(--font-mono);color:var(--dim);letter-spacing:.5px;margin:10px 0 4px">COMPLETED</div>' + done.slice(0,3).map(itemHtml).join('') : '');
  return '<div id="empRemindersList">' + (listHtml || '<div style="color:var(--muted);font:500 12px/1.5 var(--font-mono);padding:12px 0;text-align:center">No reminders yet.<br>Add one below.</div>') + '</div>' +
    '<div style="display:flex;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">' +
      '<input id="empReminderInput" class="form-control" style="flex:1;font-size:12px;padding:7px 10px" placeholder="Add a reminder..." onkeydown="if(event.keyCode===13)empAddReminder()">' +
      '<input id="empReminderDate" class="form-control" type="date" style="width:130px;font-size:12px;padding:7px 8px">' +
      '<button class="btn btn-primary btn-sm" onclick="empAddReminder()">+</button>' +
    '</div>';
}

// ─── ADMIN STAFF PORTFOLIO ────────────────────────────────────────────────────
let _adminPortfolioData = null;
let _adminPortfolioEmpFilter = '';

async function loadAdminPortfolio() {
  const page = document.getElementById('page-portfolio');
  if (!page) return;
  page.innerHTML = '<div class="skeleton" style="height:400px;border-radius:16px;margin:24px"></div>';
  try {
    const res = await fetch('/api/admin/staff-portfolio');
    _adminPortfolioData = res.ok ? await res.json() : { employees: [], events: [] };
    renderAdminPortfolioPage();
  } catch(e) {
    page.innerHTML = '<div style="padding:24px"><div class="alert alert-error">Failed to load staff portfolio: ' + e.message + '</div></div>';
  }
}

function renderAdminPortfolioPage() {
  const page = document.getElementById('page-portfolio');
  if (!page || !_adminPortfolioData) return;
  const { employees, events } = _adminPortfolioData;

  // Group events by employee
  const byEmp = {};
  employees.forEach(e => { byEmp[e.employee_id] = { emp: e, events: [] }; });
  events.forEach(ev => {
    if (byEmp[ev.employee_id]) byEmp[ev.employee_id].events.push(ev);
  });

  const filtered = _adminPortfolioEmpFilter
    ? Object.values(byEmp).filter(g => g.emp.employee_id == _adminPortfolioEmpFilter)
    : Object.values(byEmp);

  const empOptions = employees.map(e =>
    `<option value="${e.employee_id}" ${e.employee_id==_adminPortfolioEmpFilter?'selected':''}>${esc(e.name)}</option>`
  ).join('');

  const empCards = filtered.map(({ emp, events: evts }) => {
    const sorted = [...evts].sort((a,b) => {
      if (!a.event_date && !b.event_date) return 0;
      if (!a.event_date) return 1;
      if (!b.event_date) return -1;
      return new Date(b.event_date) - new Date(a.event_date);
    });

    const evtRows = sorted.map(ev => {
      const dateStr = ev.event_date ? new Date(ev.event_date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—';
      const badgeColor = ev.added_by === 'admin' ? '#f59e0b' : 'var(--positive)';
      const badgeLabel = ev.added_by === 'admin' ? 'Allocated' : 'Self-added';
      return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="flex:1;min-width:0">
          <div style="font:600 13px/1 var(--font-sans);color:var(--text)">${esc(ev.event_name)}</div>
          <div style="font:500 11px/1 var(--font-mono);color:var(--muted);margin-top:3px">${dateStr}</div>
          ${ev.notes ? `<div style="font:500 11px/1.4 var(--font-mono);color:var(--text-2);margin-top:4px">${esc(ev.notes)}</div>` : ''}
        </div>
        <span style="font:700 9px/1 var(--font-mono);color:${badgeColor};padding:3px 8px;border:1px solid ${badgeColor};border-radius:20px;flex-shrink:0">${badgeLabel}</span>
        <button class="btn btn-danger btn-sm" onclick="adminDeletePortfolioEvent(${ev.id})" style="flex-shrink:0">×</button>
      </div>`;
    }).join('');

    return `<div class="card" style="margin-bottom:16px">
      <div style="padding:16px 20px 12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border)">
        <div>
          <div style="font:700 15px/1 var(--font-sans);color:var(--text)">${esc(emp.name)}</div>
          <div style="font:500 11px/1 var(--font-mono);color:var(--muted);margin-top:4px">${esc(emp.role||'')}${emp.department?' · '+esc(emp.department):''} · ${sorted.length} event${sorted.length!==1?'s':''}</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="openAllocateEvent(${emp.employee_id}, '${esc(emp.name)}')">+ Allocate Event</button>
      </div>
      <div style="padding:4px 20px 12px">
        ${evtRows || '<div style="padding:16px 0;color:var(--muted);font:500 12px/1 var(--font-mono)">No events logged yet</div>'}
      </div>
    </div>`;
  }).join('');

  page.innerHTML = `
    <div style="padding:24px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div>
          <h2 style="font:700 20px/1 var(--font-sans);color:var(--text);margin:0">Staff Portfolio</h2>
          <div style="font:500 11px/1 var(--font-mono);color:var(--muted);margin-top:6px">${events.length} event${events.length!==1?'s':''} across ${employees.length} staff</div>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <select onchange="adminPortfolioFilter(this.value)" style="background:var(--surface-2);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:6px 12px;font:500 12px/1 var(--font-mono)">
            <option value="">All Staff</option>
            ${empOptions}
          </select>
        </div>
      </div>
      ${empCards || '<div style="text-align:center;padding:40px;color:var(--muted);font:500 13px/1 var(--font-mono)">No staff found.</div>'}
    </div>
    <!-- Allocate Event Modal -->
    <div id="allocateModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;align-items:center;justify-content:center">
      <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:16px;padding:28px;width:100%;max-width:440px;margin:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <h3 id="allocateModalTitle" style="font:700 16px/1 var(--font-sans);color:var(--text);margin:0">Allocate Event</h3>
          <button onclick="closeAllocateModal()" style="background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer;padding:0">✕</button>
        </div>
        <input type="hidden" id="allocateEmpId">
        <div class="form-group" style="margin-bottom:14px">
          <label class="form-label">Event Name *</label>
          <input id="allocEventName" class="form-control" type="text" placeholder="e.g. CFO NYC 2026">
        </div>
        <div class="form-group" style="margin-bottom:14px">
          <label class="form-label">Event Date</label>
          <input id="allocEventDate" class="form-control" type="date">
        </div>
        <div class="form-group" style="margin-bottom:20px">
          <label class="form-label">Notes (optional)</label>
          <textarea id="allocNotes" class="form-control" rows="3" placeholder="Any additional details..."></textarea>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn btn-ghost" onclick="closeAllocateModal()">Cancel</button>
          <button class="btn btn-primary" onclick="saveAllocateEvent()">Allocate</button>
        </div>
      </div>
    </div>`;
}

function renderDealsByInitials(filtered) {
  // Build summary by initials — shown in totals if any
}

async function cycleDealStatus(id, newStatus) {
  const res = await fetch(`/api/deals/${id}/row-status`, {
    method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ row_status: newStatus })
  });
  if (!res.ok) { showToast('Failed', 'error'); return; }
  const idx = dealsData.findIndex(d => d.id === id);
  if (idx !== -1) dealsData[idx].row_status = newStatus;
  renderDealsTable();
}

async function openDealModal(id, defaultStage) {
  _dealInv1 = null; _dealInv2 = null;
  document.getElementById('dealEditId').value = id || '';
  document.getElementById('dealModalTitle').textContent = id ? 'Edit Deal' : 'Add Deal';
  document.getElementById('dealInv1Preview').textContent = '';
  document.getElementById('dealInv2Preview').textContent = '';
  document.getElementById('dealInv1File').value = '';
  document.getElementById('dealInv2File').value = '';

  // Load events into select
  const sel = document.getElementById('dealEvents');
  try {
    const evRes = await fetch('/api/portfolio-events');
    const evs = await evRes.json();
    sel.innerHTML = evs.map(ev => `<option value="${ev.id}">${esc(ev.name)}${ev.event_date ? ' ('+new Date(ev.event_date).toLocaleDateString('en-GB',{month:'short',year:'numeric'})+')' : ''}</option>`).join('');
  } catch { sel.innerHTML = '<option>Failed to load events</option>'; }

  if (id) {
    const d = dealsData.find(x => x.id === id);
    if (!d) return;
    document.getElementById('dealTitle').value = d.title || d.company || '';
    document.getElementById('dealCompany').value = d.company || '';
    document.getElementById('dealInitials').value = d.initials || '';
    document.getElementById('dealStage').value = d.stage || 'Prospect';
    document.getElementById('dealCurrency').value = d.currency || 'GBP';
    document.getElementById('dealAmount').value = d.amount;
    document.getElementById('dealPaidIncVat').value = d.paid_inc_vat || '';
    document.getElementById('dealTaxVat').value = d.tax_vat || '';
    document.getElementById('dealInvoiceNumber').value = d.invoice_number || '';
    document.getElementById('dealInvoiceDate').value = d.invoice_date ? d.invoice_date.split('T')[0] : '';
    document.getElementById('dealMonth').value = d.deal_month || '';
    document.getElementById('dealInvSent').value = d.invoice_agreement_sent ? 'true' : 'false';
    document.getElementById('dealSigReceived').value = d.signature_received ? 'true' : 'false';
    document.getElementById('dealNotes').value = d.notes || '';
    const evIds = Array.isArray(d.events) ? d.events.map(e => e.event_id).filter(Boolean) : [];
    Array.from(sel.options).forEach(o => { o.selected = evIds.includes(parseInt(o.value)); });
    if (d.invoice1_name) document.getElementById('dealInv1Preview').textContent = `Current: ${d.invoice1_name}`;
    if (d.invoice2_name) document.getElementById('dealInv2Preview').textContent = `Current: ${d.invoice2_name}`;
    selectDealPayment(d.bank === 'Stripe' ? 'Stripe' : 'Bank');
  } else {
    document.getElementById('dealTitle').value = '';
    document.getElementById('dealCompany').value = '';
    document.getElementById('dealInitials').value = '';
    document.getElementById('dealStage').value = defaultStage || 'Prospect';
    document.getElementById('dealCurrency').value = 'GBP';
    document.getElementById('dealAmount').value = '';
    document.getElementById('dealPaidIncVat').value = '';
    document.getElementById('dealTaxVat').value = '';
    document.getElementById('dealInvoiceNumber').value = '';
    document.getElementById('dealInvoiceDate').value = '';
    document.getElementById('dealMonth').value = '';
    document.getElementById('dealInvSent').value = 'false';
    document.getElementById('dealSigReceived').value = 'false';
    document.getElementById('dealNotes').value = '';
    Array.from(sel.options).forEach(o => o.selected = false);
    selectDealPayment('Bank');
  }
  updateDealSplitPreview();
  openModal('dealModal');
}

function autofillDealMonth() {
  const dateVal = document.getElementById('dealInvoiceDate').value;
  const monthEl = document.getElementById('dealMonth');
  if (!dateVal || monthEl.value.trim()) return; // don't overwrite if already set
  const MONS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const yy = dateVal.slice(2, 4);
  const mo = parseInt(dateVal.slice(5, 7), 10) - 1;
  monthEl.value = `${yy} - ${MONS[mo]}`;
}

function selectDealPayment(method) {
  document.getElementById('dealBank').value = method;
  document.getElementById('dealPayBank')?.classList.toggle('active', method === 'Bank');
  document.getElementById('dealPayStripe')?.classList.toggle('active', method === 'Stripe');
}

function fillNextInvoiceNumber() {
  const el = document.getElementById('dealNextInvNum');
  if (!el) return;
  document.getElementById('dealInvoiceNumber').value = el.textContent;
}

function updateDealSplitPreview() {
  const sel = document.getElementById('dealEvents');
  const selected = Array.from(sel.selectedOptions);
  const amount = parseFloat(document.getElementById('dealAmount').value) || 0;
  const sym = { GBP:'£', USD:'$', AED:'AED ', PHP:'₱', EUR:'€' }[document.getElementById('dealCurrency')?.value] || '';
  const preview = document.getElementById('dealSplitPreview');
  if (selected.length > 1 && amount > 0) {
    const each = amount / selected.length;
    preview.textContent = `${sym}${fmt(each)} allocated to each of ${selected.length} events`;
  } else if (selected.length === 1 && amount > 0) {
    preview.textContent = `${sym}${fmt(amount)} allocated to ${selected[0].text}`;
  } else {
    preview.textContent = '';
  }
}

function dealFilePreview(n, input) {
  const file = input.files[0];
  const previewEl = document.getElementById(`dealInv${n}Preview`);
  if (!file) { previewEl.textContent = ''; return; }
  if (file.size > 8 * 1024 * 1024) { showToast('File must be under 8 MB', 'error'); input.value = ''; return; }
  previewEl.textContent = `Selected: ${file.name}`;
  const reader = new FileReader();
  reader.onload = e => {
    const base64 = e.target.result.split(',')[1];
    if (n === 1) _dealInv1 = { name: file.name, data: base64 };
    else _dealInv2 = { name: file.name, data: base64 };
  };
  reader.readAsDataURL(file);
}

async function saveDeal() {
  const id = document.getElementById('dealEditId').value;
  const company = document.getElementById('dealCompany').value.trim();
  if (!company) { showToast('Company name is required', 'error'); return; }
  const amount = parseFloat(document.getElementById('dealAmount').value);
  if (isNaN(amount) || amount < 0) { showToast('Enter a valid deal value', 'error'); return; }
  const sel = document.getElementById('dealEvents');
  const event_ids = Array.from(sel.selectedOptions).map(o => parseInt(o.value)).filter(Boolean);
  const paidIncVat = document.getElementById('dealPaidIncVat').value;
  const taxVat = document.getElementById('dealTaxVat').value;
  // Use company as title if no explicit title stored
  const existingTitle = document.getElementById('dealTitle').value.trim();
  const body = {
    title: existingTitle || company,
    company,
    contact_name: '', initials: document.getElementById('dealInitials').value.trim().toUpperCase(),
    currency: document.getElementById('dealCurrency').value,
    amount, stage: document.getElementById('dealStage').value || 'Prospect',
    paid_inc_vat: paidIncVat ? parseFloat(paidIncVat) : null,
    tax_vat: taxVat ? parseFloat(taxVat) : null,
    invoice_number: document.getElementById('dealInvoiceNumber').value.trim(),
    invoice_date: document.getElementById('dealInvoiceDate').value || null,
    deal_month: document.getElementById('dealMonth').value.trim(),
    paid_date: null,
    bank: document.getElementById('dealBank').value,
    invoice_agreement_sent: document.getElementById('dealInvSent').value === 'true',
    signature_received: document.getElementById('dealSigReceived').value === 'true',
    notes: document.getElementById('dealNotes').value.trim(),
    event_ids
  };
  if (_dealInv1) { body.invoice1_name = _dealInv1.name; body.invoice1_data = _dealInv1.data; }
  if (_dealInv2) { body.invoice2_name = _dealInv2.name; body.invoice2_data = _dealInv2.data; }

  const method = id ? 'PUT' : 'POST';
  const url = id ? `/api/deals/${id}` : '/api/deals';
  const res = await fetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if (!res.ok) { const e = await res.json(); showToast(e.error || 'Save failed', 'error'); return; }
  showToast(id ? 'Deal updated' : 'Deal added', 'success');
  closeModal('dealModal');
  loadDeals();
  loadPortfolio();
}

async function deleteDeal(id) {
  if (!confirm('Delete this deal?')) return;
  const res = await fetch(`/api/deals/${id}`, { method: 'DELETE' });
  if (!res.ok) { showToast('Delete failed', 'error'); return; }
  _selectedDealIds.delete(id);
  showToast('Deal deleted', 'success');
  loadDeals();
  loadPortfolio();
}

function toggleDealSelect(id) {
  if (_selectedDealIds.has(id)) _selectedDealIds.delete(id);
  else _selectedDealIds.add(id);
  updateDealSelectionUI();
  renderDealsTable();
}

function selectAllDeals() {
  const filtered = window._dealCurrentFiltered || [];
  const allSelected = filtered.every(d => _selectedDealIds.has(d.id));
  if (allSelected) filtered.forEach(d => _selectedDealIds.delete(d.id));
  else filtered.forEach(d => _selectedDealIds.add(d.id));
  updateDealSelectionUI();
  renderDealsTable();
}

function updateDealSelectionUI() {
  const n = _selectedDealIds.size;
  const delBtn = document.getElementById('deleteSelectedDealsBtn');
  const moveBtn = document.getElementById('moveYearDealsBtn');
  if (n > 0) {
    if (delBtn)  { delBtn.textContent = `🗑 Delete Selected (${n})`; delBtn.style.display = 'inline-flex'; }
    if (moveBtn) { moveBtn.textContent = `📅 Move to Year (${n})`;  moveBtn.style.display = 'inline-flex'; }
  } else {
    if (delBtn)  delBtn.style.display = 'none';
    if (moveBtn) moveBtn.style.display = 'none';
  }
}

async function moveDealsToYear() {
  const ids = [..._selectedDealIds];
  if (!ids.length) return;
  const yr = prompt('Move selected deals to which fiscal year? (e.g. 2026)');
  if (!yr || !/^\d{4}$/.test(yr.trim())) return;
  const res = await fetch('/api/deals/bulk-year', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, fiscal_year: parseInt(yr) })
  });
  if (!res.ok) { showToast('Move failed', 'error'); return; }
  _selectedDealIds.clear();
  updateDealSelectionUI();
  showToast(`${ids.length} deal${ids.length > 1 ? 's' : ''} moved to ${yr}`, 'success');
  loadDeals();
}

async function deleteSelectedDeals() {
  const ids = [..._selectedDealIds];
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} selected deal${ids.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
  const res = await fetch('/api/deals/bulk', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids })
  });
  if (!res.ok) { showToast('Bulk delete failed', 'error'); return; }
  _selectedDealIds.clear();
  updateDealSelectionUI();
  showToast(`${ids.length} deal${ids.length > 1 ? 's' : ''} deleted`, 'success');
  loadDeals();
  loadPortfolio();
}

// ─── DEAL CSV IMPORT ──────────────────────────────────────────────────────────

function openDealImport() {
  _importRows = [];
  document.getElementById('dealImportFile').value = '';
  document.getElementById('dealImportPreview').innerHTML = '';
  document.getElementById('dealImportBtn').disabled = true;
  openModal('dealImportModal');
}

function previewDealImport(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    _importRows = parseDealCSV(text);
    const preview = document.getElementById('dealImportPreview');
    const btn = document.getElementById('dealImportBtn');
    if (!_importRows.length) {
      preview.innerHTML = '<span style="color:var(--danger)">No valid rows found. Make sure the CSV has a Company or Title column.</span>';
      btn.disabled = true;
      return;
    }
    preview.innerHTML = `<div style="color:var(--success);margin-bottom:8px">✓ Found <strong>${_importRows.length}</strong> deals to import.</div>
      <div style="max-height:160px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;font-size:0.75rem">
        <table style="width:100%"><thead><tr style="background:var(--bg-2)">
          <th style="padding:4px 8px">Company</th><th style="padding:4px 8px">Amount</th>
          <th style="padding:4px 8px">Invoice #</th><th style="padding:4px 8px">Invoice Date</th><th style="padding:4px 8px">By</th>
        </tr></thead><tbody>
          ${_importRows.slice(0,20).map(r=>`<tr>
            <td style="padding:3px 8px">${esc(r.company||'')}</td>
            <td style="padding:3px 8px">${r.amount||'—'}</td>
            <td style="padding:3px 8px;font-size:0.7rem;font-family:monospace">${esc(r.invoice_number||'')}</td>
            <td style="padding:3px 8px">${r.invoice_date||'—'}</td>
            <td style="padding:3px 8px">${esc(r.initials||'')}</td>
          </tr>`).join('')}
          ${_importRows.length > 20 ? `<tr><td colspan="5" style="padding:4px 8px;color:var(--muted)">...and ${_importRows.length-20} more</td></tr>` : ''}
        </tbody></table>
      </div>`;
    btn.disabled = false;
  };
  reader.readAsText(file);
}

function parseDealCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  // Parse header row (handle quoted fields)
  const parseRow = row => {
    const cols = []; let cur = ''; let inQ = false;
    for (let i = 0; i < row.length; i++) {
      const c = row[i];
      if (c === '"') { inQ = !inQ; }
      else if (c === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    cols.push(cur.trim());
    return cols;
  };
  const headers = parseRow(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,''));
  // Map known column names
  const colMap = {
    company: ['company','company_name','client','client_name'],
    title: ['title','deal_title','deal','name','description'],
    amount: ['amount','deal_value','value','deal_amount','contract_value'],
    currency: ['currency','ccy'],
    paid_inc_vat: ['paid_inc_vat','paid','paid_amount','payment','paid_inc_vat_'],
    tax_vat: ['tax_vat','vat','tax','vat_amount','tax_amount'],
    invoice_number: ['invoice_number','invoice_no','invoice','invoice_num','lpgp'],
    invoice_date: ['invoice_date','date_invoice','inv_date','invoice_issued','date_invoice_issued'],
    paid_date: ['paid_date','date_paid','payment_date'],
    bank: ['bank','payment_method','method'],
    invoice_agreement_sent: ['invoice_agreement_sent','sent','agreement_sent','inv_sent'],
    signature_received: ['signature_received','signed','signature','sig'],
    initials: ['initials','by','sales','rep'],
    deal_month: ['month','deal_month','business_month','month_label'],
    notes: ['notes','note','comments','comment']
  };
  const findCol = (aliases) => {
    for (const a of aliases) {
      const idx = headers.indexOf(a);
      if (idx !== -1) return idx;
    }
    // Partial match
    for (const a of aliases) {
      const idx = headers.findIndex(h => h.includes(a) || a.includes(h));
      if (idx !== -1) return idx;
    }
    return -1;
  };
  const idxMap = {};
  for (const [field, aliases] of Object.entries(colMap)) idxMap[field] = findCol(aliases);

  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseRow(lines[i]);
    const get = field => (idxMap[field] >= 0 ? (cols[idxMap[field]] || '').trim() : '');
    const company = get('company');
    const title = get('title') || company;
    if (!company && !title) continue;
    const parseDate = s => {
      if (!s) return null;
      // Try DD/MM/YYYY or DD/MM/YY
      const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
      if (m) {
        const yr = m[3].length === 2 ? '20'+m[3] : m[3];
        return `${yr}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
      }
      // Try YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
      return null;
    };
    const parseBool = s => ['yes','true','1','y','✓','✅'].includes((s||'').toLowerCase());
    results.push({
      company, title,
      amount: get('amount').replace(/[£$€,\s]/g,'') || '0',
      currency: get('currency').toUpperCase() || 'GBP',
      paid_inc_vat: get('paid_inc_vat').replace(/[£$€,\s]/g,'') || null,
      tax_vat: get('tax_vat').replace(/[£$€,\s]/g,'') || null,
      invoice_number: get('invoice_number'),
      invoice_date: parseDate(get('invoice_date')),
      paid_date: parseDate(get('paid_date')),
      bank: get('bank'),
      invoice_agreement_sent: parseBool(get('invoice_agreement_sent')),
      signature_received: parseBool(get('signature_received')),
      initials: get('initials').toUpperCase(),
      deal_month: get('deal_month'),
      notes: get('notes')
    });
  }
  return results;
}

async function runDealImport() {
  if (!_importRows.length) return;
  const importYear = document.getElementById('dealImportYear')?.value;
  if (!importYear) { showToast('Please select a fiscal year first', 'error'); return; }
  const btn = document.getElementById('dealImportBtn');
  btn.disabled = true;
  btn.textContent = 'Importing…';
  let ok = 0, fail = 0;
  for (const row of _importRows) {
    const body = {
      title: row.title || row.company,
      company: row.company,
      contact_name: '',
      initials: row.initials || '',
      stage: 'Prospect',
      fiscal_year: parseInt(importYear),
      currency: row.currency || 'GBP',
      amount: parseFloat(row.amount) || 0,
      paid_inc_vat: row.paid_inc_vat ? parseFloat(row.paid_inc_vat) : null,
      tax_vat: row.tax_vat ? parseFloat(row.tax_vat) : null,
      invoice_number: row.invoice_number || '',
      invoice_date: row.invoice_date || null,
      paid_date: row.paid_date || null,
      bank: row.bank || '',
      invoice_agreement_sent: !!row.invoice_agreement_sent,
      signature_received: !!row.signature_received,
      deal_month: row.deal_month || '',
      notes: row.notes || '',
      event_ids: []
    };
    try {
      const res = await fetch('/api/deals', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
      if (res.ok) ok++; else fail++;
    } catch { fail++; }
  }
  btn.textContent = 'Import';
  closeModal('dealImportModal');
  showToast(`Imported ${ok} deal${ok !== 1 ? 's' : ''}${fail ? ` (${fail} failed)` : ''}`, ok > 0 ? 'success' : 'error');
  if (ok > 0) loadDeals();
}

function adminPortfolioFilter(val) {
  _adminPortfolioEmpFilter = val;
  renderAdminPortfolioPage();
}

function openAllocateEvent(empId, empName) {
  document.getElementById('allocateEmpId').value = empId;
  document.getElementById('allocateModalTitle').textContent = 'Allocate Event — ' + empName;
  document.getElementById('allocEventName').value = '';
  document.getElementById('allocEventDate').value = '';
  document.getElementById('allocNotes').value = '';
  document.getElementById('allocateModal').style.display = 'flex';
}

function closeAllocateModal() {
  document.getElementById('allocateModal').style.display = 'none';
}

async function saveAllocateEvent() {
  const empId = document.getElementById('allocateEmpId').value;
  const name  = document.getElementById('allocEventName').value.trim();
  const date  = document.getElementById('allocEventDate').value;
  const notes = document.getElementById('allocNotes').value.trim();
  if (!name) { alert('Please enter an event name'); return; }
  const res = await fetch('/api/admin/staff-portfolio', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ employee_id: parseInt(empId), event_name: name, event_date: date || null, notes })
  });
  if (res.ok) {
    closeAllocateModal();
    await loadAdminPortfolio();
  } else {
    const err = await res.json();
    alert('Error: ' + (err.error || 'Failed to allocate'));
  }
}

async function adminDeletePortfolioEvent(id) {
  if (!confirm('Remove this event from the portfolio?')) return;
  const res = await fetch('/api/admin/staff-portfolio/' + id, { method: 'DELETE' });
  if (res.ok) await loadAdminPortfolio();
}

let _portfolioEvents = [];
let _portfolioYear   = new Date().getFullYear();

async function loadEmployeePortfolio() {
  const page = document.getElementById('page-portfolio');
  if (!page) return;
  page.innerHTML = '<div class="skeleton" style="height:300px;border-radius:16px;margin:24px"></div>';
  try {
    const res = await fetch('/api/employee/portfolio');
    _portfolioEvents = res.ok ? await res.json() : [];
    renderPortfolioPage();
  } catch(e) {
    page.innerHTML = '<div style="padding:24px"><div class="alert alert-error">Failed to load portfolio: ' + e.message + '</div></div>';
  }
}

function renderPortfolioPage() {
  const page = document.getElementById('page-portfolio');
  if (!page) return;

  const eventYears = new Set(_portfolioEvents.map(e => e.event_date ? new Date(e.event_date).getFullYear() : null).filter(Boolean));
  const curYear = new Date().getFullYear();
  [2025, 2026, 2027, 2028].forEach(y => eventYears.add(y));
  const years = [...eventYears].sort((a,b) => b-a);
  if (!years.includes(_portfolioYear)) _portfolioYear = curYear;

  const filtered = _portfolioEvents.filter(e => {
    if (!e.event_date) return false;
    return new Date(e.event_date).getFullYear() === _portfolioYear;
  });
  const undated  = _portfolioYear === curYear ? _portfolioEvents.filter(e => !e.event_date) : [];

  const yearTabs = years.map(y =>
    `<button onclick="portfolioSetYear(${y})" style="padding:6px 16px;border-radius:20px;border:1px solid ${y===_portfolioYear?'var(--accent)':'var(--border)'};background:${y===_portfolioYear?'var(--accent)':'transparent'};color:${y===_portfolioYear?'#fff':'var(--muted)'};font:600 12px/1 var(--font-mono);cursor:pointer">${y}</button>`
  ).join('');

  const evtCard = (r) => {
    const dateStr = r.event_date ? new Date(r.event_date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : 'No date';
    const byAdmin = r.added_by === 'admin';
    return `<div class="card" style="margin-bottom:10px;padding:16px 20px;display:flex;align-items:center;gap:16px">
      <div style="flex:1;min-width:0">
        <div style="font:700 14px/1 var(--font-sans);color:var(--text)">${esc(r.event_name)}</div>
        <div style="font:500 11px/1.5 var(--font-mono);color:var(--muted);margin-top:4px">${dateStr}${byAdmin?' · <span style="color:#f59e0b">allocated by admin</span>':''}</div>
        ${r.notes ? `<div style="font:500 11px/1.4 var(--font-mono);color:var(--text-2);margin-top:6px;border-top:1px solid var(--border);padding-top:6px">${esc(r.notes)}</div>` : ''}
      </div>
      ${!byAdmin ? `<button class="btn btn-ghost btn-sm" onclick="deleteEmployeePortfolioEvent(${r.id})" style="color:var(--danger);flex-shrink:0">×</button>` : ''}
    </div>`;
  };

  const allCards = [...filtered, ...undated].map(evtCard).join('');

  page.innerHTML = `
    <div style="padding:24px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div>
          <h2 style="font:700 20px/1 var(--font-sans);color:var(--text);margin:0">My Portfolio</h2>
          <div style="font:500 11px/1 var(--font-mono);color:var(--muted);margin-top:6px">${_portfolioEvents.length} event${_portfolioEvents.length!==1?'s':''} total</div>
        </div>
        <button class="btn btn-primary" onclick="openAddPortfolioEvent()">+ Add Event</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px">${yearTabs}</div>
      ${allCards || `<div style="text-align:center;padding:40px 20px;color:var(--muted);font:500 12px/1.6 var(--font-mono)">No events in ${_portfolioYear}.<br>Click <strong>+ Add Event</strong> to log one.</div>`}
    </div>
    <!-- Add Event Modal -->
    <div id="portfolioModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;align-items:center;justify-content:center">
      <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:16px;padding:28px;width:100%;max-width:440px;margin:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <h3 style="font:700 16px/1 var(--font-sans);color:var(--text);margin:0">Add Portfolio Event</h3>
          <button onclick="closePortfolioModal()" style="background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer;padding:0">✕</button>
        </div>
        <div class="form-group" style="margin-bottom:14px">
          <label class="form-label">Event Name *</label>
          <input id="pfEventName" class="form-control" type="text" placeholder="e.g. CFO NYC 2026">
        </div>
        <div class="form-group" style="margin-bottom:14px">
          <label class="form-label">Event Date</label>
          <input id="pfEventDate" class="form-control" type="date">
        </div>
        <div class="form-group" style="margin-bottom:20px">
          <label class="form-label">Notes (optional)</label>
          <textarea id="pfNotes" class="form-control" rows="3" placeholder="Any additional details..."></textarea>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn btn-ghost" onclick="closePortfolioModal()">Cancel</button>
          <button class="btn btn-primary" onclick="savePortfolioEvent()">Save Event</button>
        </div>
      </div>
    </div>`;
}

function portfolioSetYear(y) {
  _portfolioYear = y;
  renderPortfolioPage();
}

function openAddPortfolioEvent() {
  document.getElementById('pfEventName').value = '';
  document.getElementById('pfEventDate').value = '';
  document.getElementById('pfNotes').value = '';
  document.getElementById('portfolioModal').style.display = 'flex';
}

function closePortfolioModal() {
  document.getElementById('portfolioModal').style.display = 'none';
}

async function savePortfolioEvent() {
  const name  = document.getElementById('pfEventName').value.trim();
  const date  = document.getElementById('pfEventDate').value;
  const notes = document.getElementById('pfNotes').value.trim();
  if (!name) { alert('Please enter an event name'); return; }
  const res = await fetch('/api/employee/portfolio', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ event_name: name, event_date: date || null, notes })
  });
  if (res.ok) {
    closePortfolioModal();
    await loadEmployeePortfolio();
  } else {
    const err = await res.json();
    alert('Error: ' + (err.error || 'Failed to save'));
  }
}

async function deleteEmployeePortfolioEvent(id) {
  if (!confirm('Remove this event from your portfolio?')) return;
  const res = await fetch('/api/employee/portfolio/' + id, { method: 'DELETE' });
  if (res.ok) await loadEmployeePortfolio();
}

let empCalYear  = new Date().getFullYear();
let empCalMonth = new Date().getMonth() + 1;

async function loadEmployeeCalendar() {
  const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  // Build page scaffold once
  let container = document.getElementById('empCalContainer');
  if (!container) {
    const page = document.getElementById('page-calendar');
    if (!page) return;
    page.innerHTML =
      '<div class="page-head">' +
        '<div><h1>My Calendar</h1><div class="sub">// Your days off &amp; team bookings</div></div>' +
        '<button class="btn btn-primary" onclick="openEmpDayOffModal()">+ Request Day Off</button>' +
      '</div>' +
      '<div id="empCalContainer"></div>';
    container = document.getElementById('empCalContainer');
  }

  // Ensure day-off modal lives at body level (correct overlay behaviour)
  if (!document.getElementById('empDayOffModal')) {
    const m = document.createElement('div');
    m.className = 'modal-overlay';
    m.id = 'empDayOffModal';
    m.innerHTML =
      '<div class="modal" style="max-width:380px">' +
        '<div class="modal-header"><span class="modal-title">Request Day Off</span>' +
          '<button class="modal-close" onclick="closeModal(\'empDayOffModal\')">×</button></div>' +
        '<div style="padding:20px;display:flex;flex-direction:column;gap:14px">' +
          '<div class="form-group"><label>Date</label><input type="date" id="empDayOffDate"></div>' +
          '<div class="form-group"><label>Type</label>' +
            '<select id="empDayOffType"><option value="1">Full Day</option><option value="0.5">Half Day</option></select></div>' +
          '<div class="form-group"><label>Reason <span style="color:var(--muted);font-weight:400">(required)</span></label><textarea id="empDayOffReason" class="form-control" rows="3" placeholder="e.g. Medical appointment, personal matter..."></textarea></div>' +
          '<button class="btn btn-primary" style="width:100%" onclick="submitEmpDayOff()">Submit Request</button>' +
        '</div>' +
      '</div>';
    m.addEventListener('click', function(e) { if (e.target === m) closeModal('empDayOffModal'); });
    document.body.appendChild(m);
  }

  container.innerHTML = '<div class="skeleton" style="height:400px;border-radius:12px"></div>';

  try {
    const [requestsRes, teamRes, upcomingRes] = await Promise.all([
      fetch('/api/employee/day-off-requests'),
      fetch('/api/calendar?year=' + empCalYear + '&month=' + empCalMonth),
      fetch('/api/employee/upcoming?days=60')
    ]);
    const allRequests = requestsRes.ok ? await requestsRes.json() : [];
    const teamRecords = teamRes.ok    ? await teamRes.json()     : [];
    const upcomingData = upcomingRes.ok ? await upcomingRes.json() : { dayOffs: [], reminders: [] };
    const upcomingDayOffs = upcomingData.dayOffs || [];
    const upcomingReminders = upcomingData.reminders || [];

    // Own requests this month: date → request
    const monthPrefix = empCalYear + '-' + String(empCalMonth).padStart(2,'0');
    const myRequests  = allRequests.filter(r => (r.request_date||'').startsWith(monthPrefix));
    const myMap = {};
    myRequests.forEach(r => { myMap[r.request_date.slice(0,10)] = r; });

    // Team days off: date → [names] (exclude self)
    const teamMap = {};
    const myEmpId = String((window.currentUser || {}).employee_id || '');
    (Array.isArray(teamRecords) ? teamRecords : []).forEach(r => {
      if (String(r.employee_id) === myEmpId) return;
      if (!(parseFloat(r.is_day_off) > 0)) return;
      const d = (r.record_date || '').slice(0,10);
      if (!d.startsWith(monthPrefix)) return;
      if (!teamMap[d]) teamMap[d] = [];
      const name = r.employee_name || r.name || ('Emp#' + r.employee_id);
      const firstName = name.split(' ')[0];
      if (!teamMap[d].find(n => n.full === name)) teamMap[d].push({ full: name, first: firstName });
    });

    // Store data for clickable day detail popup
    window._empCalMyMap   = myMap;
    window._empCalTeamMap = teamMap;
    window._empCalTodayStr = new Date().toLocaleDateString('en-CA');
    const todayStr = window._empCalTodayStr;

    // Calendar grid
    const firstDay    = new Date(empCalYear, empCalMonth - 1, 1);
    const daysInMonth = new Date(empCalYear, empCalMonth, 0).getDate();
    let startDow = firstDay.getDay();
    startDow = startDow === 0 ? 6 : startDow - 1;

    let gridHtml = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:8px">';
    DAYS.forEach(day => { gridHtml += '<div style="text-align:center;font:700 11px/1 var(--font-mono);color:var(--text-2);padding:6px 0;letter-spacing:.5px">' + day + '</div>'; });
    gridHtml += '</div><div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px">';

    for (let i = 0; i < startDow; i++) gridHtml += '<div></div>';

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = empCalYear + '-' + String(empCalMonth).padStart(2,'0') + '-' + String(d).padStart(2,'0');
      const rec    = myMap[dateStr];
      const team   = teamMap[dateStr] || [];
      const isToday = dateStr === todayStr;
      const isPast  = dateStr < todayStr;
      const status  = rec ? rec.status : null;

      let border = isToday ? '2px solid var(--primary)' : '1px solid var(--border)';
      let bg = isPast ? 'var(--surface)' : 'var(--surface-2)';
      let statusBar = '';
      if (status === 'pending')  { bg = '#d9770618'; border = '1px solid #fb923c55'; statusBar = '<div style="font:700 9px/1 var(--font-mono);color:#fb923c;margin-top:4px;letter-spacing:.5px;width:100%;text-align:center">PENDING</div>'; }
      else if (status === 'approved') { bg = '#6ee7d418'; border = '1px solid #6ee7b455'; statusBar = '<div style="font:700 9px/1 var(--font-mono);color:var(--primary);margin-top:4px;letter-spacing:.5px;width:100%;text-align:center">MY DAY OFF</div>'; }
      else if (status === 'declined') { bg = '#ef444412'; border = '1px solid #f8717155'; statusBar = '<div style="font:700 9px/1 var(--font-mono);color:#f87171;margin-top:4px;letter-spacing:.5px;width:100%;text-align:center">DECLINED</div>'; }

      let teamHtml = '';
      if (team.length) {
        teamHtml = team.slice(0, 3).map(n => {
          const label = n.first || n;
          return '<div style="font:600 9px/1.3 var(--font-mono);background:#7c3aed30;color:#c4b5fd;border-radius:4px;padding:2px 5px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%">' + esc(label) + '</div>';
        }).join('');
        if (team.length > 3) teamHtml += '<div style="font:600 9px/1 var(--font-mono);color:var(--muted);margin-top:2px">+' + (team.length-3) + ' more</div>';
      }

      gridHtml +=
        '<div class="emp-cal-day" style="background:' + bg + ';border:' + border + ';border-radius:8px;padding:8px 6px 6px;min-height:72px;cursor:pointer;display:flex;flex-direction:column;align-items:center"'
        + ' onclick="empDayClick(\'' + dateStr + '\')">' +
          '<div style="font:' + (isToday?'800':'700') + ' 15px/1 var(--font-mono);color:' + (isToday?'var(--primary)':isPast?'var(--dim)':'var(--text)') + ';width:100%;text-align:center">' + d + '</div>' +
          statusBar + teamHtml +
        '</div>';
    }
    gridHtml += '</div>' +
      '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;font:500 11px/1 var(--font-mono);color:var(--muted)">' +
        '<span><span style="display:inline-block;width:10px;height:10px;background:#d9770618;border:1px solid #fb923c55;border-radius:3px;margin-right:4px;vertical-align:middle"></span>Pending</span>' +
        '<span><span style="display:inline-block;width:10px;height:10px;background:#6ee7d418;border:1px solid #6ee7b455;border-radius:3px;margin-right:4px;vertical-align:middle"></span>My day off</span>' +
        '<span><span style="display:inline-block;width:10px;height:10px;background:#7c3aed30;border-radius:3px;margin-right:4px;vertical-align:middle"></span>Team off</span>' +
      '</div>';

    // Upcoming panel: team day-offs + staff-visible reminders
    const MONS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

    const dayOffItems = upcomingDayOffs.slice(0, 8).map(r => {
      const rd = new Date(r.date);
      const label = parseFloat(r.is_day_off) === 0.5 ? 'Half day' : 'Day off';
      return '<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);align-items:center">' +
        '<div style="width:36px;min-width:36px;text-align:center;background:#7c3aed22;border:1px solid #7c3aed44;border-radius:7px;padding:5px 0">' +
          '<div style="font:800 13px/1 var(--font-mono);color:#a78bfa">' + rd.getUTCDate() + '</div>' +
          '<div style="font:600 9px/1 var(--font-mono);color:#a78bfa;margin-top:3px">' + MONS[rd.getUTCMonth()] + '</div>' +
        '</div>' +
        '<div style="flex:1"><div style="font:600 12px/1 var(--font-sans);color:var(--text)">' + esc(r.employee_name) + '</div>' +
          '<div style="font:600 10px/1 var(--font-mono);color:var(--muted);margin-top:3px">' + label.toUpperCase() + '</div></div>' +
      '</div>';
    }).join('');

    const remItems = upcomingReminders.slice(0, 5).map(r => {
      const rd = new Date(r.virtual_date);
      return '<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);align-items:center">' +
        '<div style="width:36px;min-width:36px;text-align:center;background:#1a1f2e;border:1px solid var(--border);border-radius:7px;padding:5px 0">' +
          '<div style="font:800 13px/1 var(--font-mono);color:var(--text)">' + rd.getUTCDate() + '</div>' +
          '<div style="font:600 9px/1 var(--font-mono);color:var(--muted);margin-top:3px">' + MONS[rd.getUTCMonth()] + '</div>' +
        '</div>' +
        '<div style="flex:1"><div style="font:600 12px/1 var(--font-sans);color:var(--text)">' + esc(r.title) + '</div>' +
          '<div style="font:600 10px/1 var(--font-mono);color:var(--muted);margin-top:3px">' + (r.category||'').toUpperCase() + '</div></div>' +
      '</div>';
    }).join('');

    const remHtml = dayOffItems + remItems;

    container.innerHTML =
      '<div style="display:flex;gap:12px;align-items:center;margin-bottom:16px">' +
        '<button class="btn btn-ghost" onclick="empCalPrev()">‹ Prev</button>' +
        '<div style="flex:1;text-align:center;font:700 16px/1 var(--font-sans);color:var(--text)">' + MONTHS_FULL[empCalMonth-1] + ' ' + empCalYear + '</div>' +
        '<button class="btn btn-ghost" onclick="empCalNext()">Next ›</button>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:3fr 2fr;gap:16px">' +
        '<div class="card">' +
          '<div class="card-header"><span class="card-title">Team Calendar</span>' +
            '<span style="font:700 11px/1 var(--font-mono);color:var(--muted)">' + myRequests.length + ' request' + (myRequests.length!==1?'s':'') + ' this month</span></div>' +
          '<div style="padding:16px">' + gridHtml + '</div>' +
          '<div style="padding:0 16px 12px;font:500 11px/1 var(--font-mono);color:var(--muted)">Click any date to see details or request a day off</div>' +
        '</div>' +
        '<div class="card"><div class="card-header"><span class="card-title">What\'s Coming Up</span><span style="font:700 11px/1 var(--font-mono);color:var(--muted)">NEXT 60D</span></div>' +
          '<div style="padding:4px 16px 12px">' + (remHtml || '<div style="color:var(--muted);font-size:0.82rem;padding:12px 0">No upcoming team events or days off</div>') + '</div>' +
        '</div>' +
      '</div>';

  } catch(e) {
    container.innerHTML = '<div class="alert alert-error">Failed to load calendar: ' + e.message + '</div>';
  }
}

function empDayClick(dateStr) {
  const myMap   = window._empCalMyMap || {};
  const teamMap = window._empCalTeamMap || {};
  const todayStr = window._empCalTodayStr || new Date().toLocaleDateString('en-CA');
  const rec   = myMap[dateStr];
  const team  = teamMap[dateStr] || [];
  const isPast = dateStr < todayStr;
  const status = rec ? rec.status : null;

  // Format date nicely
  const dt = new Date(dateStr + 'T12:00:00');
  const dateLabel = dt.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

  // Build modal content
  let body = '';

  // My status section
  if (rec) {
    const statusColor = status === 'approved' ? 'var(--primary)' : status === 'pending' ? '#fb923c' : '#f87171';
    const statusLabel = status === 'approved' ? 'Day off approved' : status === 'pending' ? 'Request pending' : 'Request declined';
    const typeLabel = parseFloat(rec.is_day_off) === 0.5 ? 'Half day' : 'Full day';
    body += '<div style="background:' + (status==='approved'?'#6ee7d410':status==='pending'?'#d9770610':'#ef444410') + ';border:1px solid ' + statusColor + '33;border-radius:8px;padding:12px 14px;margin-bottom:14px">' +
      '<div style="font:700 11px/1 var(--font-mono);color:' + statusColor + ';letter-spacing:.5px;margin-bottom:6px">YOUR REQUEST</div>' +
      '<div style="font:600 13px/1 var(--font-sans);color:var(--text)">' + statusLabel + ' · ' + typeLabel + '</div>' +
      (rec.reason ? '<div style="font:500 11px/1.4 var(--font-sans);color:var(--muted);margin-top:6px">Reason: ' + esc(rec.reason) + '</div>' : '') +
      (status === 'declined' && rec.decline_reason ? '<div style="font:500 11px/1.4 var(--font-sans);color:#f87171;margin-top:6px">Declined: ' + esc(rec.decline_reason) + '</div>' : '') +
    '</div>';
  }

  // Team members off
  if (team.length) {
    body += '<div style="font:700 11px/1 var(--font-mono);color:var(--muted);letter-spacing:.5px;margin-bottom:8px">TEAM DAYS OFF</div>';
    body += team.map(n => {
      const name = n.full || n;
      const initials = name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">' +
        '<div style="width:32px;height:32px;border-radius:50%;background:#7c3aed33;color:#c4b5fd;font:700 12px/32px var(--font-mono);text-align:center;flex-shrink:0">' + initials + '</div>' +
        '<div style="font:600 13px/1 var(--font-sans);color:var(--text)">' + esc(name) + '</div>' +
      '</div>';
    }).join('');
    body += '<div style="height:8px"></div>';
  }

  // Actions
  let actions = '';
  if (!isPast && !rec) {
    actions = `<button class="btn btn-primary" style="width:100%;margin-top:4px" onclick="closeEmpDayModal();openEmpDayOffModalDate('${dateStr}')">+ Request Day Off</button>`;
  } else if (status === 'pending') {
    actions = `<button class="btn btn-danger" style="width:100%;margin-top:4px" onclick="closeEmpDayModal();cancelEmpDayOff('${dateStr}')">Cancel My Request</button>`;
  }

  if (!rec && !team.length) {
    body = '<div style="text-align:center;padding:20px 0;color:var(--muted);font:500 13px/1.5 var(--font-mono)">Nothing booked on this day yet.</div>';
  }

  // Show modal
  let modal = document.getElementById('empDayDetailModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'empDayDetailModal';
    modal.className = 'modal-overlay';
    modal.addEventListener('click', e => { if (e.target === modal) closeEmpDayModal(); });
    document.body.appendChild(modal);
  }
  modal.innerHTML =
    '<div class="modal" style="max-width:400px">' +
      '<div class="modal-header">' +
        '<div>' +
          '<div style="font:700 15px/1 var(--font-sans);color:var(--text)">' + dateLabel + '</div>' +
        '</div>' +
        '<button class="modal-close" onclick="closeEmpDayModal()">×</button>' +
      '</div>' +
      '<div style="padding:20px">' + body + actions + '</div>' +
    '</div>';
  modal.style.display = 'flex';
}

function closeEmpDayModal() {
  const m = document.getElementById('empDayDetailModal');
  if (m) m.style.display = 'none';
}

function empCalPrev() { empCalMonth--; if (empCalMonth < 1) { empCalMonth = 12; empCalYear--; } loadEmployeeCalendar(); }
function empCalNext() { empCalMonth++; if (empCalMonth > 12) { empCalMonth = 1; empCalYear++; } loadEmployeeCalendar(); }

function showEmpDeclineReason(reason) {
  const existing = document.getElementById('empDeclineReasonModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'empDeclineReasonModal';
  modal.className = 'modal-overlay';
  modal.innerHTML =
    '<div class="modal" style="max-width:360px">' +
      '<div class="modal-header"><span class="modal-title" style="color:var(--negative)">✕ Request Declined</span>' +
        '<button class="modal-close" onclick="document.getElementById(\'empDeclineReasonModal\').remove()">×</button></div>' +
      '<div style="padding:20px">' +
        '<div style="font:500 11px/1 var(--font-mono);color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">Reason</div>' +
        '<div style="font:500 14px/1.5 var(--font-sans);color:var(--text)">' + esc(reason) + '</div>' +
      '</div>' +
      '<div style="padding:0 20px 16px">' +
        '<button class="btn btn-ghost btn-sm" style="width:100%" onclick="document.getElementById(\'empDeclineReasonModal\').remove()">Close</button>' +
      '</div>' +
    '</div>';
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

function openEmpDayOffModal() {
  document.getElementById('empDayOffDate').value = new Date().toISOString().slice(0,10);
  document.getElementById('empDayOffReason').value = '';
  openModal('empDayOffModal');
}
function openEmpDayOffModalDate(date) {
  document.getElementById('empDayOffDate').value = date;
  document.getElementById('empDayOffReason').value = '';
  openModal('empDayOffModal');
}

async function submitEmpDayOff() {
  const date = document.getElementById('empDayOffDate').value;
  const is_day_off = document.getElementById('empDayOffType').value;
  const reason = (document.getElementById('empDayOffReason').value || '').trim();
  if (!date) return showToast('Please select a date', 'error');
  if (!reason) return showToast('Please add a reason for your request', 'error');
  const res = await fetch('/api/employee/day-off', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ date, is_day_off, reason }) });
  const data = await res.json();
  if (res.ok) { closeModal('empDayOffModal'); showToast('Day off submitted!', 'success'); loadEmployeeCalendar(); }
  else showToast(data.error || 'Failed', 'error');
}

async function cancelEmpDayOff(date) {
  if (!await showConfirm('Cancel your pending day off request for ' + date + '?')) return;
  const res = await fetch('/api/employee/day-off/' + date, { method:'DELETE' });
  if (res.ok) { showToast('Request cancelled', 'success'); loadEmployeeCalendar(); }
  else showToast('Failed to cancel', 'error');
}

function openSetPinModal(empId, empName) {
  // simple prompt approach
  const pin = prompt('Set portal PIN for ' + empName + ' (min 4 characters):');
  if (!pin || pin.length < 4) { showToast('PIN must be at least 4 characters', 'error'); return; }
  fetch('/api/employees/' + empId + '/portal-pin', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin })
  }).then(r => r.json()).then(d => {
    if (d.success) showToast('Portal PIN set for ' + empName, 'success');
    else showToast(d.error || 'Failed', 'error');
  });
}

// ─── EVENT KIT ────────────────────────────────────────────────────────────────

let _ekKit = {};
let _ekEmails = [];

async function loadEventKitPage() {
  const isEmployee = currentUser?.role === 'employee';
  document.getElementById('ekAdminView').classList.toggle('hidden', isEmployee);
  document.getElementById('ekEmployeeView').classList.toggle('hidden', !isEmployee);
  if (isEmployee) { await loadEmployeeKits(); return; }
  try {
    const res = await fetch('/api/portfolio-events');
    const evs = await res.json();
    const sel = document.getElementById('ekEventSel');
    const cur = sel.value;
    sel.innerHTML = '<option value="">— Select Event —</option>' +
      evs.map(e => `<option value="${e.id}"${String(e.id)===cur?' selected':''}>${esc(e.name)}${e.event_date?' ('+e.event_date.slice(0,10)+')':''}</option>`).join('');
    const staffRes = await fetch('/api/employees/all');
    const staff = await staffRes.json();
    const ep = document.getElementById('ekEmpPicker');
    ep.innerHTML = '<option value="">Pick from staff…</option>' +
      staff.filter(s => s.email).map(s => `<option value="${esc(s.email)}">${esc(s.name)} (${esc(s.email)})</option>`).join('');
    await renderKitsList();
    if (cur) loadEventKit();
  } catch(e) { showToast('Failed to load events', 'error'); }
}

async function renderKitsList() {
  const res = await fetch('/api/event-kits');
  if (!res.ok) return;
  const kits = await res.json();
  const el = document.getElementById('ekKitsList');
  if (!kits.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;text-align:center;padding:20px">No kits yet. Select an event above to create one.</div>';
    return;
  }
  el.innerHTML = '<div style="font:700 13px/1 var(--font-sans);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:12px">Existing Kits</div>' +
    kits.map(k => {
      const materials = ['brochure','banner','roundtable','presentation','backdrop','name_badges']
        .filter(t => k[t+'_url'] || k[t+'_file']).length;
      return `<div class="card" style="padding:14px 18px;margin-bottom:8px;display:flex;align-items:center;gap:14px;cursor:pointer" onclick="document.getElementById('ekEventSel').value='${k.event_id}';loadEventKit()">
        <div style="flex:1;min-width:0">
          <div style="font:600 14px/1 var(--font-sans)">${esc(k.event_name)}</div>
          <div style="font-size:0.75rem;color:var(--muted);margin-top:3px">${k.event_date?k.event_date.slice(0,10):''}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${k.agenda_file ? '<span class="ek-badge ek-badge--agenda">📋 Agenda</span>' : ''}
          ${materials > 0 ? `<span class="ek-badge ek-badge--mat">🎨 ${materials} material${materials!==1?'s':''}</span>` : ''}
          <span class="ek-badge ek-badge--access">👥 ${k.access_emails.length} recipient${k.access_emails.length!==1?'s':''}</span>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();document.getElementById('ekEventSel').value='${k.event_id}';loadEventKit()">Edit</button>
      </div>`;
    }).join('');
}

const EK_MATERIAL_TYPES = [
  { key:'brochure',     label:'Brochure',       accept:'.pdf,.png,.jpg' },
  { key:'banner',       label:'Banner',          accept:'.pdf,.png,.jpg' },
  { key:'roundtable',   label:'Roundtable Card', accept:'.pdf,.png,.jpg' },
  { key:'presentation', label:'Presentation',    accept:'.pdf,.pptx,.ppt' },
  { key:'backdrop',     label:'Backdrop',        accept:'.pdf,.png,.jpg' },
  { key:'name_badges',  label:'Name Badges',     accept:'.pdf,.png,.jpg' },
];

async function loadEventKit() {
  const sel = document.getElementById('ekEventSel');
  const eid = sel.value;
  const editor = document.getElementById('ekKitEditor');
  if (!eid) { editor.classList.add('hidden'); return; }
  editor.classList.remove('hidden');
  document.getElementById('ekMaterialsList').innerHTML = EK_MATERIAL_TYPES.map(m => `
    <div class="ek-material-row" data-type="${m.key}">
      <span class="ek-type-label">${m.label}</span>
      <input type="text" id="ekUrl-${m.key}" placeholder="Canva / URL (optional)" class="ek-url-input" style="flex:1;min-width:0">
      <span class="ek-or">or</span>
      <span class="ek-file-area">
        <span id="ekFile-${m.key}" class="ek-file-name">No file</span>
        <input type="file" id="ekFileInput-${m.key}" accept="${m.accept}" onchange="ekHandleFile('${m.key}',this)" style="display:none">
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('ekFileInput-${m.key}').click()">Upload</button>
        <button class="btn btn-ghost btn-sm ek-clear-btn hidden" id="ekClear-${m.key}" onclick="ekClearFile('${m.key}')">✕</button>
      </span>
    </div>`).join('');
  _ekKit = {}; _ekEmails = [];
  try {
    const res = await fetch(`/api/event-kits/${eid}`);
    const kit = await res.json();
    if (kit) {
      _ekKit = kit;
      _ekEmails = Array.isArray(kit.access_emails) ? [...kit.access_emails] : [];
      EK_MATERIAL_TYPES.forEach(m => {
        const urlEl = document.getElementById(`ekUrl-${m.key}`);
        if (urlEl) urlEl.value = kit[m.key+'_url'] || '';
        if (kit[m.key+'_file']) {
          document.getElementById(`ekFile-${m.key}`).textContent = kit[m.key+'_file'];
          document.getElementById(`ekClear-${m.key}`)?.classList.remove('hidden');
        }
      });
    }
  } catch {}
  renderEkAccessTags();
  document.getElementById('ekSaveStatus').textContent = '';
}

function ekHandleFile(type, input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { showToast('File too large (max 10 MB)', 'error'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    _ekKit[type+'_data'] = e.target.result.split(',')[1];
    _ekKit[type+'_file'] = file.name;
    document.getElementById(`ekFile-${type}`).textContent = file.name;
    document.getElementById(`ekClear-${type}`)?.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function ekClearFile(type) {
  _ekKit[type+'_data'] = ''; _ekKit[type+'_file'] = '';
  document.getElementById(`ekFile-${type}`).textContent = 'No file';
  document.getElementById(`ekClear-${type}`)?.classList.add('hidden');
  const inp = document.getElementById(`ekFileInput-${type}`);
  if (inp) inp.value = '';
}

function renderEkAccessTags() {
  const el = document.getElementById('ekAccessTags');
  if (!el) return;
  el.innerHTML = _ekEmails.map(e =>
    `<span class="ek-tag">${esc(e)}<button onclick="ekRemoveEmail('${esc(e)}')" style="background:none;border:none;cursor:pointer;margin-left:4px;color:var(--muted);font-size:11px">✕</button></span>`
  ).join('');
}

function ekRemoveEmail(email) { _ekEmails = _ekEmails.filter(e => e !== email); renderEkAccessTags(); }
function ekEmailKeydown(event) { if (event.key === 'Enter') { event.preventDefault(); ekAddEmailFromInput(); } }

function ekAddEmailFromInput() {
  const inp = document.getElementById('ekEmailInput');
  const val = (inp.value || '').trim().toLowerCase();
  if (!val) return;
  if (!val.includes('@')) { showToast('Enter a valid email', 'error'); return; }
  if (!_ekEmails.includes(val)) { _ekEmails.push(val); renderEkAccessTags(); }
  inp.value = '';
}

function ekPickEmployee(sel) {
  const email = sel.value;
  if (!email) return;
  if (!_ekEmails.includes(email)) { _ekEmails.push(email); renderEkAccessTags(); }
  sel.value = '';
}

async function saveEventKit() {
  const eid = document.getElementById('ekEventSel').value;
  if (!eid) { showToast('Select an event first', 'error'); return; }
  const body = { access_emails: _ekEmails };
  EK_MATERIAL_TYPES.map(m => m.key).forEach(type => {
    const urlEl = document.getElementById(`ekUrl-${type}`);
    body[type+'_url'] = urlEl ? urlEl.value.trim() : '';
    body[type+'_file'] = _ekKit[type+'_file'] || '';
    body[type+'_data'] = _ekKit[type+'_data'] || '';
  });
  const status = document.getElementById('ekSaveStatus');
  status.textContent = 'Saving…';
  const res = await fetch(`/api/event-kits/${eid}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) { showToast('Save failed', 'error'); status.textContent = ''; return; }
  showToast('Kit saved', 'success');
  status.textContent = '✓ Saved';
  renderKitsList();
}

async function loadEmployeeKitPage() {
  document.getElementById('ekAdminView').classList.add('hidden');
  const empView = document.getElementById('ekEmployeeView');
  empView.classList.remove('hidden');
  empView.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;padding:20px">Loading…</div>';
  try {
    const res = await fetch('/api/portfolio-events');
    const events = await res.json();
    if (!events.length) {
      empView.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;text-align:center;padding:40px">No events found.</div>';
      return;
    }
    empView.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:20px">
        <select id="ekEmpEventSel" class="deal-select" style="min-width:220px" onchange="loadEmployeeKitEditor()">
          <option value="">— Select Event —</option>
          ${events.map(e => `<option value="${e.id}">${esc(e.name)}${e.event_date?' ('+e.event_date.slice(0,10)+')':''}</option>`).join('')}
        </select>
      </div>
      <div id="ekEmpEditor"></div>`;
  } catch { empView.innerHTML = '<div style="color:var(--danger)">Failed to load events.</div>'; }
}

async function loadEmployeeKitEditor() {
  const eid = document.getElementById('ekEmpEventSel').value;
  const el = document.getElementById('ekEmpEditor');
  if (!eid) { el.innerHTML = ''; return; }
  el.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;padding:12px 0">Loading…</div>';
  try {
    const res = await fetch(`/api/event-kits/${eid}`);
    const kit = res.ok ? await res.json() : {};
    const hasFile = !!(kit && kit.agenda_file);
    el.innerHTML = `<div class="card" style="padding:24px">
      <div style="font:700 13px/1 var(--font-sans);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:16px">📋 My Agenda</div>
      <div class="ek-material-row">
        <span class="ek-type-label">Agenda</span>
        <span class="ek-file-area">
          ${hasFile
            ? `<a class="btn btn-ghost btn-sm" href="/api/event-kits/${eid}/file/agenda" target="_blank">📄 ${esc(kit.agenda_file)}</a>
               <button class="btn btn-ghost btn-sm" onclick="ekEmpClearAgenda('${eid}')">✕ Remove</button>`
            : `<span class="ek-file-name" id="ekEmpFile-${eid}">No file</span>
               <input type="file" id="ekEmpFileInput-${eid}" accept=".pdf,.pptx,.ppt,.png,.jpg" onchange="ekEmpUploadAgenda('${eid}',this)" style="display:none">
               <button class="btn btn-ghost btn-sm" onclick="document.getElementById('ekEmpFileInput-${eid}').click()">Upload PDF</button>`
          }
        </span>
      </div>
    </div>`;
  } catch { el.innerHTML = '<div style="color:var(--danger)">Failed to load.</div>'; }
}

async function loadEmployeeKits() {}

function renderEmployeeKitCard(k) {
  const eid = k.event_id;
  const matRows = EK_MATERIAL_TYPES.map(m => {
    const url = k[m.key+'_url'], file = k[m.key+'_file'];
    if (!url && !file) return '';
    return `<div class="ek-emp-mat-row"><span class="ek-emp-mat-label">${m.label}</span><div style="display:flex;gap:6px;flex-wrap:wrap">
      ${url ? `<a class="btn btn-ghost btn-sm" href="${esc(url)}" target="_blank" rel="noopener">🔗 Open Link</a>` : ''}
      ${file ? `<a class="btn btn-ghost btn-sm" href="/api/event-kits/${eid}/file/${m.key}" target="_blank">📄 ${esc(file)}</a>` : ''}
    </div></div>`;
  }).filter(Boolean).join('');

  const agendaSection = `<div class="card" style="padding:16px;margin-bottom:12px;background:var(--bg-2)">
    <div style="font:700 11px/1 var(--font-sans);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:12px">📋 My Agenda</div>
    <div class="ek-material-row">
      <span class="ek-type-label">Agenda</span>
      <span class="ek-file-area">
        ${k.agenda_file
          ? `<a class="btn btn-ghost btn-sm" href="/api/event-kits/${eid}/file/agenda" target="_blank">📄 ${esc(k.agenda_file)}</a>
             <button class="btn btn-ghost btn-sm" onclick="ekEmpClearAgenda('${eid}')">✕ Remove</button>`
          : `<span class="ek-file-name" id="ekEmpFile-${eid}">No file</span>
             <input type="file" id="ekEmpFileInput-${eid}" accept=".pdf,.pptx,.ppt,.png,.jpg" onchange="ekEmpUploadAgenda('${eid}',this)" style="display:none">
             <button class="btn btn-ghost btn-sm" onclick="document.getElementById('ekEmpFileInput-${eid}').click()">Upload PDF</button>`
        }
      </span>
    </div>
  </div>`;

  return `<div class="card" style="padding:20px;margin-bottom:16px">
    <div style="font:700 16px/1 var(--font-sans);margin-bottom:4px">${esc(k.event_name)}</div>
    <div style="font-size:0.75rem;color:var(--muted);margin-bottom:16px">${k.event_date?k.event_date.slice(0,10):''}</div>
    ${agendaSection}
    ${matRows ? `<div style="font:700 11px/1 var(--font-sans);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:10px;margin-top:4px">🎨 Materials</div>${matRows}` : ''}
  </div>`;
}

async function ekEmpUploadAgenda(eid, input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { showToast('File too large (max 10MB)', 'error'); input.value = ''; return; }
  const label = document.getElementById('ekEmpFile-' + eid);
  if (label) label.textContent = 'Uploading…';
  const reader = new FileReader();
  reader.onload = async ev => {
    const res = await fetch(`/api/event-kits/${eid}/agenda`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agenda_file: file.name, agenda_data: ev.target.result })
    });
    if (res.ok) { showToast('Agenda uploaded — admins have been notified', 'success'); await loadEmployeeKitEditor(); }
    else { showToast('Upload failed', 'error'); if (label) label.textContent = 'No file'; }
  };
  reader.readAsDataURL(file);
}

async function ekEmpClearAgenda(eid) {
  if (!await showConfirm('Remove your agenda?')) return;
  const res = await fetch(`/api/event-kits/${eid}/agenda`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agenda_file: '', agenda_data: '' })
  });
  if (res.ok) { showToast('Agenda removed', 'success'); await loadEmployeeKitEditor(); }
  else showToast('Failed to remove', 'error');
}
