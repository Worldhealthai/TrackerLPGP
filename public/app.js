// ─── STATE ───────────────────────────────────────────────────────────────────
let currentUser = null;
let currentPage = 'dashboard';
let employees = [];
let currentAdjRecord = null; // { employeeId, date }

const SHIFT_MINS = 480;
const ALLOWED_BREAK = 40;

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

  // Default date ranges
  const m = thisMonth();
  document.getElementById('dashFrom').value = m.from;
  document.getElementById('dashTo').value = m.to;
  document.getElementById('repFrom').value = m.from;
  document.getElementById('repTo').value = m.to;
  document.getElementById('trackMonth').value = m.from.slice(0, 7);

  // Nav
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
  currentPage = page;

  const titles = { dashboard: 'Dashboard', tracking: 'Daily Tracking', employees: 'Employees', reports: 'Reports', admins: 'Admin Users' };
  document.getElementById('pageTitle').textContent = titles[page] || page;

  if (page === 'employees') loadEmpTable();
  if (page === 'admins') loadAdmins();
}

// ─── EMPLOYEES ───────────────────────────────────────────────────────────────
async function loadEmployees() {
  const res = await fetch('/api/employees');
  employees = await res.json();
  populateEmpSelects();
}

function populateEmpSelects() {
  ['trackEmp', 'repEmp'].forEach(id => {
    const sel = document.getElementById(id);
    const prev = sel.value;
    sel.innerHTML = id === 'repEmp' ? '<option value="">All Employees</option>' : '<option value="">-- Select Employee --</option>';
    employees.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = e.name;
      sel.appendChild(opt);
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
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><div class="icon">👥</div><div>No employees yet.</div></div></td></tr>`;
    return;
  }
  all.forEach(emp => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${esc(emp.name)}</strong></td>
      <td>$${parseFloat(emp.daily_rate).toFixed(2)}/day</td>
      <td><span class="badge ${emp.active ? 'badge-green' : 'badge-grey'}">${emp.active ? 'Active' : 'Inactive'}</span></td>
      <td style="text-align:right">
        <button class="btn btn-ghost btn-sm" onclick="openEmpModal(${emp.id}, '${esc(emp.name)}', ${emp.daily_rate}, ${emp.active})">Edit</button>
        ${emp.active ? `<button class="btn btn-danger btn-sm" onclick="deactivateEmp(${emp.id})">Deactivate</button>` : `<button class="btn btn-ghost btn-sm" onclick="reactivateEmp(${emp.id})">Reactivate</button>`}
      </td>`;
    tbody.appendChild(tr);
  });
}

function openEmpModal(id = null, name = '', rate = 0, active = 1) {
  document.getElementById('empId').value = id || '';
  document.getElementById('empName').value = name;
  document.getElementById('empRate').value = rate;
  document.getElementById('empModalTitle').textContent = id ? 'Edit Employee' : 'Add Employee';
  openModal('empModal');
}

async function saveEmployee() {
  const id = document.getElementById('empId').value;
  const name = document.getElementById('empName').value.trim();
  const daily_rate = parseFloat(document.getElementById('empRate').value) || 0;
  if (!name) return alert('Name is required');

  if (id) {
    await fetch(`/api/employees/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, daily_rate, active: 1 })
    });
  } else {
    await fetch('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, daily_rate })
    });
  }
  closeModal('empModal');
  await loadEmployees();
  loadEmpTable();
}

async function deactivateEmp(id) {
  if (!confirm('Deactivate this employee?')) return;
  const emp = employees.find(e => e.id === id);
  await fetch(`/api/employees/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: emp.name, daily_rate: emp.daily_rate, active: 0 })
  });
  await loadEmployees();
  loadEmpTable();
}

