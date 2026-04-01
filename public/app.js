// ─── STATE ───────────────────────────────────────────────────────────────────
let currentUser = null;
let employees = [];
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

  document.getElementById('userLabel').textContent = `${currentUser.username} (${currentUser.role})`;
  document.getElementById('todayDate').textContent = formatDate(today());

  if (currentUser.role === 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
  }

  const m = thisMonth();
  document.getElementById('repFrom').value = m.from;
  document.getElementById('repTo').value = m.to;
  document.getElementById('trackMonth').value = m.from.slice(0, 7);

  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.page));
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  await loadEmployees();
  loadDashboard();
});

// ─── NAVIGATION ──────────────────────────────────────────────────────────────
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelector(`[data-page="${page}"]`).classList.add('active');
  const titles = { dashboard:'Dashboard', tracking:'Daily Tracking', salary:'Salary Tracker', employees:'Employees', reports:'Reports', calendar:'Calendar', admins:'Admin Users' };
  document.getElementById('pageTitle').textContent = titles[page] || page;
  if (page === 'employees') loadEmpTable();
  if (page === 'admins') loadAdmins();
  if (page === 'calendar') loadCalendar();
  if (page === 'salary') loadSalaryPage();
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
  const all = await res.json();
  const tbody = document.getElementById('empTable');
  tbody.innerHTML = '';
  if (!all.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="icon">👥</div><div>No employees yet.</div></div></td></tr>`;
    return;
  }
  all.forEach(emp => {
    const typeLabel = emp.employment_type === 'self_employed' ? 'Self-Employed' : 'Payroll';
    const typeBadge = emp.employment_type === 'self_employed' ? 'badge-yellow' : 'badge-blue';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${esc(emp.name)}</strong></td>
      <td><span class="badge ${typeBadge}">${typeLabel}</span></td>
      <td>${emp.annual_salary > 0 ? fmtMoney(emp.annual_salary, emp.currency) + '/yr' : '—'}</td>
      <td><span class="badge ${emp.active ? 'badge-green' : 'badge-grey'}">${emp.active ? 'Active' : 'Inactive'}</span></td>
      <td style="text-align:right">
        <button class="btn btn-ghost btn-sm" onclick='openEmpModal(${JSON.stringify(emp)})'>Edit</button>
        ${emp.active
          ? `<button class="btn btn-danger btn-sm" onclick="toggleEmpActive(${emp.id},0)">Deactivate</button>`
          : `<button class="btn btn-ghost btn-sm" onclick="toggleEmpActive(${emp.id},1)">Reactivate</button>`}
      </td>`;
    tbody.appendChild(tr);
  });
}

function openEmpModal(emp = null) {
  document.getElementById('empId').value = emp ? emp.id : '';
  document.getElementById('empName').value = emp ? emp.name : '';
  document.getElementById('empType').value = emp ? (emp.employment_type || 'payroll') : 'payroll';
  document.getElementById('empCurrency').value = emp ? (emp.currency || 'GBP') : 'GBP';
  document.getElementById('empAnnualSalary').value = emp ? emp.annual_salary : 0;
  document.getElementById('empModalTitle').textContent = emp ? 'Edit Employee' : 'Add Employee';
  openModal('empModal');
}

