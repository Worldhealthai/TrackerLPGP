// ─── STATE ───────────────────────────────────────────────────────────────────
let currentUser = null;
let employees = [];
let allEmployeesData = [];
let currentAdjRecord = null;

const SHIFT_MINS = 480;
const ALLOWED_BREAK = 40;
const MONTHS = ['','January','February','March','April','May','June',
                'July','August','September','October','November','December'];

function currencySymbol(c) { return c === 'AED' ? 'AED ' : '£'; }
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

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const res = await fetch('/api/me');
  if (!res.ok) { window.location.href = '/login.html'; return; }
  currentUser = await res.json();

  const initials = currentUser.username.slice(0,2).toUpperCase();
  document.getElementById('userLabel').innerHTML = `<div class="sidebar-user-pill"><div class="sidebar-user-avatar">${esc(initials)}</div><span class="sidebar-user-name">${esc(currentUser.username)}</span><span class="sidebar-user-role">${esc(currentUser.role)}</span></div>`;
  document.getElementById('todayDate').textContent = formatDate(today());

  if (currentUser.role === 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
  }
  if (currentUser.role === 'admin' || currentUser.role === 'manager') {
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
  document.getElementById('hamburgerBtn').addEventListener('click', toggleMobileNav);
  document.getElementById('navOverlay').addEventListener('click', closeMobileNav);

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  await loadEmployees();
  loadDashboard();

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

// ─── NAVIGATION ──────────────────────────────────────────────────────────────
function navigate(page) {
  // Salary section is admin-only
  if (page === 'salary' && currentUser?.role !== 'admin') return;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.bottom-nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
  document.querySelector(`.bottom-nav-item[data-page="${page}"]`)?.classList.add('active');
  const titles = { dashboard:'Dashboard', tracking:'Daily Tracking', salary:'Salary Tracker', employees:'Employees', reports:'Reports', calendar:'Calendar', admins:'Admin Users', hotels:'Hotel Expenses', subscriptions:'Subscriptions', portfolio:'Portfolio', deals:'Deal Tracker' };
  document.getElementById('pageTitle').textContent = titles[page] || page;
  if (page === 'employees') loadEmpTable();
  if (page === 'admins') loadAdmins();
  if (page === 'calendar') loadCalendar();
  if (page === 'salary') { loadSalaryPage(); renderSalaryReminderPanel(); }
  if (page === 'hotels') loadHotelExpenses();
  if (page === 'subscriptions') loadSubscriptions();
  if (page === 'portfolio') loadPortfolio();
  if (page === 'deals') loadDeals();
}

// ─── EMPLOYEES ───────────────────────────────────────────────────────────────
async function loadEmployees() {
  const res = await fetch('/api/employees');
  employees = await res.json();
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
  renderEmpTable();
}

function filterEmpTable() {
  renderEmpTable();
}

function renderEmpTable() {
  const search = (document.getElementById('empSearch')?.value || '').trim().toLowerCase();
  const list = search
    ? allEmployeesData.filter(e => (e.name || '').toLowerCase().includes(search))
    : allEmployeesData;
  const tbody = document.getElementById('empTable');
  tbody.innerHTML = '';
  if (!list.length) {
    const msg = search ? 'No employees match your search.' : 'No employees yet.';
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="icon">👥</div><div>${msg}</div></div></td></tr>`;
    return;
  }
  list.forEach(emp => {
    const typeLabel  = emp.employment_type === 'self_employed' ? 'Self-Employed' : 'Payroll';
    const typeBadge  = emp.employment_type === 'self_employed' ? 'badge-yellow' : 'badge-blue';
    const terminated = !emp.active && emp.termination_date;
    const statusBadge = emp.active ? 'badge-green' : (terminated ? 'badge-red' : 'badge-grey');
    const statusLabel = emp.active ? 'Active' : (terminated ? `Terminated ${emp.termination_date.slice(0,10)}` : 'Inactive');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="font-weight:700;color:var(--text)">${esc(emp.name)}</div>
        ${emp.email ? `<div style="font-size:0.74rem;color:var(--muted);margin-top:2px">${esc(emp.email)}</div>` : ''}
      </td>
      <td>
        ${emp.department ? `<div style="font-weight:600;font-size:0.83rem">${esc(emp.department)}</div>` : ''}
        ${emp.job_title  ? `<div style="font-size:0.76rem;color:var(--muted)">${esc(emp.job_title)}</div>` : (!emp.department ? '<span style="color:var(--muted)">—</span>' : '')}
      </td>
      <td><span class="badge ${typeBadge}">${typeLabel}</span></td>
      <td>${emp.annual_salary > 0 ? fmtMoney(emp.annual_salary, emp.currency) + '/yr' : '—'}</td>
      <td>${emp.start_date ? emp.start_date.slice(0,10) : '<span style="color:var(--muted)">—</span>'}</td>
      <td>${emp.contract_end_date ? (() => {
        const today = new Date().toISOString().slice(0,10);
        const cls = emp.contract_end_date < today ? 'badge-red' : (emp.contract_end_date <= new Date(Date.now()+30*864e5).toISOString().slice(0,10) ? 'badge-yellow' : 'badge-grey');
        return `<span class="badge ${cls}">${emp.contract_end_date.slice(0,10)}</span>`;
      })() : '<span style="color:var(--muted)">Permanent</span>'}</td>
      <td><span class="badge ${statusBadge}" style="white-space:normal">${esc(statusLabel)}</span></td>
      <td style="text-align:right">
        <button class="btn btn-ghost btn-sm" onclick='openEmpModal(${JSON.stringify(emp)})'>Edit</button>
        ${emp.active
          ? `<button class="btn btn-danger btn-sm" onclick="openTerminateModal(${emp.id},'${esc(emp.name)}')">Terminate</button>`
          : `<button class="btn btn-ghost btn-sm" onclick="reactivateEmployee(${emp.id})">Reactivate</button>`}
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

async function reactivateEmployee(id) {
  if (!await showConfirm('Reactivate this employee? This clears the termination date.')) return;
  await fetch(`/api/employees/${id}/reactivate`, { method: 'POST' });
  await loadEmployees();
  loadEmpTable();
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
async function loadDashboard() {
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

  const [summaryRes, salaryRes, upcomingRes, expiringRes, allEmpRes, hotelRes, dealsRes, evtRevRes] = await Promise.all([
    fetch(`/api/summary?from=${year}-01-01&to=${year}-12-31`),
    fetch(`/api/salary-overview?year=${year}`),
    fetch(`/api/calendar-reminders/upcoming?days=7`),
    fetch(`/api/contracts/expiring?days=60`),
    fetch(`/api/employees/all`),
    fetch(`/api/hotel-expenses`),
    fetch(`/api/deals`),
    fetch(`/api/deals/revenue-by-event`)
  ]);

  const summary       = summaryRes.ok   ? await summaryRes.json()   : [];
  const salaryData    = salaryRes.ok    ? await salaryRes.json()    : [];
  const upcoming      = upcomingRes.ok  ? await upcomingRes.json()  : [];
  const expiring      = expiringRes.ok  ? await expiringRes.json()  : [];
  const allEmps       = allEmpRes.ok    ? await allEmpRes.json()    : [];
  const dashDeals     = dealsRes.ok     ? await dealsRes.json()     : [];
  const hotelData     = hotelRes.ok     ? await hotelRes.json()     : [];
  const evtRevData    = evtRevRes.ok    ? await evtRevRes.json()    : [];

  const activeEmps    = allEmps.filter(e => e.active);
  const unpaidCount   = getUnpaidThisMonth(salaryData, year, month).length;
  updateSalaryBadge(unpaidCount);

  const totalHeadcount  = activeEmps.length;
  const payrollCount    = activeEmps.filter(e => e.employment_type === 'payroll').length;
  const seCount         = activeEmps.filter(e => e.employment_type === 'self_employed').length;

  // Total salary remaining to pay this year — GBP + AED converted, max(0) per employee
  const DASH_AED_TO_GBP = 1 / 4.67;
  const totalGBPRemaining = salaryData
    .filter(e => !e.is_terminated)
    .reduce((a, e) => {
      const r = Math.max(0, parseFloat(e.net_remaining) || 0);
      const c = e.currency || 'GBP';
      return a + (c === 'AED' ? r * DASH_AED_TO_GBP : c === 'GBP' ? r : 0);
    }, 0);

  // Hotel fees remaining (unpaid + partial rows: paid_amount vs cost where parseable)
  const hotelUnpaidCount = hotelData.filter(h => h.status !== 'paid').length;
  const hotelPaidTotal   = hotelData.reduce((a, h) => a + (parseFloat(h.paid_amount) || 0), 0);

  document.getElementById('dashStats').innerHTML = `
    <div class="dash-bento">
      <div class="dash-hero-card">
        <div class="dash-hero-glow"></div>
        <div class="dash-hero-label">Active Headcount</div>
        <div class="dash-hero-value">${totalHeadcount}</div>
        <div class="dash-hero-pills">
          <span class="dash-hero-pill dash-hero-pill--blue">${payrollCount} Payroll</span>
          <span class="dash-hero-pill dash-hero-pill--amber">${seCount} Self-Emp</span>
        </div>
        <div class="dash-hero-footer">Total workforce · ${year}</div>
      </div>
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
        <div class="dash-mini-card ${unpaidCount > 0 ? 'dash-mini--alert' : 'dash-mini--green'}" style="cursor:pointer" onclick="navigate('salary')" title="Go to salary page">
          <div class="dash-mini-icon">${unpaidCount > 0 ? '🔔' : '✅'}</div>
          <div class="dash-mini-body">
            <div class="dash-mini-label">Unpaid This Month</div>
            <div class="dash-mini-value">${unpaidCount}</div>
            <div class="dash-mini-sub">${unpaidCount > 0 ? 'Action required →' : 'All paid up'}</div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Revenue Intelligence + contract expiry panel
  renderRevenueIntelPanel(dashDeals, expiring, evtRevData);

  // Headcount by department
  renderHeadcountPanel(activeEmps);

  // Upcoming reminders widget
  renderUpcomingWidget(upcoming);

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
}

function renderRevenueIntelPanel(deals, expiring, evtRevData) {
  const el = document.getElementById('contractExpiryPanel');
  if (!el) return;

  // Overall metrics from all deals
  const totalRev   = deals.reduce((a,d) => a + (parseFloat(d.amount)||0), 0);
  const totalPaid  = deals.reduce((a,d) => a + (parseFloat(d.paid_inc_vat)||0), 0);
  const totalOut   = Math.max(0, totalRev - totalPaid);
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
    const amt    = parseFloat(ev.total_amount) || 0;
    const paid   = parseFloat(ev.total_paid) || 0;
    const out    = Math.max(0, amt - paid);
    const pct    = amt > 0 ? Math.min(100, Math.round(paid / amt * 100)) : 0;
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

    return `<div class="ri-evt-card" onclick="riFilterEvent(${ev.event_id},'${esc(ev.event_name).replace(/'/g,"\\'")}')">
      <div class="ri-evt-hd">
        <span class="ri-evt-name">${esc(ev.event_name)}</span>
        ${evtDate ? `<span class="ri-evt-date">${evtDate}</span>` : ''}
      </div>
      <div class="ri-evt-stats">
        <span class="ri-evt-stat"><span style="color:rgba(255,255,255,0.45);font-size:0.7rem">Total</span><br><strong>£${fmtK(amt)}</strong></span>
        <span class="ri-evt-stat"><span style="color:#22c55e;font-size:0.7rem">Collected</span><br><strong style="color:#22c55e">£${fmtK(paid)}</strong></span>
        <span class="ri-evt-stat"><span style="color:#f59e0b;font-size:0.7rem">Outstanding</span><br><strong style="color:#f59e0b">£${fmtK(out)}</strong></span>
      </div>
      <div class="ri-evt-bar-wrap"><div class="ri-evt-bar" style="width:0%" data-pct="${pct}"></div></div>
      <div class="ri-evt-foot">
        <span class="ri-evt-dots">${dotHtml}</span>
        <span class="ri-evt-counts">
          <span style="color:#22c55e">${paidC}✓</span>
          ${partC > 0 ? `<span style="color:#f59e0b"> ${partC}~</span>` : ''}
          <span style="color:#6b7280"> ${unpC}✗</span>
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
            <div class="ri-metric-label">Collected</div>
            <div class="ri-metric-val ri-green">£${fmtK(totalPaid)}</div>
          </div>
          <div class="ri-metric">
            <div class="ri-metric-label">Outstanding</div>
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
      ${eventsHtml ? `
      <div class="ri-evt-section">
        <div class="ri-evt-section-title">Events Breakdown</div>
        <div class="ri-evt-list">${eventsHtml}</div>
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

function renderHeadcountPanel(activeEmps) {
  const el = document.getElementById('headcountPanel');
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
          <div style="font-size:0.78rem;opacity:0.85;background:rgba(255,255,255,0.5);border-radius:6px;padding:6px 10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
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
async function loadReport() {
  const from = document.getElementById('repFrom').value;
  const to   = document.getElementById('repTo').value;
  const empId = document.getElementById('repEmp').value;
  const container = document.getElementById('reportContent');

  if (!from || !to) return showToast('Please select a date range', 'info');

  container.innerHTML = `<div class="empty-state"><div class="icon">⏳</div><div>Generating report…</div></div>`;

  try {
    const params = new URLSearchParams({ from, to });
    const summaryRes = await fetch('/api/summary?' + params);
    if (!summaryRes.ok) {
      const err = await summaryRes.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${summaryRes.status}`);
    }
    const summary = await summaryRes.json();
    if (!Array.isArray(summary)) throw new Error(summary.error || 'Unexpected response from server');

    const filtered = empId ? summary.filter(e => e.employee_id === parseInt(empId)) : summary;

    if (!filtered.length) {
      container.innerHTML = `<div class="empty-state"><div class="icon">📋</div><div>No records found for the selected range.</div></div>`;
      return;
    }

    const grandTotal   = filtered.reduce((a, b) => a + (b.total_deduction || 0), 0);
    const grandTimeDeduct = filtered.reduce((a, b) => a + (b.total_time_deduction || 0), 0);
    const grandDayDeduct  = filtered.reduce((a, b) => a + (b.excess_day_deduction || 0), 0);

    let html = `
      <div class="card" style="margin-bottom:20px">
        <div class="card-header"><span class="card-title">Report: ${from} → ${to}</span></div>
        <div class="stats-grid">
          <div class="stat-card blue"><div class="stat-label">Employees</div><div class="stat-value">${filtered.length}</div></div>
          <div class="stat-card yellow"><div class="stat-label">Time Deductions</div><div class="stat-value">£${grandTimeDeduct.toFixed(2)}</div></div>
          <div class="stat-card yellow"><div class="stat-label">Day-Off Deductions</div><div class="stat-value">£${grandDayDeduct.toFixed(2)}</div></div>
          <div class="stat-card red"><div class="stat-label">Total Deductions</div><div class="stat-value">£${grandTotal.toFixed(2)}</div></div>
        </div>
      </div>`;

    for (const emp of filtered) {
      const typeLabel  = emp.employment_type === 'self_employed' ? 'Self-Employed (5 days/yr)' : 'Payroll (20 days/yr)';
      const typeBadge  = emp.employment_type === 'self_employed' ? 'badge-yellow' : 'badge-blue';
      const annualSal  = parseFloat(emp.annual_salary) || 0;
      const totalPaid  = parseFloat(emp.total_paid_year) || 0;
      const remaining  = parseFloat(emp.salary_remaining) || 0;
      const excessDeduct = parseFloat(emp.excess_day_deduction) || 0;

      const recRes = await fetch(`/api/records/${emp.employee_id}?from=${from}&to=${to}`);
      if (!recRes.ok) continue;
      const records = await recRes.json();

      html += `
        <div class="card" style="margin-bottom:16px">
          <div class="card-header">
            <div>
              <span class="card-title">${esc(emp.name)}</span>
              <span class="badge ${typeBadge}" style="margin-left:8px">${typeLabel}</span>
            </div>
            ${annualSal > 0 ? `<div style="font-size:0.82rem;color:var(--muted);text-align:right">
              Salary: £${annualSal.toLocaleString('en-GB',{minimumFractionDigits:2})} &nbsp;·&nbsp;
              Paid: £${totalPaid.toLocaleString('en-GB',{minimumFractionDigits:2})} &nbsp;·&nbsp;
              <strong>Remaining: £${remaining.toLocaleString('en-GB',{minimumFractionDigits:2})}</strong>
            </div>` : ''}
          </div>
          <div style="margin-bottom:14px;display:flex;gap:16px;flex-wrap:wrap;font-size:0.86rem">
            <span>Days off this year: <strong>${emp.year_days_off} / ${emp.allowance_days}</strong></span>
            ${emp.excess_days > 0
              ? `<span class="text-danger fw-bold">${emp.excess_days} excess = £${excessDeduct.toFixed(2)} deduction</span>`
              : '<span class="text-success">Within allowance ✓</span>'}
            <span>Time deductions: <strong>£${(emp.total_time_deduction||0).toFixed(2)}</strong></span>
            <span class="text-danger fw-bold">Total: £${(emp.total_deduction||0).toFixed(2)}</span>
          </div>`;

      if (records.length) {
        html += `<div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Break</th><th>Phone</th><th>Wasted</th><th>Late</th><th>Day Off</th><th>Adj</th><th>Mins</th><th>Amount</th><th>Notes</th></tr></thead>
          <tbody>`;
        records.forEach(r => {
          const adjSign    = r.manual_adj_minutes > 0 ? '+' : '';
          const dayOffLabel = r.is_day_off === 1 ? '<span class="badge badge-red">Full</span>'
                            : r.is_day_off === 0.5 ? '<span class="badge badge-yellow">Half</span>' : '—';
          html += `<tr${r.is_day_off > 0 ? ' class="day-off-row"' : ''}>
            <td><strong>${r.record_date}</strong></td>
            <td>${r.break_minutes}m${Math.max(0,r.break_minutes-ALLOWED_BREAK)>0?` <span class="badge badge-red">+${Math.max(0,r.break_minutes-ALLOWED_BREAK)}m</span>`:''}</td>
            <td>${r.phone_minutes>0?r.phone_minutes+'m':'—'}</td>
            <td>${r.wasted_minutes>0?r.wasted_minutes+'m':'—'}</td>
            <td>${r.late_minutes>0?r.late_minutes+'m':'—'}</td>
            <td>${dayOffLabel}</td>
            <td>${r.manual_adj_minutes!==0?`${adjSign}${r.manual_adj_minutes}m`:'—'}</td>
            <td><strong>${r.total_deductible_minutes}m</strong></td>
            <td class="${(r.total_deduction||0)>0?'text-danger fw-bold':''}">£${(r.total_deduction||0).toFixed(2)}</td>
            <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.notes||'')||'—'}</td>
          </tr>`;
        });
        html += `</tbody></table></div>`;
      } else {
        html += `<div style="color:var(--muted);font-size:0.85rem;padding:8px 0">No daily records in this period.</div>`;
      }
      html += `</div>`;
    }

    container.innerHTML = html;

  } catch (e) {
    container.innerHTML = `<div class="alert alert-error">Failed to generate report: ${esc(e.message)}</div>`;
  }
}

// ─── ADMINS ──────────────────────────────────────────────────────────────────
async function loadAdmins() {
  const res = await fetch('/api/admins');
  if (!res.ok) return;
  const admins = await res.json();
  const tbody = document.getElementById('adminTable');
  tbody.innerHTML = '';
  admins.forEach(a => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${esc(a.username)}</strong></td>
      <td><span class="badge ${a.role==='admin'?'badge-blue':'badge-grey'}">${a.role}</span></td>
      <td>${a.created_at.slice(0,10)}</td>
      <td style="text-align:right">
        <button class="btn btn-ghost btn-sm" onclick="resetPw(${a.id})">Reset PW</button>
        <button class="btn btn-danger btn-sm" onclick="deleteAdmin(${a.id})">Remove</button>
      </td>`;
    tbody.appendChild(tr);
  });
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
    // AED → GBP approximate rate (shown clearly to user)
    const AED_TO_GBP = 1 / 4.67;

    const groupCards = groups.map(g => {
      const s        = currencySymbol(g.currency);
      const tTarget  = g.rows.reduce((a, b) => a + (parseFloat(b.salary_target ?? b.annual_salary) || 0), 0);
      const tPaid    = g.rows.reduce((a, b) => a + (parseFloat(b.total_paid)    || 0), 0);
      const tDeduct  = g.rows.reduce((a, b) => a + (parseFloat(b.excess_deduction) || 0) + (parseFloat(b.total_office_deductions) || 0), 0);
      const tRemain  = g.rows.reduce((a, b) => a + (parseFloat(b.net_remaining) || 0), 0);
      const typeLabel = groups.length > 1 ? `${TYPE_LABEL[g.type]} · ${g.currency}` : TYPE_LABEL[g.type];
      const empName   = g.rows.length === 1 ? g.rows[0].name : null;
      const header    = empName ? `${empName} · ${typeLabel}` : typeLabel;
      const remainClass = tRemain < 0 ? 'overpaid' : tRemain === 0 ? 'clear' : '';
      const paidPct   = tTarget > 0 ? Math.min(100, Math.round(tPaid / tTarget * 100)) : 0;
      const isPayroll = g.type === 'payroll';
      const accentClass = isPayroll ? 'payroll' : 'self-employed';
      const icon = isPayroll ? '💼' : '🧾';
      const aedConversion = g.currency === 'AED' && tRemain > 0
        ? `<div class="soc-conversion">≈ £${(tRemain * AED_TO_GBP).toLocaleString('en-GB',{maximumFractionDigits:0})} at 4.67 AED/GBP</div>`
        : '';
      return `
        <div class="salary-overview-card ${accentClass}">
          <div class="soc-accent-bar"></div>
          <div class="soc-header">
            <span class="soc-icon">${icon}</span>
            <div class="soc-header-text">
              <div class="soc-title">${header}</div>
              <div class="soc-subtitle">${g.rows.length} employee${g.rows.length !== 1 ? 's' : ''}</div>
            </div>
            <div class="soc-pct-badge">${paidPct}%</div>
          </div>
          <div class="soc-hero">
            <div class="soc-hero-block">
              <div class="soc-hero-label">Annual Target</div>
              <div class="soc-hero-val soc-col-target">${s}${fmtK(tTarget)}</div>
            </div>
            <div class="soc-hero-divider"></div>
            <div class="soc-hero-block">
              <div class="soc-hero-label">Paid So Far</div>
              <div class="soc-hero-val soc-col-paid">${s}${fmtK(tPaid)}</div>
            </div>
          </div>
          <div class="soc-progress-wrap">
            <div class="soc-progress-bar ${accentClass}" style="width:${paidPct}%"></div>
          </div>
          <div class="soc-footer">
            ${tDeduct > 0 ? `<div class="soc-footer-item"><span class="soc-footer-label">Deductions</span><span class="soc-footer-val soc-col-deduct">−${s}${fmtK(tDeduct)}</span></div>` : ''}
            <div class="soc-footer-item soc-footer-item--outstanding">
              <span class="soc-footer-label">Outstanding</span>
              <span class="soc-footer-val soc-col-outstanding ${remainClass}">${tRemain < 0 ? 'Overpaid ' : ''}${tRemain < 0 ? '' : ''}${s}${fmtK(Math.abs(tRemain))}</span>
            </div>
          </div>
          ${aedConversion}
        </div>`;
    });

    // Grand total card — all currencies converted to GBP, with full breakdown
    const allActive = activeRows; // alias for clarity
    const gtTarget  = allActive.reduce((s, e) => {
      const t = parseFloat(e.salary_target ?? e.annual_salary) || 0;
      const c = e.currency || 'GBP';
      return s + (c === 'AED' ? t * AED_TO_GBP : c === 'GBP' ? t : 0);
    }, 0);
    const gtPaid    = allActive.reduce((s, e) => {
      const p = parseFloat(e.total_paid) || 0;
      const c = e.currency || 'GBP';
      return s + (c === 'AED' ? p * AED_TO_GBP : c === 'GBP' ? p : 0);
    }, 0);
    const gtDayOff  = allActive.reduce((s, e) => {
      const d = parseFloat(e.excess_deduction) || 0;
      const c = e.currency || 'GBP';
      return s + (c === 'AED' ? d * AED_TO_GBP : c === 'GBP' ? d : 0);
    }, 0);
    const gtOffice  = allActive.reduce((s, e) => {
      const d = parseFloat(e.total_office_deductions) || 0;
      const c = e.currency || 'GBP';
      return s + (c === 'AED' ? d * AED_TO_GBP : c === 'GBP' ? d : 0);
    }, 0);
    const gtDeduct  = gtDayOff + gtOffice;
    // Remaining = max(0) per employee so overpaid don't cancel owed amounts
    const gtRemain  = allActive.reduce((s, e) => {
      const r = parseFloat(e.net_remaining) || 0;
      const c = e.currency || 'GBP';
      const converted = c === 'AED' ? r * AED_TO_GBP : c === 'GBP' ? r : 0;
      return s + Math.max(0, converted);
    }, 0);
    const hasMultiCurrency = groups.some(g => g.currency !== 'GBP');
    const gtPaidPct = gtTarget > 0 ? Math.min(100, Math.round(gtPaid / gtTarget * 100)) : 0;
    const gbpCard = `
      <div class="salary-overview-card soc-gbp-total">
        <div class="soc-accent-bar"></div>
        <div class="soc-header">
          <span class="soc-icon">📊</span>
          <div class="soc-header-text">
            <div class="soc-title">Total · GBP${hasMultiCurrency ? ' <span style="font-size:0.68rem;font-weight:500;opacity:0.6">AED @ 4.67</span>' : ''}</div>
            <div class="soc-subtitle">All groups combined</div>
          </div>
          <div class="soc-pct-badge soc-pct-badge--green">${gtPaidPct}%</div>
        </div>
        <div class="soc-hero">
          <div class="soc-hero-block">
            <div class="soc-hero-label">Annual Target</div>
            <div class="soc-hero-val soc-col-target">£${fmtK(gtTarget)}</div>
          </div>
          <div class="soc-hero-divider"></div>
          <div class="soc-hero-block">
            <div class="soc-hero-label">Paid So Far</div>
            <div class="soc-hero-val soc-col-paid">£${fmtK(gtPaid)}</div>
          </div>
        </div>
        <div class="soc-progress-wrap">
          <div class="soc-progress-bar soc-gbp-total" style="width:${gtPaidPct}%"></div>
        </div>
        <div class="soc-footer">
          ${gtDayOff > 0 ? `<div class="soc-footer-item"><span class="soc-footer-label">Day-Off Deductions</span><span class="soc-footer-val soc-col-deduct">−£${fmtK(gtDayOff)}</span></div>` : ''}
          ${gtOffice > 0 ? `<div class="soc-footer-item"><span class="soc-footer-label">Office Deductions</span><span class="soc-footer-val soc-col-deduct">−£${fmtK(gtOffice)}</span></div>` : ''}
          <div class="soc-footer-item soc-footer-item--outstanding">
            <span class="soc-footer-label">Remaining to Pay</span>
            <span class="soc-footer-val soc-col-outstanding soc-col-outstanding--green">£${gtRemain.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
          </div>
        </div>
        ${hasMultiCurrency ? `<div class="soc-conversion">Includes AED converted · ${year}</div>` : ''}
      </div>`;

    document.getElementById('salaryTotals').innerHTML = (groupCards.join('') + gbpCard) || '';

    // Payment Board removed — salary reminder panel handles categorized view
    document.getElementById('salaryBoard').innerHTML = '';

    // ── Per-employee cards ──
    if (!rows.length) {
      container.innerHTML = `<div class="empty-state"><div class="icon">💰</div><div>No employees with salary data.</div></div>`;
      return;
    }

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

      // First-month suggestion: use end-of-month calculation (not earned-to-today)
      const pr = emp.pro_rated;
      const fm = emp.first_month_full;
      // Partial = employee started mid-month (not day 1)
      const isPartialFirstMonth = fm && fm.first_month_days < fm.first_month_total_days;
      const payeNetFactor = paye && annualSalary > 0 ? paye.net_annual / annualSalary : 1;
      const suggestedFirstMonthNet = isPartialFirstMonth
        ? parseFloat((fm.first_month_pay * payeNetFactor).toFixed(2))
        : null;

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
          <div class="sc-avatar">${initials}</div>
          <div class="sc-info">
            <div class="sc-emp-name">${esc(emp.name || '')}</div>
            ${emp.job_title || emp.department ? `<div class="sc-emp-role">${[emp.job_title, emp.department].filter(Boolean).map(s => esc(s)).join(' · ')}</div>` : ''}
            <div class="sc-emp-badges">
              <span class="badge ${typeBadge}" style="font-size:0.67rem">${typeLabel}</span>
              <span class="badge badge-grey" style="font-size:0.67rem">${cur}</span>
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
            <span>${sym}${totalPaidEmp.toLocaleString('en-GB',{minimumFractionDigits:2})} paid</span>
            <span class="sc-pct-pill">${pctPaid}%</span>
            <span>${isOverpaid ? 'overpaid' : `${sym}${Math.abs(netRemaining).toLocaleString('en-GB',{minimumFractionDigits:2})} remaining`}</span>
          </div>
          <div class="sc-prog-track">
            <div class="sc-prog-fill${isOverpaid ? ' overpaid' : ''}" style="width:${Math.min(pctPaid,100)}%"></div>
          </div>
        </div>

        ${suggestedFirstMonthNet !== null ? (() => {
          const firstMonthName = MONTHS[parseInt(fm.first_month.split('-')[1])] || fm.first_month;
          const afterLabel = paye
            ? `after PAYE/NI${paye.pension > 0 ? '/pension' : ''}`
            : 'gross';
          return `<div class="sc-firstmonth-tip">
            <span class="sc-fm-icon">💡</span>
            <div>
              Suggested payment for ${firstMonthName} (started ${fm.start_date}):
              <strong>${sym}${suggestedFirstMonthNet.toLocaleString('en-GB',{minimumFractionDigits:2})}</strong>
              <span class="sc-fm-sub">${fm.first_month_days} of ${fm.first_month_total_days} working days · ${afterLabel}</span>
            </div>
          </div>`;
        })() : ''}

        <div class="sc-figures">
          ${paye ? `
          <div class="sc-fig">
            <div class="sc-fig-lbl">Gross / month</div>
            <div class="sc-fig-val">${sym}${paye.gross_monthly.toLocaleString('en-GB',{maximumFractionDigits:0})}</div>
            <div class="sc-fig-sub">before deductions</div>
          </div>
          <div class="sc-fig sc-fig-hi">
            <div class="sc-fig-lbl">Take-home / month</div>
            <div class="sc-fig-val">${sym}${paye.net_monthly.toLocaleString('en-GB',{maximumFractionDigits:0})}</div>
            <div class="sc-fig-sub">after PAYE + NI${paye.pension > 0 ? ' + pension' : ''}</div>
          </div>` : `
          <div class="sc-fig">
            <div class="sc-fig-lbl">Monthly pay</div>
            <div class="sc-fig-val">${sym}${(annualSalary/12).toLocaleString('en-GB',{maximumFractionDigits:0})}</div>
            <div class="sc-fig-sub">${sym}${annualSalary.toLocaleString('en-GB',{maximumFractionDigits:0})}/yr</div>
          </div>
          <div class="sc-fig ${excessDays > 0 ? 'sc-fig-bad' : 'sc-fig-ok'}">
            <div class="sc-fig-lbl">Days off</div>
            <div class="sc-fig-val">${totalDaysOff} <span style="font-size:0.75rem;font-weight:600;color:#9ca3af">/ ${allowanceDays}</span></div>
            <div class="sc-fig-sub">${allowanceLabel}</div>
            ${excessDays > 0 ? `<div class="sc-fig-deduct">−${sym}${excessDeduction.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})} deducted</div>` : ''}
          </div>`}
          <div class="sc-fig ${figOutClass}">
            <div class="sc-fig-lbl">Outstanding</div>
            <div class="sc-fig-val">${isOverpaid ? '−' : ''}${sym}${Math.abs(netRemaining).toLocaleString('en-GB',{maximumFractionDigits:0})}</div>
            <div class="sc-fig-sub">${isOverpaid ? 'overpaid' : isTerminated ? 'final balance' : `${year} balance`}</div>
          </div>
        </div>

        <div class="sc-sections">

          <!-- Payments -->
          <div class="sc-section">
            <button class="sc-sec-toggle" onclick="toggleSection(this)">
              <span class="sc-sec-title">Payments (${payments.length})</span>
              ${payments.length ? `<span class="sc-sec-sum green">+${sym}${totalPaidEmp.toLocaleString('en-GB',{minimumFractionDigits:2})}</span>` : ''}
              <span class="sc-chevron">›</span>
            </button>
            <div class="sc-sec-body">
              <div class="sc-sec-actions">
                <button class="btn btn-primary btn-sm" onclick="openSalaryPaymentModal(${emp.employee_id})">+ Log Payment</button>
              </div>
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
          ${(emp.pro_rated || emp.first_month_full) ? (() => {
            const pr = emp.pro_rated;
            const fmr = emp.first_month_full;
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
  // Populate employee dropdown
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
  openModal('salaryPayModal');
}

async function saveSalaryPayment() {
  const employee_id   = document.getElementById('spEmpId').value;
  const payment_year  = document.getElementById('spYear').value;
  const payment_month = document.getElementById('spMonth').value;
  const amount        = document.getElementById('spAmount').value;
  const notes         = document.getElementById('spNotes').value;
  if (!amount || parseFloat(amount) <= 0) return showToast('Enter a valid amount', 'error');
  const res = await fetch('/api/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_id, payment_year, payment_month, amount, notes })
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

  const [calRes, remRes] = await Promise.all([
    fetch(`/api/calendar?year=${calYear}&month=${calMonth}`),
    fetch(`/api/calendar-reminders?year=${calYear}&month=${calMonth}`)
  ]);
  calData = await calRes.json();
  calReminders = remRes.ok ? await remRes.json() : [];

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
  dates.forEach(date => {
    const entries = byDate[date].filter(r => !empFilter || String(r.employee_id) === empFilter);
    if (!entries.length) return;
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

  if (!daysHtml && !remHtml) { summary.classList.add('hidden'); return; }

  let html = '';
  if (daysHtml) html += `<div class="cal-sum-section"><div class="cal-sum-section-title">🏖 Days Off This Month</div>${daysHtml}</div>`;
  if (remHtml)  html += `<div class="cal-sum-section"><div class="cal-sum-section-title">🔔 Upcoming Reminders</div>${remHtml}</div>`;

  summary.innerHTML = html;
  summary.classList.remove('hidden');
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
    body: JSON.stringify({ title, category, reminder_date: reminderDate, recurrence, amount: amount || null, currency, notes })
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

function renderHotelSummary() {
  const yearData = hotelYearFiltered();
  // Group by currency and sum paid + AV amounts (exclude staff hotel, flights, printing)
  const byCur = {};
  yearData.forEach(r => {
    // Paid so far (venue)
    if (r.paid_amount != null) {
      const c = r.paid_currency || 'USD';
      byCur[c] = byCur[c] || { paid: 0, av: 0 };
      byCur[c].paid += parseFloat(r.paid_amount) || 0;
    }
    // AV cost (separate charges only)
    if (r.av_amount != null && r.av_billing !== 'included') {
      const c = r.av_currency || 'USD';
      byCur[c] = byCur[c] || { paid: 0, av: 0 };
      byCur[c].av += parseFloat(r.av_amount) || 0;
    }
  });

  const total   = yearData.length;
  const unpaid  = yearData.filter(r => r.status !== 'paid').length;
  // Total outstanding (where total_cost_num is set, sum in paid_currency — simplified to single value)
  const totalOutstandingGBP = yearData.reduce((a, r) => {
    if (!r.total_cost_num) return a;
    const tc = parseFloat(r.total_cost_num) || 0;
    const paid = parseFloat(r.paid_amount) || 0;
    const out = Math.max(0, tc - paid);
    // Convert to GBP for summary (rough)
    const c = r.paid_currency || 'USD';
    const rates = { GBP: 1, USD: 0.79, EUR: 0.86, CHF: 0.88, AED: 0.214 };
    return a + out * (rates[c] || 0.79);
  }, 0);

  const currencyCards = Object.entries(byCur).map(([cur, sums]) => {
    const sym = hotelCurrencySymbol(cur);
    const total_spent = sums.paid + sums.av;
    return `
      <div class="hotel-fin-card">
        <div class="hotel-fin-currency">${cur}</div>
        <div class="hotel-fin-row">
          <span class="hotel-fin-lbl">Venue / Hotel Paid</span>
          <span class="hotel-fin-val hotel-fin-green">${sym}${sums.paid.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
        </div>
        <div class="hotel-fin-row">
          <span class="hotel-fin-lbl">AV (separate charges)</span>
          <span class="hotel-fin-val hotel-fin-blue">${sym}${sums.av.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
        </div>
        <div class="hotel-fin-row hotel-fin-total-row">
          <span class="hotel-fin-lbl">Total Spent</span>
          <span class="hotel-fin-val">${sym}${total_spent.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
        </div>
      </div>`;
  }).join('');

  document.getElementById('hotelSummary').innerHTML = `
    <div class="hotel-fin-strip">
      ${currencyCards}
      <div class="hotel-fin-card hotel-fin-card--status">
        <div class="hotel-fin-currency">STATUS${_hotelYearFilter !== 'all' ? ` · ${_hotelYearFilter}` : ''}</div>
        <div class="hotel-fin-row"><span class="hotel-fin-lbl">Total Events</span><span class="hotel-fin-val">${total}</span></div>
        <div class="hotel-fin-row"><span class="hotel-fin-lbl">Fully Paid</span><span class="hotel-fin-val hotel-fin-green">${total - unpaid}</span></div>
        <div class="hotel-fin-row hotel-fin-total-row"><span class="hotel-fin-lbl">Outstanding Events</span><span class="hotel-fin-val hotel-fin-red">${unpaid}</span></div>
        ${totalOutstandingGBP > 0 ? `<div class="hotel-fin-row"><span class="hotel-fin-lbl">≈ Outstanding (GBP)</span><span class="hotel-fin-val hotel-fin-red">£${totalOutstandingGBP.toLocaleString('en-GB',{maximumFractionDigits:0})}</span></div>` : ''}
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
    const avSym   = hotelCurrencySymbol(r.av_currency || 'USD');
    const paidSym = hotelCurrencySymbol(r.paid_currency || 'USD');

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

    // Outstanding calculation
    const totalCost = parseFloat(r.total_cost_num) || 0;
    const paidAmt   = parseFloat(r.paid_amount) || 0;
    const paidSym2  = hotelCurrencySymbol(r.paid_currency || 'USD');
    const outstanding = totalCost > 0 ? Math.max(0, totalCost - paidAmt) : null;
    const outDisplay = outstanding !== null
      ? `<span style="color:${outstanding > 0 ? 'var(--danger)' : 'var(--success)'};font-weight:700">${outstanding > 0 ? paidSym2+fmtHotelNum(outstanding) : '✓ Settled'}</span>`
      : '<span class="ht-empty">—</span>';

    return `<tr class="${rowClass}" id="htr-${r.id}">
      ${cellText('event_name', r.event_name, 'font-weight:700')}
      ${cellText('hotel', r.hotel||'')}
      ${cellText('cost', r.cost||'')}
      ${cellCur('av_currency', r.av_currency)}
      ${cellNum('av_amount', r.av_amount)}
      <td class="ht-cell ht-cur-sel" data-id="${r.id}" data-field="av_billing" data-val="${r.av_billing||'separate'}">
        <select class="ht-select" onchange="htPatchField(${r.id},'av_billing',this.value)" onclick="event.stopPropagation()">
          <option value="separate"${(r.av_billing||'separate')==='separate'?' selected':''}>Sep.</option>
          <option value="included"${r.av_billing==='included'?' selected':''}>Incl.</option>
        </select>
      </td>
      ${cellCur('paid_currency', r.paid_currency)}
      ${cellNum('paid_amount', r.paid_amount, 'font-weight:600')}
      ${cellNum('total_cost_num', r.total_cost_num, 'color:var(--text)')}
      <td style="padding:6px 10px;white-space:nowrap">${outDisplay}</td>
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

function openHotelModal(id) {
  const r = id ? hotelData.find(x => x.id === id) : null;
  document.getElementById('hotelModalTitle').textContent = r ? 'Edit Hotel Expense' : 'Add Hotel Expense';
  document.getElementById('hotelEditId').value = r ? r.id : '';
  document.getElementById('hotelEventName').value  = r ? r.event_name : '';
  document.getElementById('hotelHotelName').value  = r ? (r.hotel || '') : '';
  document.getElementById('hotelCost').value        = r ? (r.cost || '') : '';
  document.getElementById('hotelStatus').value      = r ? r.status : 'pending';
  document.getElementById('hotelAvCurrency').value  = r ? (r.av_currency || 'USD') : 'USD';
  document.getElementById('hotelAvAmount').value    = r && r.av_amount != null ? r.av_amount : '';
  document.getElementById('hotelAvBilling').value   = r ? (r.av_billing || 'separate') : 'separate';
  document.getElementById('hotelPaidCurrency').value= r ? (r.paid_currency || 'USD') : 'USD';
  document.getElementById('hotelPaidAmount').value  = r && r.paid_amount != null ? r.paid_amount : '';
  document.getElementById('hotelStaffHotel').value  = r && r.staff_hotel != null ? r.staff_hotel : '';
  document.getElementById('hotelFlights').value     = r && r.flights    != null ? r.flights    : '';
  document.getElementById('hotelPrinting').value    = r && r.printing   != null ? r.printing   : '';
  document.getElementById('hotelNotes').value       = r ? (r.notes || '') : '';
  document.getElementById('hotelTotalCostNum').value = r && r.total_cost_num != null ? r.total_cost_num : '';
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
    av_currency:   document.getElementById('hotelAvCurrency').value,
    av_amount:     document.getElementById('hotelAvAmount').value || null,
    av_billing:    document.getElementById('hotelAvBilling').value,
    paid_currency: document.getElementById('hotelPaidCurrency').value,
    paid_amount:   document.getElementById('hotelPaidAmount').value || null,
    staff_hotel:    document.getElementById('hotelStaffHotel').value || null,
    flights:        document.getElementById('hotelFlights').value || null,
    printing:       document.getElementById('hotelPrinting').value || null,
    notes:          document.getElementById('hotelNotes').value.trim(),
    total_cost_num: document.getElementById('hotelTotalCostNum').value || null,
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
    // Refresh outstanding cell if cost/paid changed
    if (field === 'total_cost_num' || field === 'paid_amount' || field === 'paid_currency') {
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
    const res = await fetch('/api/holiday-requests/count');
    if (!res.ok) return;
    const { count } = await res.json();
    const badge = document.getElementById('notifBadge');
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
    document.getElementById('notifBellBtn').classList.toggle('notif-has-pending', count > 0);
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
    const res = await fetch('/api/holiday-requests?status=pending');
    const items = await res.json();
    if (!items.length) { list.innerHTML = '<div class="notif-empty">No pending requests</div>'; return; }
    list.innerHTML = items.map(r => {
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
  } catch { list.innerHTML = '<div class="notif-empty">Failed to load</div>'; }
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
  const active = subsData.filter(s => s.active);
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
  count.textContent = `${subsData.length} subscription${subsData.length !== 1 ? 's' : ''}`;
  if (!subsData.length) { tbody.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  const symMap = { GBP:'£', USD:'$', AED:'AED ', PHP:'₱' };
  tbody.innerHTML = subsData.map(s => {
    const sym = symMap[s.currency] || '';
    const perMonth = subToGBPPerMonth(s);
    const months = CYCLE_MONTHS[s.billing_cycle];
    const perYear = months ? perMonth * 12 : parseFloat(s.amount) * (SUB_FX[s.currency] || 1);
    const cycleLabel = { monthly:'Monthly', quarterly:'Quarterly', annually:'Annually', one_off:'One-Off' }[s.billing_cycle] || s.billing_cycle;
    const renewal = s.renewal_date ? new Date(s.renewal_date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—';
    const activeDot = s.active ? '<span style="color:var(--success)">●</span>' : '<span style="color:var(--muted)">●</span>';
    return `<tr class="${s.active ? '' : 'sub-inactive'}">
      <td>${activeDot} ${esc(s.name)}</td>
      <td>${sym}${fmt(parseFloat(s.amount))}</td>
      <td>${cycleLabel}</td>
      <td>£${fmt(perMonth)}</td>
      <td>£${fmt(perYear)}</td>
      <td>${renewal}</td>
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
          <div class="port-stat-label">Won Revenue</div>
          <div class="port-stat-val port-stat--green">£${fmt(won)}</div>
        </div>
        <div class="port-stat">
          <div class="port-stat-label">Pipeline</div>
          <div class="port-stat-val">£${fmt(pipeline)}</div>
        </div>
      </div>
      ${ev.notes ? `<div class="port-card-notes">${esc(ev.notes)}</div>` : ''}
      ${ev.companies ? `<div class="port-card-companies"><span style="font-size:0.72rem;color:var(--muted)">Companies: </span>${esc(ev.companies)}</div>` : ''}
    </div>`;
  }).join('');
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

function setDealEvent(eventId) {
  _dealEventFilter = eventId;
  renderDealsTable();
}

function dealPassesFilter(d) {
  const q = _dealQFilter;
  const yr = _dealYearFilter;
  const search = (document.getElementById('dealSearch')?.value || '').trim().toLowerCase();
  const stageFilter = document.getElementById('dealStageFilter')?.value || '';
  if (search && ![(d.company||''),(d.title||''),(d.contact_name||''),(d.invoice_number||'')].some(s => s.toLowerCase().includes(search))) return false;
  if (stageFilter && d.stage !== stageFilter) return false;
  if (_dealEventFilter) {
    const evtId = String(_dealEventFilter);
    if (!Array.isArray(d.events) || !d.events.some(ev => String(ev.event_id) === evtId)) return false;
  }
  const date = d.invoice_date ? new Date(d.invoice_date) : null;
  if (yr !== 'all') {
    if (!date || String(date.getFullYear()) !== yr) return false;
  }
  if (q !== 'all') {
    const months = DEAL_VAT_QUARTERS[q];
    if (!date) return false;
    if (!months.includes(date.getMonth() + 1)) return false;
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

  const symMap = { GBP:'£', USD:'$', AED:'AED ', PHP:'₱', EUR:'€' };
  tbody.innerHTML = filtered.map(d => {
    const sym = symMap[d.currency] || '£';
    const invMonth = d.invoice_date ? (() => {
      const dt = new Date(d.invoice_date);
      return `${String(dt.getFullYear()).slice(2)}-${dt.toLocaleDateString('en-GB',{month:'short'})}`;
    })() : '';
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
    const ec = (field, type, val, display, extra='') =>
      `<td class="deal-cell-edit" data-id="${d.id}" data-field="${field}" data-type="${type}" data-val="${String(val??'').replace(/"/g,'&quot;')}" onclick="dealCellClick(this)" ${extra}>${display}</td>`;

    // Paid cell: orange background if partial payment
    const paidDisplay = hasPaid ? `${sym}${fmt(paidAmt)}` : '<span style="color:var(--muted)">—</span>';
    const paidExtra = `style="text-align:right${isPartial ? ';background:rgba(234,88,12,.28)' : ''}"`;

    // Notes: truncated display
    const notesDisplay = d.notes
      ? `<span class="deal-notes-cell" title="${esc(d.notes)}">${esc(d.notes)}</span>`
      : '<span style="color:var(--muted);font-size:0.8rem">—</span>';

    return `<tr id="deal-row-${d.id}" class="${rowClass}">
      ${ec('invoice_date','date',d.invoice_date||'', `<span class="deal-month-disp">${invMonth||'<span style="color:var(--muted)">—</span>'}</span>`)}
      ${ec('company','text',d.company||d.title||'', `<strong>${esc(d.company||d.title)}</strong>${d.initials?` <span class="deal-initials-badge">${esc(d.initials)}</span>`:''}`)}
      ${ec('title','text',d.title||'', `<span class="deal-title-disp">${esc(d.title)}</span>`)}
      ${ec('paid_inc_vat','number',d.paid_inc_vat??'', paidDisplay, paidExtra)}
      ${ec('amount','number',d.amount||0, `${sym}${fmt(dealAmt)}`, 'style="text-align:right"')}
      ${ec('tax_vat','number',d.tax_vat??'', d.tax_vat ? `${sym}${fmt(parseFloat(d.tax_vat))}` : '<span style="color:var(--muted)">—</span>', 'style="text-align:right"')}
      ${ec('invoice_date','date',d.invoice_date||'', `<span style="font-size:0.78rem">${invDateStr||'<span style="color:var(--muted)">—</span>'}</span>`)}
      ${ec('bank','select-bank',d.bank||'', `<span style="font-size:0.78rem">${esc(d.bank||'')||'<span style="color:var(--muted)">—</span>'}</span>`)}
      ${ec('invoice_number','text',d.invoice_number||'', `<span style="font-family:monospace;font-size:0.72rem">${esc(d.invoice_number||'')}</span>${inv1}${inv2}`)}
      <td class="deal-cell-toggle" onclick="dealToggleBool(${d.id},'signature_received',${!!d.signature_received})" style="text-align:center;cursor:pointer" title="Click to toggle">${d.signature_received ? '✅' : '<span style="color:var(--muted)">—</span>'}</td>
      ${ec('initials','text',d.initials||'', d.initials ? `<span class="deal-initials-badge">${esc(d.initials)}</span>` : '<span style="color:var(--muted)">—</span>', 'style="text-align:center"')}
      ${ec('notes','textarea',d.notes||'', notesDisplay)}
      <td style="text-align:center">
        <button class="btn-icon btn-icon--danger" title="Delete" onclick="deleteDeal(${d.id})">🗑️</button>
      </td>
    </tr>`;
  }).join('');

  renderDealTotals(filtered, tfoot);
  renderDealsByInitials(filtered);
}

function dealCellClick(td) {
  // Don't open editor if clicking a link/button inside the cell
  if (event.target.tagName === 'A' || event.target.tagName === 'BUTTON' || event.target.closest('a,button')) return;
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
    ['','HSBC','Stripe','Barclays','Other'].forEach(s => {
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
    if (field === 'initials') { input.maxLength = 5; input.style.textTransform = 'uppercase'; input.style.width = '52px'; }
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
  // Columns: Month | Company | Title | Paid | Deal | Tax | InvDate | Bank | Inv# | Signed | By | Notes | Del = 13
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
  // Also update the top totals summary
  document.getElementById('dealTotals').innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <div class="dash-mini-card" style="flex:1;min-width:130px">
        <div class="dash-mini-label">Total Paid</div>
        <div class="dash-mini-value">£${fmt(totalPaid)}</div>
      </div>
      <div class="dash-mini-card dash-mini--green" style="flex:1;min-width:130px">
        <div class="dash-mini-label">Total Revenue</div>
        <div class="dash-mini-value">£${fmt(totalDeal)}</div>
      </div>
      <div class="dash-mini-card dash-mini--alert" style="flex:1;min-width:130px">
        <div class="dash-mini-label">Outstanding</div>
        <div class="dash-mini-value">£${fmt(Math.max(0,remaining))}</div>
      </div>
      <div class="dash-mini-card dash-mini--indigo" style="flex:1;min-width:130px">
        <div class="dash-mini-label">VAT${_dealQFilter !== 'all' ? ' '+_dealQFilter : ' Total'}</div>
        <div class="dash-mini-value">£${fmt(totalTax)}</div>
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
    document.getElementById('dealTitle').value = d.title;
    document.getElementById('dealCompany').value = d.company || '';
    document.getElementById('dealInitials').value = d.initials || '';
    document.getElementById('dealStage').value = d.stage;
    document.getElementById('dealCurrency').value = d.currency || 'GBP';
    document.getElementById('dealAmount').value = d.amount;
    document.getElementById('dealPaidIncVat').value = d.paid_inc_vat || '';
    document.getElementById('dealTaxVat').value = d.tax_vat || '';
    document.getElementById('dealInvoiceNumber').value = d.invoice_number || '';
    document.getElementById('dealInvoiceDate').value = d.invoice_date ? d.invoice_date.split('T')[0] : '';
    document.getElementById('dealPaidDate').value = d.paid_date ? d.paid_date.split('T')[0] : '';
    document.getElementById('dealBank').value = d.bank || '';
    document.getElementById('dealInvSent').checked = !!d.invoice_agreement_sent;
    document.getElementById('dealSigReceived').checked = !!d.signature_received;
    document.getElementById('dealNotes').value = d.notes || '';
    const evIds = Array.isArray(d.events) ? d.events.map(e => e.event_id).filter(Boolean) : [];
    Array.from(sel.options).forEach(o => { o.selected = evIds.includes(parseInt(o.value)); });
    if (d.invoice1_name) document.getElementById('dealInv1Preview').textContent = `Current: ${d.invoice1_name}`;
    if (d.invoice2_name) document.getElementById('dealInv2Preview').textContent = `Current: ${d.invoice2_name}`;
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
    document.getElementById('dealPaidDate').value = '';
    document.getElementById('dealBank').value = '';
    document.getElementById('dealInvSent').checked = false;
    document.getElementById('dealSigReceived').checked = false;
    document.getElementById('dealNotes').value = '';
    Array.from(sel.options).forEach(o => o.selected = false);
  }
  updateDealSplitPreview();
  openModal('dealModal');
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
  const title = document.getElementById('dealTitle').value.trim();
  if (!title) { showToast('Deal title is required', 'error'); return; }
  const amount = parseFloat(document.getElementById('dealAmount').value);
  if (isNaN(amount) || amount < 0) { showToast('Enter a valid amount', 'error'); return; }
  const sel = document.getElementById('dealEvents');
  const event_ids = Array.from(sel.selectedOptions).map(o => parseInt(o.value)).filter(Boolean);
  const paidIncVat = document.getElementById('dealPaidIncVat').value;
  const taxVat = document.getElementById('dealTaxVat').value;
  const body = {
    title, company: document.getElementById('dealCompany').value.trim(),
    contact_name: '', initials: document.getElementById('dealInitials').value.trim().toUpperCase(),
    currency: document.getElementById('dealCurrency').value,
    amount, stage: document.getElementById('dealStage').value,
    paid_inc_vat: paidIncVat ? parseFloat(paidIncVat) : null,
    tax_vat: taxVat ? parseFloat(taxVat) : null,
    invoice_number: document.getElementById('dealInvoiceNumber').value.trim(),
    invoice_date: document.getElementById('dealInvoiceDate').value || null,
    paid_date: document.getElementById('dealPaidDate').value || null,
    bank: document.getElementById('dealBank').value,
    invoice_agreement_sent: document.getElementById('dealInvSent').checked,
    signature_received: document.getElementById('dealSigReceived').checked,
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
  showToast('Deal deleted', 'success');
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
          <th style="padding:4px 8px">Company</th><th style="padding:4px 8px">Title</th>
          <th style="padding:4px 8px">Amount</th><th style="padding:4px 8px">Stage</th><th style="padding:4px 8px">Invoice #</th>
        </tr></thead><tbody>
          ${_importRows.slice(0,20).map(r=>`<tr>
            <td style="padding:3px 8px">${esc(r.company||'')}</td>
            <td style="padding:3px 8px">${esc(r.title||'')}</td>
            <td style="padding:3px 8px">${r.amount||'—'}</td>
            <td style="padding:3px 8px">${r.stage||'Prospect'}</td>
            <td style="padding:3px 8px;font-size:0.7rem;font-family:monospace">${esc(r.invoice_number||'')}</td>
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
    stage: ['stage','status','deal_stage'],
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

  const VALID_STAGES = new Set(['Prospect','Qualified','Proposal','Negotiation','Won','Lost']);
  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseRow(lines[i]);
    const get = field => (idxMap[field] >= 0 ? (cols[idxMap[field]] || '').trim() : '');
    const company = get('company');
    const title = get('title') || company;
    if (!company && !title) continue;
    const stageRaw = get('stage');
    // Normalize stage
    const stage = VALID_STAGES.has(stageRaw) ? stageRaw
      : stageRaw.toLowerCase().includes('won') ? 'Won'
      : stageRaw.toLowerCase().includes('lost') ? 'Lost'
      : stageRaw.toLowerCase().includes('prop') ? 'Proposal'
      : stageRaw.toLowerCase().includes('neg') ? 'Negotiation'
      : stageRaw.toLowerCase().includes('qual') ? 'Qualified'
      : 'Prospect';
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
      company, title, stage,
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
      notes: get('notes')
    });
  }
  return results;
}

async function runDealImport() {
  if (!_importRows.length) return;
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
      stage: row.stage || 'Prospect',
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
      notes: row.notes || '',
      event_ids: []
    };
    // Auto-set row_status for Won deals
    if (row.stage === 'Won' && row.paid_inc_vat) body.row_status = 'paid';
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