async function reactivateEmp(id) {
  const res = await fetch('/api/employees/all');
  const all = await res.json();
  const emp = all.find(e => e.id === id);
  await fetch(`/api/employees/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: emp.name, daily_rate: emp.daily_rate, active: 1 })
  });
  await loadEmployees();
  loadEmpTable();
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
async function loadDashboard() {
  const from = document.getElementById('dashFrom').value;
  const to = document.getElementById('dashTo').value;
  const params = new URLSearchParams();
  if (from) params.append('from', from);
  if (to) params.append('to', to);

  const res = await fetch('/api/summary?' + params);
  const summary = await res.json();

  const totalEmp = summary.length;
  const totalDeduction = summary.reduce((a, b) => a + b.total_deduction, 0);
  const totalDaysOff = summary.reduce((a, b) => a + b.days_off, 0);
  const totalRecords = summary.reduce((a, b) => a + b.record_count, 0);

  document.getElementById('dashStats').innerHTML = `
    <div class="stat-card blue"><div class="stat-label">Employees</div><div class="stat-value">${totalEmp}</div></div>
    <div class="stat-card"><div class="stat-label">Days Tracked</div><div class="stat-value">${totalRecords}</div></div>
    <div class="stat-card yellow"><div class="stat-label">Days Off</div><div class="stat-value">${totalDaysOff}</div></div>
    <div class="stat-card red"><div class="stat-label">Total Deductions</div><div class="stat-value">$${totalDeduction.toFixed(2)}</div></div>
  `;

  const tbody = document.getElementById('dashTable');
  tbody.innerHTML = '';
  if (!summary.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="icon">📊</div><div>No data in this range.</div></td></tr>`;
    return;
  }
  summary.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${esc(row.name)}</strong></td>
      <td>${row.record_count}</td>
      <td>${row.days_off > 0 ? `<span class="badge badge-yellow">${row.days_off}</span>` : '–'}</td>
      <td>${row.total_deductible_minutes} min</td>
      <td class="${row.total_deduction > 0 ? 'text-danger fw-bold' : ''}">$${row.total_deduction.toFixed(2)}</td>
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

  const month = document.getElementById('trackMonth').value; // YYYY-MM
  let from = '', to = '';
  if (month) {
    from = month + '-01';
    const d = new Date(month + '-01');
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    to = d.toISOString().slice(0, 10);
  }

  const params = new URLSearchParams();
  if (from) params.append('from', from);
  if (to) params.append('to', to);

  const res = await fetch(`/api/records/${empId}?${params}`);
  const records = await res.json();
  const emp = employees.find(e => e.id === parseInt(empId));

  document.getElementById('trackTableTitle').textContent = emp ? `${emp.name} – ${month || 'All'}` : 'Records';

  // Stats bar
  const statsBar = document.getElementById('empStatsBar');
  if (records.length && emp) {
    const totalDeduct = records.reduce((a, b) => a + b.total_deduction, 0);
    const daysOff = records.filter(r => r.is_day_off).length;
    const totalBreak = records.filter(r => !r.is_day_off).reduce((a, b) => a + b.break_minutes, 0);
    const totalPhone = records.filter(r => !r.is_day_off).reduce((a, b) => a + b.phone_minutes, 0);
    const totalWasted = records.filter(r => !r.is_day_off).reduce((a, b) => a + b.wasted_minutes, 0);
    const totalLate = records.filter(r => !r.is_day_off).reduce((a, b) => a + b.late_minutes, 0);
    statsBar.innerHTML = `
      <div class="stat-card"><div class="stat-label">Break (total)</div><div class="stat-value">${totalBreak}m</div></div>
      <div class="stat-card yellow"><div class="stat-label">Phone Time</div><div class="stat-value">${totalPhone}m</div></div>
      <div class="stat-card yellow"><div class="stat-label">Wasted Time</div><div class="stat-value">${totalWasted}m</div></div>
      <div class="stat-card yellow"><div class="stat-label">Late Arrivals</div><div class="stat-value">${totalLate}m</div></div>
      <div class="stat-card red"><div class="stat-label">Days Off</div><div class="stat-value">${daysOff}</div></div>
      <div class="stat-card red"><div class="stat-label">Total Deductions</div><div class="stat-value">$${totalDeduct.toFixed(2)}</div></div>
    `;
    statsBar.classList.remove('hidden');
  } else {
    statsBar.classList.add('hidden');
  }

  const tbody = document.getElementById('trackTable');
  const empty = document.getElementById('trackEmpty');
  tbody.innerHTML = '';

  if (!records.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  records.forEach(r => {
    const tr = document.createElement('tr');
    if (r.is_day_off) tr.classList.add('day-off-row');

    const excessBreak = Math.max(0, r.break_minutes - ALLOWED_BREAK);
    const adjSign = r.manual_adj_minutes > 0 ? '+' : '';

    tr.innerHTML = `
      <td><strong>${r.record_date}</strong></td>
      <td>
        ${r.break_minutes}m
        ${excessBreak > 0 ? `<span class="badge badge-red">+${excessBreak}m over</span>` : '<span class="badge badge-green">OK</span>'}
      </td>
      <td>${r.phone_minutes > 0 ? `<span class="badge badge-yellow">${r.phone_minutes}m</span>` : '–'}</td>
      <td>${r.wasted_minutes > 0 ? `<span class="badge badge-yellow">${r.wasted_minutes}m</span>` : '–'}</td>
      <td>${r.late_minutes > 0 ? `<span class="badge badge-red">${r.late_minutes}m</span>` : '–'}</td>
      <td>${r.is_day_off ? '<span class="badge badge-red">Day Off</span>' : '–'}</td>
      <td>
        ${r.manual_adj_minutes !== 0 ? `<span class="badge ${r.manual_adj_minutes > 0 ? 'badge-red' : 'badge-green'}">${adjSign}${r.manual_adj_minutes}m</span>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="openAdjModal(${r.employee_id}, '${r.record_date}')">Adj</button>
      </td>
      <td><strong>${r.total_deductible_minutes}m</strong></td>
      <td class="${r.total_deduction > 0 ? 'text-danger fw-bold' : ''}">$${r.total_deduction.toFixed(2)}</td>
      <td style="max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(r.notes || '')}">${esc(r.notes || '') || '–'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" onclick="openEditRecord(${r.id}, ${r.employee_id}, '${r.record_date}', ${r.break_minutes}, ${r.phone_minutes}, ${r.wasted_minutes}, ${r.late_minutes}, ${r.is_day_off}, \`${esc(r.notes || '')}\`)">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteRecord(${r.id})">Del</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── RECORD MODAL ────────────────────────────────────────────────────────────
function openRecordModal() {
  const empId = document.getElementById('trackEmp').value;
  if (!empId) return alert('Please select an employee first');
  document.getElementById('recId').value = '';
  document.getElementById('recEmpId').value = empId;
  document.getElementById('recDate').value = today();
  document.getElementById('recBreak').value = 40;
  document.getElementById('recPhone').value = 0;
  document.getElementById('recWasted').value = 0;
  document.getElementById('recLate').value = 0;
  document.getElementById('recDayOff').value = '0';
  document.getElementById('recNotes').value = '';
  document.getElementById('recFields').style.display = '';
  document.getElementById('recordModalTitle').textContent = 'Add Daily Record';
  updatePreview();
  openModal('recordModal');
}

function openEditRecord(id, empId, date, brk, phone, wasted, late, dayOff, notes) {
  document.getElementById('recId').value = id;
  document.getElementById('recEmpId').value = empId;
  document.getElementById('recDate').value = date;
  document.getElementById('recBreak').value = brk;
  document.getElementById('recPhone').value = phone;
  document.getElementById('recWasted').value = wasted;
  document.getElementById('recLate').value = late;
  document.getElementById('recDayOff').value = dayOff ? '1' : '0';
  document.getElementById('recNotes').value = notes;
  document.getElementById('recFields').style.display = dayOff ? 'none' : '';
  document.getElementById('recordModalTitle').textContent = 'Edit Record';
  updatePreview();
  openModal('recordModal');
}

function toggleDayOff() {
  const isDayOff = document.getElementById('recDayOff').value === '1';
  document.getElementById('recFields').style.display = isDayOff ? 'none' : '';
  updatePreview();
}

function updatePreview() {
  const empId = document.getElementById('recEmpId').value;
  const emp = employees.find(e => e.id === parseInt(empId));
  const isDayOff = document.getElementById('recDayOff').value === '1';
  const box = document.getElementById('recPreview');

  if (!emp) { box.classList.add('hidden'); return; }

  const rate = emp.daily_rate;
  const ratePerMin = rate / SHIFT_MINS;

  let html = '';
  if (isDayOff) {
    html = `<h3>Deduction Preview</h3>
      <div class="deduction-row"><span>Full day off deduction</span><span>$${rate.toFixed(2)}</span></div>
      <div class="deduction-row total"><span>Total Deduction</span><span>$${rate.toFixed(2)}</span></div>`;
  } else {
    const brk = parseInt(document.getElementById('recBreak').value) || 0;
    const phone = parseInt(document.getElementById('recPhone').value) || 0;
    const wasted = parseInt(document.getElementById('recWasted').value) || 0;
    const late = parseInt(document.getElementById('recLate').value) || 0;
    const excessBreak = Math.max(0, brk - ALLOWED_BREAK);
    const total = excessBreak + phone + wasted + late;
    const amount = total * ratePerMin;

    if (total === 0) { box.classList.add('hidden'); return; }

    html = `<h3>Deduction Preview</h3>`;
    if (excessBreak > 0) html += `<div class="deduction-row"><span>Excess break (${brk}m – ${ALLOWED_BREAK}m allowed)</span><span>${excessBreak}m / $${(excessBreak*ratePerMin).toFixed(2)}</span></div>`;
    if (phone > 0) html += `<div class="deduction-row"><span>Phone time</span><span>${phone}m / $${(phone*ratePerMin).toFixed(2)}</span></div>`;
    if (wasted > 0) html += `<div class="deduction-row"><span>Wasted time</span><span>${wasted}m / $${(wasted*ratePerMin).toFixed(2)}</span></div>`;
    if (late > 0) html += `<div class="deduction-row"><span>Late arrival</span><span>${late}m / $${(late*ratePerMin).toFixed(2)}</span></div>`;
    html += `<div class="deduction-row total"><span>Total Deductible</span><span>${total}m / $${amount.toFixed(2)}</span></div>`;
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
    is_day_off: document.getElementById('recDayOff').value === '1',
    notes: document.getElementById('recNotes').value
  };

  let res;
  if (id) {
    res = await fetch(`/api/records/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } else {
    res = await fetch('/api/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  if (!res.ok) {
    const err = await res.json();
    return alert(err.error);
  }
  closeModal('recordModal');
  loadEmployeeRecords();
}

async function deleteRecord(id) {
  if (!confirm('Delete this record?')) return;
  await fetch(`/api/records/${id}`, { method: 'DELETE' });
  loadEmployeeRecords();
}

// ─── ADJUSTMENTS ─────────────────────────────────────────────────────────────
async function openAdjModal(empId, date) {
  currentAdjRecord = { empId, date };
  document.getElementById('adjModalSubtitle').textContent = `Employee ID ${empId} – ${date}`;
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

  if (!adjs.length) {
    list.innerHTML = '<div style="color:var(--muted);font-size:0.85rem">No adjustments yet.</div>';
    return;
  }

  list.innerHTML = adjs.map(a => `
    <div class="adj-item">
      <div>
        <span class="adj-amount ${a.adjustment_minutes > 0 ? 'positive' : 'negative'}">${a.adjustment_minutes > 0 ? '+' : ''}${a.adjustment_minutes}m</span>
        &nbsp; ${esc(a.reason)}
        <small style="color:var(--muted)"> – by ${esc(a.username || 'unknown')} on ${a.created_at.slice(0,10)}</small>
      </div>
      <button class="btn btn-danger btn-sm" onclick="deleteAdj(${a.id})">✕</button>
    </div>
  `).join('');
}

async function saveAdjustment() {
  const mins = parseInt(document.getElementById('adjMinutes').value);
  const reason = document.getElementById('adjReason').value.trim();
  if (isNaN(mins)) return alert('Enter a number of minutes');
  if (!reason) return alert('Reason is required');

  await fetch('/api/adjustments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      employee_id: currentAdjRecord.empId,
      record_date: currentAdjRecord.date,
      adjustment_minutes: mins,
      reason
    })
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

// ─── REPORTS ─────────────────────────────────────────────────────────────────
async function loadReport() {
  const from = document.getElementById('repFrom').value;
  const to = document.getElementById('repTo').value;
  const empId = document.getElementById('repEmp').value;

  if (!from || !to) return alert('Please select a date range');

  const params = new URLSearchParams({ from, to });
  const summaryRes = await fetch('/api/summary?' + params);
  const summary = await summaryRes.json();

  const filtered = empId ? summary.filter(e => e.employee_id === parseInt(empId)) : summary;
  const container = document.getElementById('reportContent');

  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state"><div class="icon">📋</div><div>No data found for the selected range.</div></div>`;
    return;
  }

  const totalDeduction = filtered.reduce((a, b) => a + b.total_deduction, 0);

  let html = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><span class="card-title">Summary: ${from} to ${to}</span></div>
      <div class="stats-grid">
        <div class="stat-card blue"><div class="stat-label">Employees</div><div class="stat-value">${filtered.length}</div></div>
        <div class="stat-card red"><div class="stat-label">Total Deductions</div><div class="stat-value">$${totalDeduction.toFixed(2)}</div></div>
      </div>
    </div>
  `;

  for (const emp of filtered) {
    // Fetch detailed records for each employee
    const recRes = await fetch(`/api/records/${emp.employee_id}?from=${from}&to=${to}`);
    const records = await recRes.json();

    html += `
      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <span class="card-title">${esc(emp.name)}</span>
          <span style="color:var(--muted);font-size:0.85rem">$${emp.daily_rate}/day &nbsp;|&nbsp; Deduction: <strong class="text-danger">$${emp.total_deduction.toFixed(2)}</strong></span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Break</th><th>Phone</th><th>Wasted</th><th>Late</th><th>Day Off</th><th>Manual Adj</th><th>Deduct (min)</th><th>Deduction</th><th>Notes</th>
              </tr>
            </thead>
            <tbody>
    `;

    records.forEach(r => {
      const adjSign = r.manual_adj_minutes > 0 ? '+' : '';
      html += `<tr${r.is_day_off ? ' class="day-off-row"' : ''}>
        <td>${r.record_date}</td>
        <td>${r.break_minutes}m${Math.max(0, r.break_minutes - ALLOWED_BREAK) > 0 ? ` <span class="badge badge-red">+${Math.max(0, r.break_minutes - ALLOWED_BREAK)}m</span>` : ''}</td>
        <td>${r.phone_minutes > 0 ? r.phone_minutes + 'm' : '–'}</td>
        <td>${r.wasted_minutes > 0 ? r.wasted_minutes + 'm' : '–'}</td>
        <td>${r.late_minutes > 0 ? r.late_minutes + 'm' : '–'}</td>
        <td>${r.is_day_off ? '<span class="badge badge-red">Yes</span>' : '–'}</td>
        <td>${r.manual_adj_minutes !== 0 ? `${adjSign}${r.manual_adj_minutes}m` : '–'}</td>
        <td><strong>${r.total_deductible_minutes}m</strong></td>
        <td class="${r.total_deduction > 0 ? 'text-danger' : ''}">$${r.total_deduction.toFixed(2)}</td>
        <td>${esc(r.notes || '') || '–'}</td>
      </tr>`;
    });

    html += `</tbody></table></div></div>`;
  }

  container.innerHTML = html;
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
      <td><span class="badge ${a.role === 'admin' ? 'badge-blue' : 'badge-grey'}">${a.role}</span></td>
      <td>${a.created_at.slice(0, 10)}</td>
      <td style="text-align:right">
        <button class="btn btn-ghost btn-sm" onclick="resetPw(${a.id})">Reset PW</button>
        <button class="btn btn-danger btn-sm" onclick="deleteAdmin(${a.id})">Remove</button>
      </td>
    `;
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw })
  });
  alert('Password updated');
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function today() { return new Date().toISOString().slice(0, 10); }
function formatDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}
function thisMonth() {
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
  const last = new Date(now.getFullYear(), now.getMonth()+1, 0);
  const to = last.toISOString().slice(0, 10);
  return { from, to };
}
function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