async function saveEmployee() {
  const id = document.getElementById('empId').value;
  const name = document.getElementById('empName').value.trim();
  const employment_type = document.getElementById('empType').value;
  const currency = document.getElementById('empCurrency').value;
  const annual_salary = parseFloat(document.getElementById('empAnnualSalary').value) || 0;
  if (!name) return alert('Name is required');

  if (id) {
    await fetch(`/api/employees/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, employment_type, annual_salary, currency, active: 1 })
    });
  } else {
    await fetch('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, employment_type, annual_salary, currency })
    });
  }
  closeModal('empModal');
  await loadEmployees();
  loadEmpTable();
}

async function toggleEmpActive(id, active) {
  const res = await fetch('/api/employees/all');
  const all = await res.json();
  const emp = all.find(e => e.id === id);
  await fetch(`/api/employees/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...emp, active })
  });
  await loadEmployees();
  loadEmpTable();
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
async function loadDashboard() {
  const year = new Date().getFullYear();
  const res = await fetch(`/api/summary?from=${year}-01-01&to=${year}-12-31`);
  const summary = await res.json();

  const totalDeduction = summary.reduce((a, b) => a + b.total_deduction, 0);

  document.getElementById('dashStats').innerHTML = `
    <div class="stat-card blue"><div class="stat-label">Active Employees</div><div class="stat-value">${summary.length}</div></div>
    <div class="stat-card red"><div class="stat-label">Total Deductions (${year})</div><div class="stat-value">£${totalDeduction.toFixed(2)}</div></div>
  `;

  const tbody = document.getElementById('dashTable');
  tbody.innerHTML = '';
  summary.forEach(row => {
    const typeBadge = row.employment_type === 'self_employed' ? 'badge-yellow' : 'badge-blue';
    const typeLabel = row.employment_type === 'self_employed' ? 'Self-Emp' : 'Payroll';
    const daysColor = row.excess_days > 0 ? 'text-danger fw-bold' : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${esc(row.name)}</strong></td>
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
      <div class="stat-card" style="border-color:#e0e7ff"><div class="stat-label" style="color:var(--primary)">Ref. Potential (not deducted)</div><div class="stat-value" style="color:var(--primary);font-size:1.3rem">£${refTotal.toFixed(2)}</div></div>
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
  if (!empId) return alert('Please select an employee first');
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
  if (!res.ok) { const e = await res.json(); return alert(e.error); }
  closeModal('recordModal');
  const calPage = document.getElementById('page-calendar');
  if (calPage && calPage.classList.contains('active')) loadCalendar();
  else loadEmployeeRecords();
}

async function deleteRecord(id) {
  if (!confirm('Delete this record?')) return;
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
  if (isNaN(mins)) return alert('Enter a number of minutes');
  if (!reason) return alert('Reason is required');
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
  if (!confirm('Remove this adjustment?')) return;
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
  const res = await fetch(`/api/payments/${empId}?year=${year}`);
  const payments = await res.json();

  const totalPaid = payments.reduce((a, b) => a + parseFloat(b.amount), 0);
  const remaining = emp.annual_salary - totalPaid;

  document.getElementById('salaryInfo').innerHTML = `
    <div class="stat-card blue"><div class="stat-label">Annual Salary</div><div class="stat-value">£${parseFloat(emp.annual_salary).toFixed(2)}</div></div>
    <div class="stat-card green"><div class="stat-label">Paid This Year</div><div class="stat-value">£${totalPaid.toFixed(2)}</div></div>
    <div class="stat-card ${remaining > 0 ? 'red' : 'green'}"><div class="stat-label">Remaining</div><div class="stat-value">£${remaining.toFixed(2)}</div></div>
  `;

  const tbody = document.getElementById('paymentsTable');
  const empty = document.getElementById('paymentsEmpty');
  tbody.innerHTML = '';
  if (!payments.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  payments.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${MONTHS[p.payment_month]} ${p.payment_year}</td>
      <td class="fw-bold">£${parseFloat(p.amount).toFixed(2)}</td>
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
  if (!amount) return alert('Amount is required');
  const res = await fetch('/api/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_id, payment_year, payment_month, amount, notes })
  });
  if (!res.ok) { const e = await res.json(); return alert(e.error); }
  closeModal('paymentModal');
  loadEmployeeRecords();
}

async function deletePayment(id) {
  if (!confirm('Delete this payment record?')) return;
  await fetch(`/api/payments/${id}`, { method: 'DELETE' });
  loadEmployeeRecords();
}

// ─── REPORTS ─────────────────────────────────────────────────────────────────
async function loadReport() {
  const from = document.getElementById('repFrom').value;
  const to   = document.getElementById('repTo').value;
  const empId = document.getElementById('repEmp').value;
  const container = document.getElementById('reportContent');

  if (!from || !to) return alert('Please select a date range');

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
  if (!username || !password) return alert('Username and password required');
  const res = await fetch('/api/admins', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, role })
  });
  if (!res.ok) { const e = await res.json(); return alert(e.error); }
  closeModal('adminModal');
  loadAdmins();
}

