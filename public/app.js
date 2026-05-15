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

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  await loadEmployees().catch(err => console.error('loadEmployees failed:', err));
  loadDashboard();

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
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.bottom-nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
  document.querySelector(`.bottom-nav-item[data-page="${page}"]`)?.classList.add('active');
  const titles = { dashboard:'Dashboard', tracking:'Daily Tracking', salary:'Salary Tracker', employees:'Employees', reports:'Reports', calendar:'Calendar', admins:'Admin Users', hotels:'Hotel Expenses' };
  document.getElementById('pageTitle').textContent = titles[page] || page;
  if (page === 'employees') loadEmpTable();
  if (page === 'admins') loadAdmins();
  if (page === 'calendar') loadCalendar();
  if (page === 'salary') { loadSalaryPage(); renderSalaryReminderPanel(); }
  if (page === 'hotels') loadHotelExpenses();
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
  if (!name) return showToast('Name is required', 'error');

  const payload = { name, employment_type, annual_salary, currency, start_date, pension_rate,
                    job_title, department, phone, email, contract_end_date };
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

  const [summaryRes, salaryRes, upcomingRes, expiringRes, allEmpRes, hotelRes] = await Promise.all([
    fetch(`/api/summary?from=${year}-01-01&to=${year}-12-31`),
    fetch(`/api/salary-overview?year=${year}`),
    fetch(`/api/calendar-reminders/upcoming?days=7`),
    fetch(`/api/contracts/expiring?days=60`),
    fetch(`/api/employees/all`),
    fetch(`/api/hotel-expenses`)
  ]);

  const summary       = summaryRes.ok   ? await summaryRes.json()   : [];
  const salaryData    = salaryRes.ok    ? await salaryRes.json()    : [];
  const upcoming      = upcomingRes.ok  ? await upcomingRes.json()  : [];
  const expiring      = expiringRes.ok  ? await expiringRes.json()  : [];
  const allEmps       = allEmpRes.ok    ? await allEmpRes.json()    : [];
  const hotelData     = hotelRes.ok     ? await hotelRes.json()     : [];

  const activeEmps    = allEmps.filter(e => e.active);
  const unpaidCount   = getUnpaidThisMonth(salaryData, year, month).length;
  updateSalaryBadge(unpaidCount);

  const totalHeadcount  = activeEmps.length;
  const payrollCount    = activeEmps.filter(e => e.employment_type === 'payroll').length;
  const seCount         = activeEmps.filter(e => e.employment_type === 'self_employed').length;

  // Total GBP salary remaining to pay this year
  const totalGBPRemaining = salaryData
    .filter(e => (e.currency || 'GBP') === 'GBP')
    .reduce((a, e) => a + Math.max(0, parseFloat(e.net_remaining) || 0), 0);

  // Hotel fees remaining (unpaid + partial rows: paid_amount vs cost where parseable)
  const hotelUnpaidCount = hotelData.filter(h => h.status !== 'paid').length;
  const hotelPaidTotal   = hotelData.reduce((a, h) => a + (parseFloat(h.paid_amount) || 0), 0);

  // Compute total deductions and flagged employees from summary data
  const totalDeduct = summary.reduce((a, row) => a + (parseFloat(row.total_deduction) || 0), 0);
  const flaggedCount = summary.filter(row => (parseFloat(row.excess_days) || 0) > 0).length;

  // Pre-compute all conditional strings to avoid nested template literals
  const flaggedColor = flaggedCount > 0 ? 'var(--negative)' : 'var(--text)';
  const flaggedLabel = flaggedCount > 0 ? (flaggedCount + ' over allowance') : 'all within allowance';
  const hotelClass   = hotelUnpaidCount > 0 ? 'dash-mini--alert' : 'dash-mini--green';
  const hotelSub     = hotelUnpaidCount > 0 ? (hotelUnpaidCount + ' unpaid / partial →') : 'All settled';
  const hotelEvents  = hotelUnpaidCount + ' event' + (hotelUnpaidCount !== 1 ? 's' : '');
  const unpaidClass  = unpaidCount > 0 ? 'dash-mini--alert' : 'dash-mini--green';
  const unpaidIcon   = unpaidCount > 0 ? '&#128276;' : '&#9989;';
  const unpaidSub    = unpaidCount > 0 ? 'Action required &rarr;' : 'All paid up';
  const salaryFmt    = fmtK(totalGBPRemaining);

  document.getElementById('dashStats').innerHTML =
    '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--border);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:16px">' +
      '<div style="background:var(--surface);padding:18px 20px;display:flex;flex-direction:column;gap:10px">' +
        '<div style="font:600 10px/1 var(--font-mono);text-transform:uppercase;letter-spacing:1px;color:var(--muted)">Headcount</div>' +
        '<div style="font:600 32px/1 var(--font-mono);color:var(--text);letter-spacing:-1px">' + String(activeEmps.length).padStart(2,'0') + '</div>' +
        '<div style="font:500 11px/1 var(--font-mono);color:var(--positive)">&uarr; active employees</div>' +
      '</div>' +
      '<div style="background:var(--surface);padding:18px 20px;display:flex;flex-direction:column;gap:10px">' +
        '<div style="font:600 10px/1 var(--font-mono);text-transform:uppercase;letter-spacing:1px;color:var(--muted)">Payroll &middot; Self-emp</div>' +
        '<div style="font:600 32px/1 var(--font-mono);color:var(--text);letter-spacing:-1px">' + payrollCount + '<span style="color:var(--dim);font-size:20px">&middot;</span>' + seCount + '</div>' +
        '<div style="font:500 11px/1 var(--font-mono);color:var(--muted)">stable</div>' +
      '</div>' +
      '<div style="background:var(--surface);padding:18px 20px;display:flex;flex-direction:column;gap:10px">' +
        '<div style="font:600 10px/1 var(--font-mono);text-transform:uppercase;letter-spacing:1px;color:var(--muted)">Total Deductions</div>' +
        '<div style="font:600 28px/1 var(--font-mono);color:var(--text);letter-spacing:-1px">&pound;' + totalDeduct.toFixed(0) + '</div>' +
        '<div style="font:500 11px/1 var(--font-mono);color:var(--negative)">&darr; YTD this year</div>' +
      '</div>' +
      '<div style="background:var(--surface);padding:18px 20px;display:flex;flex-direction:column;gap:10px">' +
        '<div style="font:600 10px/1 var(--font-mono);text-transform:uppercase;letter-spacing:1px;color:var(--muted)">Flagged Employees</div>' +
        '<div style="font:600 32px/1 var(--font-mono);color:' + flaggedColor + ';letter-spacing:-1px">' + String(flaggedCount).padStart(2,'0') + '</div>' +
        '<div style="font:500 11px/1 var(--font-mono);color:var(--muted)">' + flaggedLabel + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="dash-bento">' +
      '<div class="dash-hero-card">' +
        '<div class="dash-hero-glow"></div>' +
        '<div class="dash-hero-label">Active Headcount</div>' +
        '<div class="dash-hero-value">' + totalHeadcount + '</div>' +
        '<div class="dash-hero-pills">' +
          '<span class="dash-hero-pill dash-hero-pill--blue">' + payrollCount + ' Payroll</span>' +
          '<span class="dash-hero-pill dash-hero-pill--amber">' + seCount + ' Self-Emp</span>' +
        '</div>' +
        '<div class="dash-hero-footer">Total workforce &middot; ' + year + '</div>' +
      '</div>' +
      '<div class="dash-mini-grid">' +
        '<div class="dash-mini-card dash-mini--indigo" style="cursor:pointer" onclick="navigate(\'salary\')">' +
          '<div class="dash-mini-icon">&pound;</div>' +
          '<div class="dash-mini-body">' +
            '<div class="dash-mini-label">Salaries Remaining</div>' +
            '<div class="dash-mini-value">&pound;' + salaryFmt + '</div>' +
            '<div class="dash-mini-sub">GBP outstanding &middot; ' + year + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="dash-mini-card ' + hotelClass + '" style="cursor:pointer" onclick="navigate(\'hotels\')">' +
          '<div class="dash-mini-icon">&#127968;</div>' +
          '<div class="dash-mini-body">' +
            '<div class="dash-mini-label">Hotel Fees Remaining</div>' +
            '<div class="dash-mini-value">' + hotelEvents + '</div>' +
            '<div class="dash-mini-sub">' + hotelSub + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="dash-mini-card ' + unpaidClass + '" style="cursor:pointer" onclick="navigate(\'salary\')">' +
          '<div class="dash-mini-icon">' + unpaidIcon + '</div>' +
          '<div class="dash-mini-body">' +
            '<div class="dash-mini-label">Unpaid This Month</div>' +
            '<div class="dash-mini-value">' + unpaidCount + '</div>' +
            '<div class="dash-mini-sub">' + unpaidSub + '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  // Contract expiry panel
  renderContractExpiryPanel(expiring);

  // Headcount by department
  renderHeadcountPanel(activeEmps);

  // Upcoming reminders panel
  renderDashUpcoming(upcoming);

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