async function deleteAdmin(id) {
  if (!confirm('Remove this user?')) return;
  const res = await fetch(`/api/admins/${id}`, { method: 'DELETE' });
  if (!res.ok) { const e = await res.json(); return alert(e.error); }
  loadAdmins();
}

async function resetPw(id) {
  const pw = prompt('New password:');
  if (!pw) return;
  await fetch(`/api/admins/${id}/password`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw })
  });
  alert('Password updated');
}

// ─── SALARY PAGE ─────────────────────────────────────────────────────────────

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
  try {
    initSalaryYearSelect();
    const year   = document.getElementById('salaryYear').value || new Date().getFullYear();
    const empFilter = document.getElementById('salaryEmpFilter').value;

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
    const rows = empFilter ? data.filter(e => String(e.employee_id) === empFilter) : data;

    // ── Totals strip (grouped by currency) ──
    const currencies = [...new Set(rows.map(r => r.currency || 'GBP'))];
    const totalHtml = currencies.map(c => {
      const sub = rows.filter(r => (r.currency || 'GBP') === c);
      const s = currencySymbol(c);
      const tAnnual  = sub.reduce((a, b) => a + (parseFloat(b.annual_salary) || 0), 0);
      const tPaid    = sub.reduce((a, b) => a + (parseFloat(b.total_paid) || 0), 0);
      const tDeduct  = sub.reduce((a, b) => a + (parseFloat(b.excess_deduction) || 0), 0);
      const tRemain  = sub.reduce((a, b) => a + (parseFloat(b.net_remaining) || 0), 0);
      const label    = currencies.length > 1 ? ` (${c})` : '';
      return `
        <div class="stat-card blue"><div class="stat-label">Total Payroll ${year}${label}</div><div class="stat-value">${s}${fmtK(tAnnual)}</div></div>
        <div class="stat-card green"><div class="stat-label">Total Paid${label}</div><div class="stat-value">${s}${fmtK(tPaid)}</div></div>
        <div class="stat-card red"><div class="stat-label">Day-Off Deductions${label}</div><div class="stat-value">${s}${fmtK(tDeduct)}</div></div>
        <div class="stat-card yellow"><div class="stat-label">Outstanding${label}</div><div class="stat-value">${s}${fmtK(tRemain)}</div></div>`;
    }).join('');
    document.getElementById('salaryTotals').innerHTML = totalHtml;

    // ── Per-employee cards ──
    if (!rows.length) {
      container.innerHTML = `<div class="empty-state"><div class="icon">💰</div><div>No employees with salary data.</div></div>`;
      return;
    }

    container.innerHTML = rows.map(emp => {
      const annualSalary    = parseFloat(emp.annual_salary) || 0;
      const totalPaidEmp    = parseFloat(emp.total_paid) || 0;
      const excessDeduction = parseFloat(emp.excess_deduction) || 0;
      const netRemaining    = parseFloat(emp.net_remaining) || 0;
      const excessDays      = parseFloat(emp.excess_days) || 0;
      const totalDaysOff    = emp.total_days_off != null ? emp.total_days_off : 0;
      const allowanceDays   = emp.allowance_days != null ? emp.allowance_days : '—';
      const pctPaid         = parseFloat(emp.pct_paid) || 0;
      const payments        = Array.isArray(emp.payments) ? emp.payments : [];
      const officeDeductions = Array.isArray(emp.office_deductions) ? emp.office_deductions : [];
      const officeTotal     = parseFloat(emp.total_office_deductions) || 0;
      const cur             = emp.currency || 'GBP';
      const sym             = currencySymbol(cur);

      const initials = (emp.name || '?').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
      const typeLabel = emp.employment_type === 'self_employed' ? 'Self-Employed' : 'Payroll';
      const typeBadge = emp.employment_type === 'self_employed' ? 'badge-yellow' : 'badge-blue';
      const allowanceLabel = emp.employment_type === 'self_employed' ? '5 days/yr free' : '20 days/yr free';
      const isOverpaid = netRemaining < 0;

      // Progress bar
      const fill = `<div class="salary-progress-fill${isOverpaid ? ' overpaid' : ''}" style="width:${Math.min(pctPaid,100)}%"></div>`;
      const progress = `
        <div class="salary-progress-wrap">
          <div class="salary-progress-labels">
            <span>Paid: ${sym}${totalPaidEmp.toLocaleString('en-GB', {minimumFractionDigits:2})}</span>
            <span>${pctPaid}% of annual salary paid</span>
          </div>
          <div class="salary-progress-bar">${fill}</div>
        </div>`;

      // Payments list
      const payList = payments.length
        ? payments.map(p => `
          <div class="salary-payment-row">
            <span class="salary-payment-month">${MONTHS[p.payment_month] || p.payment_month} ${p.payment_year}</span>
            <span class="salary-payment-amount">+${sym}${parseFloat(p.amount || 0).toLocaleString('en-GB', {minimumFractionDigits:2})}</span>
            <span class="salary-payment-notes">${esc(p.notes || '')}</span>
            <button class="btn btn-danger btn-sm" onclick="deleteSalaryPayment(${p.id})">Del</button>
          </div>`).join('')
        : `<div style="color:var(--muted);font-size:0.85rem;padding:8px 0">No payments logged yet.</div>`;

      const deductNote = excessDays > 0
        ? `<div class="salary-stat danger"><div class="salary-stat-label">Day-Off Deduction</div><div class="salary-stat-value">−${sym}${excessDeduction.toLocaleString('en-GB', {minimumFractionDigits:2})}</div></div>`
        : `<div class="salary-stat success"><div class="salary-stat-label">Day-Off Deduction</div><div class="salary-stat-value">${sym}0.00</div></div>`;

      const officeNote = officeTotal > 0
        ? `<div class="salary-stat danger"><div class="salary-stat-label">Office Items</div><div class="salary-stat-value">−${sym}${officeTotal.toLocaleString('en-GB', {minimumFractionDigits:2})}</div></div>`
        : '';

      const netClass = isOverpaid ? ' danger' : '';

      return `<div class="salary-card">
        <div class="salary-card-header">
          <div class="salary-avatar">${initials}</div>
          <div>
            <div class="salary-name">${esc(emp.name || '')}</div>
            <div class="salary-sub">
              <span class="badge ${typeBadge}" style="font-size:0.68rem">${typeLabel}</span>
              &nbsp;<span class="badge badge-grey" style="font-size:0.68rem">${cur}</span>
              &nbsp;${allowanceLabel} &nbsp;·&nbsp; Rate: (annual ÷ 12) ÷ working days/month
            </div>
          </div>
          <div class="salary-header-right">
            <div class="salary-annual-label">Annual Salary</div>
            <div class="salary-annual">${sym}${annualSalary.toLocaleString('en-GB', {minimumFractionDigits:2})}</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="openSalaryPaymentModal(${emp.employee_id})">+ Payment</button>
        </div>
        <div class="salary-card-body">
          ${progress}
          <div class="salary-stats-row">
            <div class="salary-stat primary"><div class="salary-stat-label">Annual Salary</div><div class="salary-stat-value">${sym}${annualSalary.toLocaleString('en-GB', {minimumFractionDigits:2})}</div></div>
            <div class="salary-stat success"><div class="salary-stat-label">Total Paid</div><div class="salary-stat-value">${sym}${totalPaidEmp.toLocaleString('en-GB', {minimumFractionDigits:2})}</div></div>
            <div class="salary-stat ${excessDays > 0 ? 'warning' : ''}"><div class="salary-stat-label">Days Off (${year})</div><div class="salary-stat-value">${totalDaysOff} / ${allowanceDays}</div></div>
            ${deductNote}
            ${officeNote}
          </div>

          <button class="salary-payments-toggle" onclick="togglePaymentsList(this)">▶ Payment History (${payments.length})</button>
          <div class="salary-payments-list">${payList}</div>

          <div style="margin-top:14px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <span style="font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted)">Office Items / Deductions (${officeDeductions.length})</span>
              <button class="btn btn-ghost btn-sm" onclick="openOfficeDeductModal(${emp.employee_id})">+ Add Item</button>
            </div>
            ${officeDeductions.length ? `
              <div style="display:flex;flex-direction:column;gap:6px">
                ${officeDeductions.map(od => `
                  <div class="salary-payment-row" style="background:#fff8f8;border-color:#fca5a5">
                    <span class="salary-payment-month">${od.deduction_date || ''}</span>
                    <span style="font-weight:800;color:var(--danger)">−${sym}${parseFloat(od.amount || 0).toLocaleString('en-GB',{minimumFractionDigits:2})}</span>
                    <span class="salary-payment-notes">${esc(od.description || '')}</span>
                    ${od.notes ? `<span style="color:var(--muted);font-size:0.75rem">${esc(od.notes)}</span>` : ''}
                    <button class="btn btn-danger btn-sm" onclick="deleteOfficeDeduction(${od.id})">Del</button>
                  </div>`).join('')}
              </div>` : `<div style="color:var(--muted);font-size:0.82rem;padding:4px 0">No items logged.</div>`}
          </div>

          <div class="salary-net-remaining${netClass}">
            <div>
              <div class="salary-net-remaining-label">Net Remaining to Pay (${year})</div>
              <div style="font-size:0.75rem;color:var(--muted);margin-top:2px">Annual − Paid − Day-Off Deductions − Office Items</div>
            </div>
            <div class="salary-net-remaining-value">${isOverpaid ? '−' : ''}${sym}${Math.abs(netRemaining).toLocaleString('en-GB', {minimumFractionDigits:2})}</div>
          </div>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    console.error('loadSalaryPage error:', e);
    container.innerHTML = `<div class="alert alert-error" style="margin:24px">Failed to load salary data: ${esc(e.message)}. Please refresh and try again.</div>`;
  }
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
  if (!amount || parseFloat(amount) <= 0) return alert('Enter a valid amount');
  const res = await fetch('/api/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_id, payment_year, payment_month, amount, notes })
  });
  if (!res.ok) { const e = await res.json(); return alert(e.error); }
  closeModal('salaryPayModal');
  loadSalaryPage();
}

async function deleteSalaryPayment(id) {
  if (!confirm('Delete this payment?')) return;
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
  if (!description) return alert('Description is required');
  if (!amount || parseFloat(amount) <= 0) return alert('Enter a valid amount');
  const res = await fetch('/api/office-deductions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_id, description, amount, deduction_date, notes })
  });
  if (!res.ok) { const e = await res.json(); return alert(e.error); }
  closeModal('officeDeductModal');
  loadSalaryPage();
}

async function deleteOfficeDeduction(id) {
  if (!confirm('Remove this deduction?')) return;
  await fetch(`/api/office-deductions/${id}`, { method: 'DELETE' });
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

async function loadCalendar() {
  document.getElementById('calMonthLabel').textContent =
    `${MONTHS[calMonth]} ${calYear}`;

  const empFilter = document.getElementById('calEmpFilter').value;
  const res = await fetch(`/api/calendar?year=${calYear}&month=${calMonth}`);
  calData = await res.json();

  // Group by date
  const byDate = {};
  calData.forEach(r => {
    const key = r.record_date;
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(r);
  });

  // Build grid
  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';

  // First day of month (0=Sun … 6=Sat) — shift so Mon=0
  const firstDow = (new Date(calYear, calMonth - 1, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(calYear, calMonth, 0).getDate();
  const prevDays  = new Date(calYear, calMonth - 1, 0).getDate();
  const todayStr  = today();

  // Fill leading blanks from previous month
  for (let i = 0; i < firstDow; i++) {
    const d = prevDays - firstDow + i + 1;
    const cell = document.createElement('div');
    cell.className = 'cal-cell other-month';
    cell.innerHTML = `<div class="cal-date">${d}</div>`;
    grid.appendChild(cell);
  }

  // Days of this month
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dow = (new Date(calYear, calMonth - 1, d).getDay() + 6) % 7; // Mon=0
    const entries = (byDate[dateStr] || []).filter(r =>
      !empFilter || String(r.employee_id) === empFilter
    );

    const cell = document.createElement('div');
    const classes = ['cal-cell'];
    if (dateStr === todayStr) classes.push('today');
    if (dow >= 5) classes.push('weekend');
    if (entries.length) classes.push('has-offs');
    cell.className = classes.join(' ');

    const maxShow = 3;
    const chips = entries.slice(0, maxShow).map(r => {
      const cls = parseFloat(r.is_day_off) === 1 ? 'chip-full' : 'chip-half';
      return `<span class="cal-chip ${cls}">${esc(r.employee_name)}</span>`;
    }).join('');
    const more = entries.length > maxShow
      ? `<div class="cal-more">+${entries.length - maxShow} more</div>` : '';

    cell.innerHTML = `<div class="cal-date">${d}</div><div class="cal-chips">${chips}${more}</div>`;
    cell.addEventListener('click', () => openDayModal(dateStr, entries));
    grid.appendChild(cell);
  }

  // Trailing blanks
  const totalCells = firstDow + daysInMonth;
  const trailing = (7 - (totalCells % 7)) % 7;
  for (let i = 1; i <= trailing; i++) {
    const cell = document.createElement('div');
    cell.className = 'cal-cell other-month';
    cell.innerHTML = `<div class="cal-date">${i}</div>`;
    grid.appendChild(cell);
  }

  // Summary strip: days with offs
  renderCalSummary(byDate, empFilter);
}

function renderCalSummary(byDate, empFilter) {
  const summary = document.getElementById('calSummary');
  const dates = Object.keys(byDate).sort();
  if (!dates.length) { summary.classList.add('hidden'); return; }

  let html = '';
  dates.forEach(date => {
    const entries = byDate[date].filter(r =>
      !empFilter || String(r.employee_id) === empFilter
    );
    if (!entries.length) return;
    const chips = entries.map(r => {
      const cls = parseFloat(r.is_day_off) === 1 ? 'chip-full' : 'chip-half';
      const label = parseFloat(r.is_day_off) === 1 ? 'Full' : 'Half';
      return `<span class="cal-off-item"><span class="cal-chip ${cls}">${label}</span> ${esc(r.employee_name)}</span>`;
    }).join('');
    html += `<div class="cal-summary-card">
      <h4>${formatDate(date)}</h4>
      <div class="cal-off-list">${chips}</div>
    </div>`;
  });

  if (html) {
    summary.innerHTML = `<h3 style="margin-bottom:12px;font-size:0.95rem;color:var(--muted)">Days Off This Month</h3>` + html;
    summary.classList.remove('hidden');
  } else {
    summary.classList.add('hidden');
  }
}

function openDayModal(dateStr, entries) {
  document.getElementById('dayModalTitle').textContent = formatDate(dateStr);

  let content = '';
  if (entries.length) {
    content = entries.map(r => {
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
  } else {
    content = `<p style="color:var(--muted);font-size:0.88rem">No days off recorded for this date.</p>`;
  }
  document.getElementById('dayModalContent').innerHTML = content;

  // Book button: pre-fill record modal with this date & day-off
  document.getElementById('dayModalBookBtn').onclick = () => {
    closeModal('dayModal');
    openRecordModalForDate(dateStr);
  };

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