function renderContractExpiryPanel(expiring) {
  const el = document.getElementById('contractExpiryPanel');
  if (!el) return;
  if (!expiring.length) { el.innerHTML = ''; return; }
  const today = new Date().toISOString().slice(0,10);
  el.innerHTML = `
    <div class="dash-panel dash-panel--alert">
      <div class="dash-panel-header">
        <span class="dash-panel-icon">⚠️</span>
        <span class="dash-panel-title">Contracts Expiring (Next 60 Days)</span>
        <span class="dash-panel-count">${expiring.length}</span>
      </div>
      <div class="dash-panel-body">
        ${expiring.map(e => {
          const expired = e.contract_end_date < today;
          const badge = expired ? 'badge-red' : 'badge-yellow';
          const label = expired ? 'Expired' : `Ends ${e.contract_end_date}`;
          return `<div class="dash-panel-row">
            <div>
              <div style="font-weight:700;font-size:0.88rem">${esc(e.name)}</div>
              ${e.job_title || e.department ? `<div style="font-size:0.74rem;color:var(--muted)">${esc([e.job_title,e.department].filter(Boolean).join(' · '))}</div>` : ''}
            </div>
            <span class="badge ${badge}">${label}</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

function renderHeadcountPanel(activeEmps) {
  const el = document.getElementById('headcountPanel');
  if (!el) return;
  const depts = {};
  activeEmps.forEach(e => {
    const d = e.department || 'Unassigned';
    if (!depts[d]) depts[d] = { count: 0, payroll: 0, se: 0 };
    depts[d].count++;
    if (e.employment_type === 'self_employed') depts[d].se++;
    else depts[d].payroll++;
  });
  const sorted = Object.entries(depts).sort((a,b) => b[1].count - a[1].count);
  if (!sorted.length) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="dash-panel">
      <div class="dash-panel-header">
        <span class="dash-panel-icon">🏢</span>
        <span class="dash-panel-title">Headcount by Department</span>
        <span class="dash-panel-count">${activeEmps.length} total</span>
      </div>
      <div class="dash-panel-body">
        ${sorted.map(([dept, info]) => `
          <div class="dash-panel-row">
            <div style="font-weight:600;font-size:0.88rem">${esc(dept)}</div>
            <div style="display:flex;gap:6px;align-items:center">
              ${info.payroll ? `<span class="badge badge-blue">${info.payroll} payroll</span>` : ''}
              ${info.se ? `<span class="badge badge-yellow">${info.se} self-emp</span>` : ''}
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}

function renderDashUpcoming(upcoming) {
  const el = document.getElementById('upcomingPanel');
  if (!el) return;
  const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  if (!upcoming || !upcoming.length) { el.innerHTML = ''; return; }
  const rows = upcoming.slice(0,6).map(r => {
    const d = new Date(r.virtual_date);
    const day = d.getUTCDate();
    const mon = MONTHS[d.getUTCMonth()];
    const amtStr = r.amount ? ' &nbsp;&middot;&nbsp; ' + (r.currency === 'GBP' ? '&pound;' : r.currency === 'USD' ? '$' : r.currency + ' ') + parseFloat(r.amount).toLocaleString('en-GB', {minimumFractionDigits:0}) : '';
    return '<div style="display:flex;gap:12px;padding:11px 16px;border-bottom:1px solid var(--line);align-items:center">' +
      '<div style="width:38px;padding:5px 0;text-align:center;background:var(--surface-2);border:1px solid var(--border);border-radius:6px;flex-shrink:0">' +
        '<div style="font:700 14px/1 var(--font-mono);color:var(--text)">' + day + '</div>' +
        '<div style="font:500 9px/1 var(--font-mono);color:var(--muted);margin-top:3px;letter-spacing:0.5px">' + mon + '</div>' +
      '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font:600 12.5px/1 var(--font-sans);color:var(--text)">' + esc(r.title) + '</div>' +
        '<div style="font:500 10.5px/1 var(--font-mono);color:var(--muted);text-transform:uppercase;letter-spacing:0.4px;margin-top:3px">' + esc(r.category||'') + '</div>' +
      '</div>' +
      '<div style="font:700 12.5px/1 var(--font-mono);color:var(--text);white-space:nowrap">' + amtStr + '</div>' +
    '</div>';
  }).join('');
  el.innerHTML = '<div class="card" style="margin-bottom:0">' +
    '<div class="card-header" style="padding:12px 16px">' +
      '<span class="card-title" style="display:flex;align-items:center;gap:6px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg> Upcoming reminders</span>' +
      '<span style="font-size:0.72rem;color:var(--muted);font-family:var(--font-mono)">next 30d</span>' +
    '</div>' +
    '<div style="padding:0">' + rows + '</div>' +
  '</div>';
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
    const sym = hotelCurrencySymbol(h.paid_currency || 'USD');
    const amtStr = h.paid_amount ? sym + parseFloat(h.paid_amount).toLocaleString('en-GB') + ' &middot; ' : '';
    items.push({ icon: ICONS.hotel, tone: 'info', title: 'Hotel expense', detail: esc(h.event_name) + ' &middot; ' + amtStr + h.status });
  });

  if (!items.length) { el.innerHTML = ''; return; }

  const TONE_COLOR = { pos:'var(--positive)', neg:'var(--negative)', warn:'var(--warning)', info:'var(--info)' };
  const rows = items.slice(0,6).map(it =>
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

  // Payments section
  loadPaymentsSection(empId, emp);
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

  // Update adminSub
  const adminCount = admins.length;
  const adminRoleCount = admins.filter(a => a.role === 'admin').length;
  const managerCount = admins.filter(a => a.role === 'manager').length;
  const adminSub = document.getElementById('adminSub');
  if (adminSub) adminSub.textContent = `// ${adminCount} account${adminCount !== 1 ? 's' : ''} · ${adminRoleCount} admin · ${managerCount} manager`;

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
      <td><span class="badge ${a.role==='admin'?'badge-green':'badge-blue'}">${a.role.toUpperCase()}</span></td>
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
    // AED → GBP approximate rate (shown clearly to user)
    const AED_TO_GBP = 1 / 4.67;

    // Aggregate GBP totals across all currencies for stat tiles
    const totalPaidGBP = groups.reduce((sum, g) => {
      const v = g.rows.reduce((a, b) => a + (parseFloat(b.total_paid) || 0), 0);
      return sum + (g.currency === 'AED' ? v * AED_TO_GBP : v);
    }, 0);
    const totalDueGBP = groups.reduce((sum, g) => {
      const v = g.rows.reduce((a, b) => a + (parseFloat(b.salary_target ?? b.annual_salary) || 0), 0);
      return sum + (g.currency === 'AED' ? v * AED_TO_GBP : v);
    }, 0);
    const totalOutstandingGBP = groups.reduce((sum, g) => {
      const v = g.rows.reduce((a, b) => a + (parseFloat(b.net_remaining) || 0), 0);
      return sum + (g.currency === 'AED' ? v * AED_TO_GBP : v);
    }, 0);
    const totalBonusGBP = groups.reduce((sum, g) => {
      const v = g.rows.reduce((a, b) => a + (parseFloat(b.bonus_total) || 0), 0);
      return sum + (g.currency === 'AED' ? v * AED_TO_GBP : v);
    }, 0);
    const paidPct = totalDueGBP > 0 ? (totalPaidGBP / totalDueGBP * 100) : 0;
    const unpaidCount = activeRows.filter(r => (parseFloat(r.net_remaining) || 0) > 0).length;
    const fmtGBP = v => v >= 1000 ? `£${(v/1000).toFixed(1)}k` : `£${v.toFixed(0)}`;

    document.getElementById('salaryTotals').innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--border);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
        <div style="background:var(--surface);padding:18px 20px;display:flex;flex-direction:column;gap:10px">
          <div style="font:600 10px/1 var(--font-mono);text-transform:uppercase;letter-spacing:1px;color:var(--muted)">Paid YTD</div>
          <div style="font:600 28px/1 var(--font-mono);color:var(--text);letter-spacing:-1px">${fmtGBP(totalPaidGBP)}</div>
          <div style="font:500 11px/1 var(--font-mono);color:var(--positive)">${paidPct.toFixed(0)}% of target</div>
        </div>
        <div style="background:var(--surface);padding:18px 20px;display:flex;flex-direction:column;gap:10px">
          <div style="font:600 10px/1 var(--font-mono);text-transform:uppercase;letter-spacing:1px;color:var(--muted)">Due YTD</div>
          <div style="font:600 28px/1 var(--font-mono);color:var(--text);letter-spacing:-1px">${fmtGBP(totalDueGBP)}</div>
          <div style="font:500 11px/1 var(--font-mono);color:var(--muted)">salary target ${year}</div>
        </div>
        <div style="background:var(--surface);padding:18px 20px;display:flex;flex-direction:column;gap:10px">
          <div style="font:600 10px/1 var(--font-mono);text-transform:uppercase;letter-spacing:1px;color:var(--muted)">Outstanding</div>
          <div style="font:600 28px/1 var(--font-mono);color:${totalOutstandingGBP > 0 ? 'var(--negative)' : 'var(--positive)'};letter-spacing:-1px">${fmtGBP(Math.abs(totalOutstandingGBP))}</div>
          <div style="font:500 11px/1 var(--font-mono);color:var(--muted)">${unpaidCount > 0 ? `${unpaidCount} employee${unpaidCount !== 1 ? 's' : ''} unpaid` : 'all paid up'}</div>
        </div>
        <div style="background:var(--surface);padding:18px 20px;display:flex;flex-direction:column;gap:10px">
          <div style="font:600 10px/1 var(--font-mono);text-transform:uppercase;letter-spacing:1px;color:var(--muted)">Bonuses YTD</div>
          <div style="font:600 28px/1 var(--font-mono);color:var(--text);letter-spacing:-1px">${fmtGBP(totalBonusGBP)}</div>
          <div style="font:500 11px/1 var(--font-mono);color:var(--muted)">across all staff</div>
        </div>
      </div>`;

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

      return `<div class="sc-card${isTerminated ? ' sc-terminated' : ''}${avatarTypeClass}">
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

function renderCalSummary(byDate, empFilter) {
  const summary = document.getElementById('calSummary');
  const dates = Object.keys(byDate).sort();

  // Compute stats
  let fullDaysTotal = 0;
  let halfDaysTotal = 0;
  let calendarHtml = '';

  dates.forEach(date => {
    const entries = byDate[date].filter(r =>
      !empFilter || String(r.employee_id) === empFilter
    );
    if (!entries.length) return;
    entries.forEach(r => {
      const v = parseFloat(r.is_day_off);
      if (v === 1) fullDaysTotal++;
      else if (v === 0.5) halfDaysTotal++;
    });
    const chips = entries.map(r => {
      const cls = parseFloat(r.is_day_off) === 1 ? 'chip-full' : 'chip-half';
      const label = parseFloat(r.is_day_off) === 1 ? 'Full' : 'Half';
      return `<span class="cal-off-item"><span class="cal-chip ${cls}">${label}</span> ${esc(r.employee_name)}</span>`;
    }).join('');
    calendarHtml += `<div class="cal-summary-card">
      <h4>${formatDate(date)}</h4>
      <div class="cal-off-list">${chips}</div>
    </div>`;
  });

  const reminderCount = calReminders.length;
  const hasSomething = calendarHtml || fullDaysTotal || halfDaysTotal || reminderCount;
  if (!hasSomething) { summary.classList.add('hidden'); return; }

  const statTiles = `
    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--border);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:16px">
      <div style="background:var(--surface);padding:16px 18px;display:flex;flex-direction:column;gap:8px">
        <div style="font:600 10px/1 var(--font-mono);text-transform:uppercase;letter-spacing:1px;color:var(--muted)">Full Days Off</div>
        <div style="font:600 28px/1 var(--font-mono);color:var(--text);letter-spacing:-1px">${String(fullDaysTotal).padStart(2,'0')}</div>
        <div style="font:500 11px/1 var(--font-mono);color:var(--negative)">this month</div>
      </div>
      <div style="background:var(--surface);padding:16px 18px;display:flex;flex-direction:column;gap:8px">
        <div style="font:600 10px/1 var(--font-mono);text-transform:uppercase;letter-spacing:1px;color:var(--muted)">Half Days</div>
        <div style="font:600 28px/1 var(--font-mono);color:var(--text);letter-spacing:-1px">${String(halfDaysTotal).padStart(2,'0')}</div>
        <div style="font:500 11px/1 var(--font-mono);color:var(--warning)">this month</div>
      </div>
      <div style="background:var(--surface);padding:16px 18px;display:flex;flex-direction:column;gap:8px">
        <div style="font:600 10px/1 var(--font-mono);text-transform:uppercase;letter-spacing:1px;color:var(--muted)">Expense Reminders</div>
        <div style="font:600 28px/1 var(--font-mono);color:var(--text);letter-spacing:-1px">${String(reminderCount).padStart(2,'0')}</div>
        <div style="font:500 11px/1 var(--font-mono);color:var(--info)">this month</div>
      </div>
    </div>`;

  if (calendarHtml) {
    summary.innerHTML = statTiles + `<h3 style="margin-bottom:12px;font-size:0.95rem;color:var(--muted)">Days Off This Month</h3>` + calendarHtml;
  } else {
    summary.innerHTML = statTiles;
  }
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
    panel.innerHTML = `
      <div class="salary-reminder-header">
        <span>💳 ${unpaid.length} employee${unpaid.length > 1 ? 's' : ''} not yet paid for ${monthName} ${year}</span>
        <button class="btn btn-ghost btn-sm" onclick="dismissAllReminders()">Dismiss all</button>
      </div>
      ${unpaid.map(emp => {
        const sym = currencySymbol(emp.currency || 'GBP');
        const grossMonthly = (parseFloat(emp.annual_salary) || 0) / 12;
        const netMo = emp.net_monthly ? parseFloat(emp.net_monthly) : null;
        const displayAmount = netMo ?? grossMonthly;
        const taxLabel = netMo ? ` <span style="font-size:0.72rem;color:var(--muted)">(net take-home)</span>` : '';
        return `
          <div class="salary-reminder-row">
            <div class="salary-reminder-name">${esc(emp.name)}</div>
            <div class="salary-reminder-amount">${sym}${displayAmount.toLocaleString('en-GB',{minimumFractionDigits:2})} /mo${taxLabel}</div>
            <div class="salary-reminder-actions">
              <button class="btn btn-ghost btn-sm" onclick="skipSalaryReminder(${emp.employee_id},${year},${month})">Skip</button>
              <button class="btn btn-primary btn-sm" onclick="openSalaryPaymentModal(${emp.employee_id})">Log Payment</button>
            </div>
          </div>`;
      }).join('')}`;
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

async function loadHotelExpenses() {
  const res = await fetch('/api/hotel-expenses');
  if (!res.ok) { showToast('Failed to load hotel expenses', 'error'); return; }
  hotelData = await res.json();
  renderHotelSummary();
  renderHotelTable();
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

function parseHotelCostStr(str) {
  if (!str) return 0;
  let s = String(str).replace(/[£$€,\s]/g, '').replace(/AED|USD|GBP|EUR|CHF/gi, '').trim();
  const isK = /k$/i.test(s), isM = /m$/i.test(s);
  s = s.replace(/[km]$/i, '');
  let n = parseFloat(s);
  if (isNaN(n)) return 0;
  if (isM) n *= 1000000;
  else if (isK) n *= 1000;
  return n;
}

function renderHotelSummary() {
  const total      = hotelData.length;
  const paidCount  = hotelData.filter(r => r.status === 'paid').length;
  const unpaidCount = total - paidCount;

  const totalCommit = hotelData.reduce((s, r) => s + parseHotelCostStr(r.cost), 0);
  const totalPaid   = hotelData.reduce((s, r) => s + (parseFloat(r.paid_amount) || 0), 0);
  const totalPend   = Math.max(0, totalCommit - totalPaid);
  const paidPct     = totalCommit > 0 ? Math.round(totalPaid / totalCommit * 100) : 0;

  const fmtM = v => v >= 1000000 ? '$' + (v/1000000).toFixed(1) + 'M' : v >= 1000 ? '$' + (v/1000).toFixed(0) + 'k' : '$' + v.toFixed(0);

  const hotelSub = document.getElementById('hotelSub');
  if (hotelSub) hotelSub.textContent = '// ' + total + ' event' + (total !== 1 ? 's' : '') + ' · ' + paidCount + ' paid · ' + (unpaidCount > 0 ? unpaidCount + ' outstanding' : 'all settled');

  document.getElementById('hotelSummary').innerHTML =
    '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--border);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:20px">' +
      '<div style="background:var(--surface);padding:18px 20px;display:flex;flex-direction:column;gap:8px">' +
        '<div style="font:600 10px/1 var(--font-mono);text-transform:uppercase;letter-spacing:1px;color:var(--muted);display:flex;align-items:center;gap:5px"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> Total commitments</div>' +
        '<div style="font:700 28px/1 var(--font-mono);color:var(--text);letter-spacing:-1px">' + fmtM(totalCommit) + '</div>' +
        '<div style="font:500 11px/1 var(--font-mono);color:var(--negative)">+' + total + ' events tracked</div>' +
      '</div>' +
      '<div style="background:var(--surface);padding:18px 20px;display:flex;flex-direction:column;gap:8px">' +
        '<div style="font:600 10px/1 var(--font-mono);text-transform:uppercase;letter-spacing:1px;color:var(--muted);display:flex;align-items:center;gap:5px"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="20 6 9 17 4 12"/></svg> Paid so far</div>' +
        '<div style="font:700 28px/1 var(--font-mono);color:var(--text);letter-spacing:-1px">' + fmtM(totalPaid) + '</div>' +
        '<div style="font:500 11px/1 var(--font-mono);color:var(--positive)">' + paidPct + '% paid</div>' +
      '</div>' +
      '<div style="background:var(--surface);padding:18px 20px;display:flex;flex-direction:column;gap:8px">' +
        '<div style="font:600 10px/1 var(--font-mono);text-transform:uppercase;letter-spacing:1px;color:var(--muted);display:flex;align-items:center;gap:5px"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Pending</div>' +
        '<div style="font:700 28px/1 var(--font-mono);color:var(--text);letter-spacing:-1px">' + fmtM(totalPend) + '</div>' +
        '<div style="font:500 11px/1 var(--font-mono);color:var(--negative)">' + unpaidCount + ' event' + (unpaidCount !== 1 ? 's' : '') + '</div>' +
      '</div>' +
    '</div>';
}

function renderHotelTable() {
  const search = (document.getElementById('hotelSearch')?.value || '').toLowerCase();
  const statusF = document.getElementById('hotelStatusFilter')?.value || '';
  const filtered = hotelData.filter(r => {
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

  tbody.innerHTML = filtered.map(r => {
    const rowClass = r.status === 'paid' ? 'hotel-row-paid' : r.status === 'partial' ? 'hotel-row-partial' : '';
    const avSym   = hotelCurrencySymbol(r.av_currency || 'USD');
    const paidSym = hotelCurrencySymbol(r.paid_currency || 'USD');
    const avBillingBadge = r.av_billing === 'included' ? ' <span class="hotel-incl-badge">incl.</span>' : '';
    const avStr   = r.av_amount != null ? `${avSym}${fmtHotelNum(r.av_amount)}${avBillingBadge}` : '—';
    const paidStr = r.paid_amount != null ? `${paidSym}${fmtHotelNum(r.paid_amount)}` : '—';
    const shStr   = r.staff_hotel != null ? `${fmtHotelNum(r.staff_hotel)}` : '—';
    const flStr   = r.flights    != null ? `${fmtHotelNum(r.flights)}` : '—';
    const prStr   = r.printing   != null ? `${fmtHotelNum(r.printing)}` : '—';
    return `<tr class="${rowClass}" title="${esc(r.notes||'')}">
      <td><strong>${esc(r.event_name)}</strong></td>
      <td style="font-size:0.82rem">${esc(r.hotel||'—')}</td>
      <td style="font-size:0.82rem;color:var(--text-2)">${esc(r.cost||'—')}</td>
      <td style="font-size:0.82rem">${avStr}</td>
      <td style="font-size:0.82rem;font-weight:600">${paidStr}</td>
      <td style="font-size:0.82rem;color:var(--muted)">${shStr}</td>
      <td style="font-size:0.82rem;color:var(--muted)">${flStr}</td>
      <td style="font-size:0.82rem;color:var(--muted)">${prStr}</td>
      <td>${STATUS_BADGE[r.status] || ''}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm" onclick="openHotelModal(${r.id})">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteHotelExpense(${r.id})">×</button>
        </div>
      </td>
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
    staff_hotel:   document.getElementById('hotelStaffHotel').value || null,
    flights:       document.getElementById('hotelFlights').value || null,
    printing:      document.getElementById('hotelPrinting').value || null,
    notes:         document.getElementById('hotelNotes').value.trim()
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
