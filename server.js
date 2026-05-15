const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { sql, initDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'lpgp-tracker-jwt-2024';

// Lazy init: retry on every request until it succeeds once, then skip forever.
let dbInitialized = false;
let dbInitPromise = null; // serialise concurrent first-request inits

async function ensureDb() {
  if (dbInitialized) return;
  // Only one concurrent init attempt at a time; reset on failure so next request can retry
  if (!dbInitPromise) {
    dbInitPromise = initDb()
      .then(() => { dbInitialized = true; })
      .catch(err => { dbInitPromise = null; throw err; });
  }
  await dbInitPromise;
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get('/', async (req, res, next) => {
  try {
    await ensureDb();
  } catch (err) {
    const hint = !(process.env.DATABASE_URL || process.env.POSTGRES_URL)
      ? '<p>In your <strong>Vercel dashboard</strong>: go to <strong>Storage → Create Database → Postgres</strong>, connect it to this project, then redeploy.</p>'
      : `<p>DB error: ${err.message}</p>`;
    return res.status(503).send(`<!DOCTYPE html><html><head><title>Setup Required</title>
      <style>body{font-family:sans-serif;max-width:600px;margin:80px auto;padding:20px}h1{color:#d93025}</style></head>
      <body><h1>Database Not Connected</h1>${hint}</body></html>`);
  }
  const token = req.cookies.token;
  if (!token) return res.redirect('/login.html');
  try { jwt.verify(token, JWT_SECRET); next(); } catch { res.redirect('/login.html'); }
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', async (req, res, next) => {
  try {
    await ensureDb();
    next();
  } catch (err) {
    const msg = !(process.env.DATABASE_URL || process.env.POSTGRES_URL)
      ? 'No database connected. In Vercel: Storage → Create Database → Postgres → connect project → redeploy.'
      : `Database connection failed: ${err.message}`;
    return res.status(503).json({ error: msg });
  }
});

function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

// neon() returns rows array directly; wrap in { rows } for consistent usage throughout
async function q(rawSql, params = []) {
  let i = 0;
  const pgSql = rawSql.replace(/\?/g, () => `$${++i}`);
  const rows = await sql(pgSql, params);
  return { rows };
}

// UK PAYE + NI + pension auto-calculation (2024/25 thresholds)
function calcUKNetPay(grossAnnual, pensionRate = 0) {
  const PERSONAL_ALLOWANCE = 12570;
  const BASIC_RATE_LIMIT   = 50270;
  const HIGHER_RATE_LIMIT  = 125140;
  const NI_PRIMARY = 12570;
  const NI_UPPER   = 50270;
  const PENSION_LOWER = 6240;
  const PENSION_UPPER = 50270;

  const taxable   = Math.max(0, grossAnnual - PERSONAL_ALLOWANCE);
  const basicTax  = Math.min(taxable, BASIC_RATE_LIMIT - PERSONAL_ALLOWANCE) * 0.20;
  const higherTax = Math.max(0, Math.min(taxable - (BASIC_RATE_LIMIT - PERSONAL_ALLOWANCE), HIGHER_RATE_LIMIT - BASIC_RATE_LIMIT)) * 0.40;
  const addlTax   = Math.max(0, taxable - (HIGHER_RATE_LIMIT - PERSONAL_ALLOWANCE)) * 0.45;
  const annualTax = basicTax + higherTax + addlTax;

  const ni1 = Math.min(Math.max(0, grossAnnual - NI_PRIMARY), NI_UPPER - NI_PRIMARY) * 0.08;
  const ni2 = Math.max(0, grossAnnual - NI_UPPER) * 0.02;
  const annualNI = ni1 + ni2;

  const qualifying    = Math.min(Math.max(0, grossAnnual - PENSION_LOWER), PENSION_UPPER - PENSION_LOWER);
  const annualPension = qualifying * ((pensionRate || 0) / 100);

  const netAnnual = grossAnnual - annualTax - annualNI - annualPension;
  return {
    income_tax:         parseFloat(annualTax.toFixed(2)),
    national_insurance: parseFloat(annualNI.toFixed(2)),
    pension:            parseFloat(annualPension.toFixed(2)),
    net_annual:         parseFloat(netAnnual.toFixed(2)),
    net_monthly:        parseFloat((netAnnual / 12).toFixed(2)),
    gross_monthly:      parseFloat((grossAnnual / 12).toFixed(2))
  };
}

const SHIFT_HOURS = 8;
const ALLOWED_BREAK_MINUTES = 40;
const DAY_OFF_ALLOWANCE = { payroll: 20, self_employed: 5 };

// Count Mon–Fri days in a given month (no bank holidays — add if needed)
function workingDaysInMonth(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    if (dow >= 1 && dow <= 5) count++;
  }
  return count;
}

// Count Mon–Fri days from startDay to endDay within a single month
function workingDaysInRange(year, month, startDay, endDay) {
  let count = 0;
  for (let d = startDay; d <= endDay; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    if (dow >= 1 && dow <= 5) count++;
  }
  return count;
}

// Calculate earned pay from startDate to endDate (defaults to today if null).
// If startDate is null, uses Jan 1 of the end year.
// Handles: pro-rated first month, full middle months, pro-rated last month.
function calcEarnedPay(annualSalary, startDateStr, endDateStr) {
  if (!annualSalary) return null;
  const end   = endDateStr   ? new Date(endDateStr)   : new Date();
  const start = startDateStr ? new Date(startDateStr) : new Date(end.getFullYear(), 0, 1);
  if (start > end) return null;

  const sY = start.getFullYear(), sM = start.getMonth() + 1, sD = start.getDate();
  const eY = end.getFullYear(),   eM = end.getMonth() + 1,   eD = end.getDate();
  const isSameMonth = sY === eY && sM === eM;

  if (isSameMonth) {
    const totalWD = workingDaysInMonth(sY, sM);
    const worked  = workingDaysInRange(sY, sM, sD, eD);
    const pay = totalWD > 0 ? parseFloat(((annualSalary / 12) * (worked / totalWD)).toFixed(2)) : 0;
    return { start_date: startDateStr, end_date: endDateStr,
             first_month: `${sY}-${String(sM).padStart(2,'0')}`,
             first_month_days: worked, first_month_total_days: totalWD, first_month_pay: pay,
             full_months_count: 0, full_months_pay: 0, last_month_pay: 0, total_expected: pay };
  }

  // First (partial) month
  const totalWDFirst = workingDaysInMonth(sY, sM);
  const wdFirst = workingDaysInRange(sY, sM, sD, new Date(sY, sM, 0).getDate());
  const firstPay = totalWDFirst > 0 ? parseFloat(((annualSalary / 12) * (wdFirst / totalWDFirst)).toFixed(2)) : 0;

  // Full months between first and last
  let fullCount = 0;
  let fy = sY, fm = sM + 1;
  if (fm > 12) { fm = 1; fy++; }
  while (fy < eY || (fy === eY && fm < eM)) { fullCount++; fm++; if (fm > 12) { fm = 1; fy++; } }
  const fullPay = parseFloat(((annualSalary / 12) * fullCount).toFixed(2));

  // Last (partial) month
  const totalWDLast = workingDaysInMonth(eY, eM);
  const wdLast = workingDaysInRange(eY, eM, 1, eD);
  const lastPay = totalWDLast > 0 ? parseFloat(((annualSalary / 12) * (wdLast / totalWDLast)).toFixed(2)) : 0;

  return {
    start_date:           startDateStr,
    end_date:             endDateStr,
    first_month:          `${sY}-${String(sM).padStart(2,'0')}`,
    first_month_days:     wdFirst,
    first_month_total_days: totalWDFirst,
    first_month_pay:      firstPay,
    full_months_count:    fullCount,
    full_months_pay:      fullPay,
    last_month_pay:       lastPay,
    total_expected:       parseFloat((firstPay + fullPay + lastPay).toFixed(2))
  };
}

// Convenience: earned pay from start_date to today (for active employees)
function calcProRatedPay(annualSalary, startDateStr) {
  return calcEarnedPay(annualSalary, startDateStr, null);
}

// Daily rate for a specific month: (annual ÷ 12) ÷ working days in that month
function dailyRateForMonth(annualSalary, year, month) {
  return (annualSalary / 12) / workingDaysInMonth(year, month);
}

// Walk day-off records in date order; first N days are free (allowance),
// excess days are charged at the daily rate of the month they fall in.
async function calcExcessDeductions(empId, year, annualSalary, allowance) {
  const { rows } = await q(`
    SELECT record_date::TEXT AS record_date, is_day_off
    FROM daily_records
    WHERE employee_id = ? AND EXTRACT(YEAR FROM record_date) = ? AND is_day_off > 0
    ORDER BY record_date ASC
  `, [empId, year]);

  let daysUsed = 0;
  let excessDays = 0;
  let totalDeduction = 0;
  const monthBreakdown = {};

  for (const r of rows) {
    const val = parseFloat(r.is_day_off);
    const freeRemaining = Math.max(0, allowance - daysUsed);
    const excessHere   = Math.max(0, val - freeRemaining);
    daysUsed += val;

    if (excessHere > 0) {
      const [y, m] = r.record_date.split('-').map(Number);
      const wDays  = workingDaysInMonth(y, m);
      const rate   = dailyRateForMonth(annualSalary, y, m);
      const amount = excessHere * rate;
      totalDeduction += amount;
      excessDays     += excessHere;

      const key = `${y}-${String(m).padStart(2, '0')}`;
      if (!monthBreakdown[key]) {
        monthBreakdown[key] = { year: y, month: m, working_days: wDays, rate: parseFloat(rate.toFixed(4)), days: 0, deduction: 0 };
      }
      monthBreakdown[key].days      += excessHere;
      monthBreakdown[key].deduction += amount;
    }
  }

  // Round deduction column in breakdown
  const breakdown = Object.values(monthBreakdown)
    .map(b => ({ ...b, deduction: parseFloat(b.deduction.toFixed(2)) }));

  return {
    total_days_off:   daysUsed,
    excess_days:      parseFloat(excessDays.toFixed(1)),
    excess_deduction: parseFloat(totalDeduction.toFixed(2)),
    breakdown
  };
}

// ─── AUTH ────────────────────────────────────────────────────────────────────

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const { rows } = await q('SELECT * FROM admins WHERE username = ?', [username]);
    const admin = rows[0];
    if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const token = jwt.sign(
      { id: admin.id, username: admin.username, role: admin.role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.cookie('token', token, { httpOnly: true, sameSite: 'strict', maxAge: 8 * 60 * 60 * 1000 });
    res.json({ success: true, role: admin.role, username: admin.username });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ username: req.admin.username, role: req.admin.role });
});

// ─── ADMINS ──────────────────────────────────────────────────────────────────

app.get('/api/admins', requireAuth, async (req, res) => {
  if (req.admin.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { rows } = await q('SELECT id, username, role, created_at FROM admins ORDER BY id');
  res.json(rows);
});

app.post('/api/admins', requireAuth, async (req, res) => {
  if (req.admin.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const hash = bcrypt.hashSync(password, 10);
  try {
    const { rows } = await q(
      'INSERT INTO admins (username, password_hash, role) VALUES (?, ?, ?) RETURNING id',
      [username, hash, role || 'manager']
    );
    res.json({ id: rows[0].id, username, role: role || 'manager' });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Username already exists' });
    throw e;
  }
});

app.delete('/api/admins/:id', requireAuth, async (req, res) => {
  if (req.admin.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  if (parseInt(req.params.id) === req.admin.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  await q('DELETE FROM admins WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

app.put('/api/admins/:id/password', requireAuth, async (req, res) => {
  if (req.admin.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  await q('UPDATE admins SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(password, 10), req.params.id]);
  res.json({ success: true });
});

// ─── EMPLOYEES ───────────────────────────────────────────────────────────────

app.get('/api/employees', requireAuth, async (req, res) => {
  const { rows } = await q('SELECT * FROM employees WHERE active = 1 ORDER BY name');
  res.json(rows);
});

app.get('/api/employees/all', requireAuth, async (req, res) => {
  const { rows } = await q('SELECT * FROM employees ORDER BY name');
  res.json(rows);
});

app.post('/api/employees', requireAuth, async (req, res) => {
  const { name, employment_type, annual_salary, currency, start_date, pension_rate,
          job_title, department, phone, email, contract_end_date } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const annualSal = parseFloat(annual_salary) || 0;
  const daily_rate = parseFloat((annualSal / 260).toFixed(4));
  const cur = ['GBP','AED'].includes(currency) ? currency : 'GBP';
  const pensionRate = (employment_type === 'payroll' && pension_rate != null && pension_rate !== '') ? parseFloat(pension_rate) : 0;
  const { rows } = await q(
    `INSERT INTO employees
       (name, daily_rate, employment_type, annual_salary, currency, start_date, pension_rate,
        job_title, department, phone, email, contract_end_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [name, daily_rate, employment_type || 'payroll', annualSal, cur, start_date || null, pensionRate,
     job_title || '', department || '', phone || '', email || '', contract_end_date || null]
  );
  res.json({ id: rows[0].id, name, daily_rate });
});

app.put('/api/employees/:id', requireAuth, async (req, res) => {
  const { name, active, employment_type, annual_salary, currency, salary_reason, salary_effective,
          start_date, pension_rate, job_title, department, phone, email, contract_end_date } = req.body;
  const annualSal = parseFloat(annual_salary) || 0;
  const daily_rate = parseFloat((annualSal / 260).toFixed(4));
  const cur = ['GBP','AED'].includes(currency) ? currency : 'GBP';
  const pensionRate = (employment_type === 'payroll' && pension_rate != null && pension_rate !== '') ? parseFloat(pension_rate) : 0;

  // If salary changed, log old salary to history before updating
  const { rows: current } = await q('SELECT annual_salary, currency FROM employees WHERE id = ?', [req.params.id]);
  if (current[0] && parseFloat(current[0].annual_salary) !== annualSal) {
    await q(
      'INSERT INTO salary_history (employee_id, annual_salary, currency, effective_from, reason, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [req.params.id, annualSal, cur,
       salary_effective || new Date().toISOString().slice(0,10),
       salary_reason || '',
       req.admin.id]
    );
  }

  await q(
    `UPDATE employees SET name=?, daily_rate=?, active=?, employment_type=?, annual_salary=?,
     currency=?, start_date=?, pension_rate=?,
     job_title=?, department=?, phone=?, email=?, contract_end_date=?
     WHERE id=?`,
    [name, daily_rate, active !== undefined ? active : 1, employment_type || 'payroll',
     annualSal, cur, start_date || null, pensionRate,
     job_title || '', department || '', phone || '', email || '',
     contract_end_date || null, req.params.id]
  );
  res.json({ success: true });
});

app.post('/api/employees/:id/terminate', requireAuth, async (req, res) => {
  const { termination_date, termination_reason } = req.body;
  if (!termination_date) return res.status(400).json({ error: 'termination_date required' });
  await q(
    'UPDATE employees SET active = 0, termination_date = ?, termination_reason = ? WHERE id = ?',
    [termination_date, termination_reason || '', req.params.id]
  );
  res.json({ success: true });
});

app.post('/api/employees/:id/reactivate', requireAuth, async (req, res) => {
  await q(
    'UPDATE employees SET active = 1, termination_date = NULL, termination_reason = NULL WHERE id = ?',
    [req.params.id]
  );
  res.json({ success: true });
});

app.delete('/api/employees/:id', requireAuth, async (req, res) => {
  await q('UPDATE employees SET active = 0 WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ─── YEAR STATS (days-off allowance) ─────────────────────────────────────────

app.get('/api/employees/:id/year-stats', requireAuth, async (req, res) => {
  const year = parseInt(req.query.year || new Date().getFullYear());
  const { rows: empRows } = await q('SELECT * FROM employees WHERE id = ?', [req.params.id]);
  if (!empRows[0]) return res.status(404).json({ error: 'Not found' });
  const emp = empRows[0];

  const allowance = DAY_OFF_ALLOWANCE[emp.employment_type] || 20;
  const annualSalary = parseFloat(emp.annual_salary) || 0;
  const calc = await calcExcessDeductions(req.params.id, year, annualSalary, allowance);

  res.json({
    year,
    total_days_off:     calc.total_days_off,
    allowance_days:     allowance,
    remaining_allowance: Math.max(0, allowance - calc.total_days_off),
    excess_days:        calc.excess_days,
    excess_deduction:   calc.excess_deduction,
    breakdown:          calc.breakdown,
    employment_type:    emp.employment_type
  });
});

// ─── DAILY RECORDS ───────────────────────────────────────────────────────────

// Time deductions (phone/late/wasted/break) are REFERENCE ONLY — never deducted from salary.
// Only day-off excess and office deductions affect actual salary balance.
function calcTimeReference(record, dailyRate) {
  const excessBreak = Math.max(0, record.break_minutes - ALLOWED_BREAK_MINUTES);
  const totalMins = excessBreak + record.phone_minutes + record.wasted_minutes + record.late_minutes;
  const ratePerMin = dailyRate / (SHIFT_HOURS * 60);
  return {
    ref_minutes: totalMins,
    ref_amount:  parseFloat((totalMins * ratePerMin).toFixed(2))
  };
}

app.get('/api/records/:employeeId', requireAuth, async (req, res) => {
  const { from, to } = req.query;
  let sql = `
    SELECT r.*, r.record_date::TEXT AS record_date,
      e.daily_rate, e.name AS employee_name, e.employment_type,
      COALESCE((SELECT SUM(a.adjustment_minutes)::INT FROM manual_adjustments a
                WHERE a.employee_id = r.employee_id AND a.record_date = r.record_date), 0) AS manual_adj
    FROM daily_records r
    JOIN employees e ON e.id = r.employee_id
    WHERE r.employee_id = ?
  `;
  const params = [req.params.employeeId];
  if (from) { sql += ' AND r.record_date >= ?'; params.push(from); }
  if (to)   { sql += ' AND r.record_date <= ?'; params.push(to); }
  sql += ' ORDER BY r.record_date DESC';

  const { rows } = await q(sql, params);
  const enriched = rows.map(r => {
    const dayOffVal = parseFloat(r.is_day_off) || 0;
    const ref = calcTimeReference(r, r.daily_rate);
    const adjMins = r.manual_adj || 0;
    return {
      ...r,
      is_day_off:          dayOffVal,
      day_off_label:       dayOffVal === 1 ? 'Full Day' : dayOffVal === 0.5 ? 'Half Day' : null,
      ref_minutes:         ref.ref_minutes + adjMins,
      ref_amount:          parseFloat((ref.ref_amount).toFixed(2)), // reference only, not deducted
      manual_adj_minutes:  adjMins
    };
  });
  res.json(enriched);
});

app.post('/api/records', requireAuth, async (req, res) => {
  const { employee_id, record_date, break_minutes, phone_minutes, wasted_minutes, late_minutes, is_day_off, notes } = req.body;
  if (!employee_id || !record_date) return res.status(400).json({ error: 'employee_id and record_date required' });
  const dayOffVal = parseFloat(is_day_off) || 0;
  try {
    const { rows } = await q(
      `INSERT INTO daily_records (employee_id, record_date, break_minutes, phone_minutes, wasted_minutes, late_minutes, is_day_off, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [employee_id, record_date, break_minutes || 0, phone_minutes || 0, wasted_minutes || 0,
       late_minutes || 0, dayOffVal, notes || '', req.admin.id]
    );
    res.json({ id: rows[0].id });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Record for this date already exists. Use edit to update.' });
    throw e;
  }
});

app.put('/api/records/:id', requireAuth, async (req, res) => {
  const { break_minutes, phone_minutes, wasted_minutes, late_minutes, is_day_off, notes } = req.body;
  const dayOffVal = parseFloat(is_day_off) || 0;
  await q(
    `UPDATE daily_records SET break_minutes=?, phone_minutes=?, wasted_minutes=?, late_minutes=?, is_day_off=?, notes=?, updated_at=NOW() WHERE id=?`,
    [break_minutes || 0, phone_minutes || 0, wasted_minutes || 0, late_minutes || 0, dayOffVal, notes || '', req.params.id]
  );
  res.json({ success: true });
});

app.delete('/api/records/:id', requireAuth, async (req, res) => {
  await q('DELETE FROM daily_records WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ─── MANUAL ADJUSTMENTS ──────────────────────────────────────────────────────

app.get('/api/adjustments/:employeeId', requireAuth, async (req, res) => {
  const { date } = req.query;
  let sql = `SELECT a.*, a.record_date::TEXT AS record_date, ad.username
             FROM manual_adjustments a LEFT JOIN admins ad ON ad.id = a.created_by
             WHERE a.employee_id = ?`;
  const params = [req.params.employeeId];
  if (date) { sql += ' AND a.record_date = ?'; params.push(date); }
  sql += ' ORDER BY a.created_at DESC';
  const { rows } = await q(sql, params);
  res.json(rows);
});

app.post('/api/adjustments', requireAuth, async (req, res) => {
  const { employee_id, record_date, adjustment_minutes, reason } = req.body;
  if (!employee_id || !record_date || adjustment_minutes === undefined || !reason)
    return res.status(400).json({ error: 'All fields required' });
  const { rows } = await q(
    'INSERT INTO manual_adjustments (employee_id, record_date, adjustment_minutes, reason, created_by) VALUES (?, ?, ?, ?, ?) RETURNING id',
    [employee_id, record_date, adjustment_minutes, reason, req.admin.id]
  );
  res.json({ id: rows[0].id });
});

app.delete('/api/adjustments/:id', requireAuth, async (req, res) => {
  await q('DELETE FROM manual_adjustments WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ─── MONTHLY PAYMENTS ────────────────────────────────────────────────────────

app.get('/api/payments/:employeeId', requireAuth, async (req, res) => {
  const { year } = req.query;
  let sql = 'SELECT * FROM monthly_payments WHERE employee_id = ?';
  const params = [req.params.employeeId];
  if (year) { sql += ' AND payment_year = ?'; params.push(year); }
  sql += ' ORDER BY payment_year DESC, payment_month DESC';
  const { rows } = await q(sql, params);
  res.json(rows);
});

app.post('/api/payments', requireAuth, async (req, res) => {
  const { employee_id, payment_year, payment_month, amount, notes } = req.body;
  if (!employee_id || !payment_year || !payment_month || !amount)
    return res.status(400).json({ error: 'employee_id, year, month, amount required' });
  const { rows } = await q(
    'INSERT INTO monthly_payments (employee_id, payment_year, payment_month, amount, notes, created_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    [employee_id, payment_year, payment_month, amount, notes || '', req.admin.id]
  );
  res.json({ id: rows[0].id });
});

app.delete('/api/payments/:id', requireAuth, async (req, res) => {
  await q('DELETE FROM monthly_payments WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ─── SALARY OVERVIEW ─────────────────────────────────────────────────────────

app.get('/api/salary-overview', requireAuth, async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    // Include terminated employees so their final summary still shows
    const { rows: employees } = await q('SELECT * FROM employees ORDER BY active DESC, name');

    const overview = await Promise.all(employees.map(async emp => {
      const { rows: payments } = await q(
        'SELECT * FROM monthly_payments WHERE employee_id = ? AND payment_year = ? ORDER BY payment_month',
        [emp.id, year]
      );

      const allowance  = DAY_OFF_ALLOWANCE[emp.employment_type] || 20;
      const annualSal  = parseFloat(emp.annual_salary) || 0;
      const dayCalc    = await calcExcessDeductions(emp.id, year, annualSal, allowance);

      const { rows: officeRows } = await q(
        'SELECT *, deduction_date::TEXT AS deduction_date FROM office_deductions WHERE employee_id = ? ORDER BY office_deductions.deduction_date DESC',
        [emp.id]
      );
      const { rows: bonusRows } = await q(
        'SELECT *, bonus_date::TEXT AS bonus_date FROM bonuses WHERE employee_id = ? ORDER BY bonuses.bonus_date DESC',
        [emp.id]
      );
      const { rows: salaryHistory } = await q(
        'SELECT *, effective_from::TEXT AS effective_from FROM salary_history WHERE employee_id = ? ORDER BY salary_history.effective_from DESC, created_at DESC',
        [emp.id]
      );

      const startDateStr       = emp.start_date        ? emp.start_date.toISOString().slice(0,10)        : null;
      const terminationDateStr = emp.termination_date  ? emp.termination_date.toISOString().slice(0,10)  : null;
      const isTerminated       = !emp.active && !!terminationDateStr;

      // Pro-rated only applies if the employee started THIS year (not in a previous year)
      const startedThisYear = startDateStr && startDateStr.startsWith(String(year));

      // For terminated employees: earned = pro-rated from start to termination date
      // For active employees who started this year: show pro-rated reference (start → today)
      // For all others: full annual salary is the target, no pro-rated reference
      const earnedPay = isTerminated
        ? calcEarnedPay(annualSal, startDateStr, terminationDateStr)
        : (startedThisYear ? calcProRatedPay(annualSal, startDateStr) : null);

      // First-month full payment: start date → end of start month (regardless of today)
      // Used to show "how much to pay at end of first month" for mid-month starters
      let firstMonthFull = null;
      if (!isTerminated && startedThisYear && startDateStr) {
        const [fY, fM] = startDateStr.split('-').map(Number);
        const lastDay = new Date(fY, fM, 0).getDate();
        const eomStr = `${fY}-${String(fM).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
        firstMonthFull = calcEarnedPay(annualSal, startDateStr, eomStr);
      }

      // Salary target for this year:
      //   terminated  → earned from start to termination date
      //   started this year (active) → pro-rated from start date to Dec 31 of this year
      //   otherwise   → full annual salary
      let salaryTarget = annualSal;
      if (isTerminated) {
        salaryTarget = earnedPay?.total_expected ?? annualSal;
      } else if (startedThisYear) {
        const yearEnd = calcEarnedPay(annualSal, startDateStr, `${year}-12-31`);
        salaryTarget = yearEnd?.total_expected ?? annualSal;
      }

      // Auto-calculate UK PAYE + NI + pension for payroll employees
      const ukPay = emp.employment_type === 'payroll' && annualSal > 0
        ? calcUKNetPay(annualSal, parseFloat(emp.pension_rate) || 0)
        : null;
      const netFactor       = ukPay ? ukPay.net_annual / annualSal : 1;
      const netSalaryTarget = parseFloat((salaryTarget * netFactor).toFixed(2));
      const netMonthly      = ukPay ? ukPay.net_monthly : null;

      const totalOffice   = officeRows.reduce((a, b) => a + parseFloat(b.amount), 0);
      const totalPaid     = payments.reduce((a, b) => a + parseFloat(b.amount), 0);
      const netRemaining  = parseFloat((netSalaryTarget - totalPaid - dayCalc.excess_deduction - totalOffice).toFixed(2));
      const pctPaid       = netSalaryTarget > 0 ? Math.min(100, Math.round((totalPaid / netSalaryTarget) * 100)) : 0;

      return {
        employee_id:         emp.id,
        name:                emp.name,
        job_title:           emp.job_title || '',
        department:          emp.department || '',
        phone:               emp.phone || '',
        email:               emp.email || '',
        contract_end_date:   emp.contract_end_date ? emp.contract_end_date.toISOString().slice(0,10) : null,
        employment_type:     emp.employment_type,
        currency:            emp.currency || 'GBP',
        annual_salary:       annualSal,
        pension_rate:        parseFloat(emp.pension_rate) || 0,
        paye_breakdown:      ukPay,
        net_monthly:         netMonthly,
        salary_target:       netSalaryTarget,
        active:              emp.active ? 1 : 0,
        start_date:          startDateStr,
        termination_date:    terminationDateStr,
        termination_reason:  emp.termination_reason || '',
        is_terminated:       isTerminated,
        earned_to_date:      isTerminated ? earnedPay?.total_expected ?? annualSal : null,
        pro_rated:           !isTerminated ? earnedPay : null,
        first_month_full:    firstMonthFull,
        earned_breakdown:    isTerminated ? earnedPay : null,
        salary_history:      salaryHistory,
        payments,
        bonuses:             bonusRows,
        total_bonuses:       parseFloat(bonusRows.reduce((a, b) => a + parseFloat(b.amount), 0).toFixed(2)),
        office_deductions:   officeRows,
        total_office_deductions: parseFloat(totalOffice.toFixed(2)),
        total_paid:          parseFloat(totalPaid.toFixed(2)),
        total_days_off:      dayCalc.total_days_off,
        allowance_days:      allowance,
        excess_days:         dayCalc.excess_days,
        excess_deduction:    dayCalc.excess_deduction,
        breakdown:           dayCalc.breakdown,
        net_remaining:       netRemaining,
        pct_paid:            pctPaid
      };
    }));

    res.json(overview);
  } catch (e) {
    console.error('/api/salary-overview error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── CALENDAR ────────────────────────────────────────────────────────────────

app.get('/api/calendar', requireAuth, async (req, res) => {
  const year  = parseInt(req.query.year)  || new Date().getFullYear();
  const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
  const from  = `${year}-${String(month).padStart(2,'0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to    = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;

  const { rows } = await q(`
    SELECT r.record_date::TEXT AS record_date, r.is_day_off, r.notes, r.id AS record_id,
           e.id AS employee_id, e.name AS employee_name, e.employment_type
    FROM daily_records r
    JOIN employees e ON e.id = r.employee_id
    WHERE r.record_date >= ? AND r.record_date <= ? AND r.is_day_off > 0
    ORDER BY r.record_date, e.name
  `, [from, to]);

  res.json(rows);
});

// ─── SUMMARY REPORT ──────────────────────────────────────────────────────────

app.get('/api/summary', requireAuth, async (req, res) => {
  const { from, to } = req.query;
  const year = from ? from.slice(0, 4) : new Date().getFullYear();
  const { rows: employees } = await q('SELECT * FROM employees WHERE active = 1 ORDER BY name');

  const summary = await Promise.all(employees.map(async emp => {
    let sql = `
      SELECT r.*, r.record_date::TEXT AS record_date,
        COALESCE((SELECT SUM(a.adjustment_minutes)::INT FROM manual_adjustments a
                  WHERE a.employee_id = r.employee_id AND a.record_date = r.record_date), 0) AS manual_adj
      FROM daily_records r WHERE r.employee_id = ?
    `;
    const params = [emp.id];
    if (from) { sql += ' AND r.record_date >= ?'; params.push(from); }
    if (to)   { sql += ' AND r.record_date <= ?'; params.push(to); }
    const { rows: records } = await q(sql, params);

    // Year-level day-off stats (per-month daily rate)
    const allowance = DAY_OFF_ALLOWANCE[emp.employment_type] || 20;
    const annualSal = parseFloat(emp.annual_salary) || 0;
    const dayCalc = await calcExcessDeductions(emp.id, year, annualSal, allowance);
    const totalYearDaysOff = dayCalc.total_days_off;
    const excessDays = dayCalc.excess_days;
    const excessDayDeduction = dayCalc.excess_deduction;

    // Period totals — time items are reference only, never deducted from salary
    let refMins = 0, refAmount = 0, periodDaysOff = 0;
    records.forEach(r => {
      const ref = calcTimeReference(r, emp.daily_rate);
      refMins   += ref.ref_minutes + (r.manual_adj || 0);
      refAmount += ref.ref_amount;
      if (parseFloat(r.is_day_off) > 0) periodDaysOff += parseFloat(r.is_day_off);
    });

    // Salary / payment summary
    const { rows: payRows } = await q(
      'SELECT COALESCE(SUM(amount), 0) AS total_paid FROM monthly_payments WHERE employee_id = ? AND payment_year = ?',
      [emp.id, year]
    );
    const { rows: offRows } = await q(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM office_deductions WHERE employee_id = ?',
      [emp.id]
    );
    const totalPaid    = parseFloat(payRows[0].total_paid) || 0;
    const totalOffice  = parseFloat(offRows[0].total) || 0;
    const remaining    = parseFloat((parseFloat(emp.annual_salary) - totalPaid - excessDayDeduction - totalOffice).toFixed(2));

    return {
      employee_id:          emp.id,
      name:                 emp.name,
      employment_type:      emp.employment_type,
      daily_rate:           emp.daily_rate,
      annual_salary:        emp.annual_salary,
      record_count:         records.length,
      period_days_off:      periodDaysOff,
      ref_minutes:          refMins,
      ref_time_amount:      parseFloat(refAmount.toFixed(2)), // reference only
      year_days_off:        totalYearDaysOff,
      allowance_days:       allowance,
      excess_days:          excessDays,
      excess_day_deduction: excessDayDeduction,
      office_deductions:    totalOffice,
      total_deduction:      parseFloat((excessDayDeduction + totalOffice).toFixed(2)), // actual deductions only
      total_paid_year:      totalPaid,
      salary_remaining:     remaining
    };
  }));

  res.json(summary);
});

// ─── OFFICE DEDUCTIONS ───────────────────────────────────────────────────────

app.get('/api/office-deductions/:employeeId', requireAuth, async (req, res) => {
  const { rows } = await q(
    `SELECT od.*, od.deduction_date::TEXT AS deduction_date, ad.username AS created_by_name
     FROM office_deductions od LEFT JOIN admins ad ON ad.id = od.created_by
     WHERE od.employee_id = ? ORDER BY od.deduction_date DESC, od.created_at DESC`,
    [req.params.employeeId]
  );
  res.json(rows);
});

app.post('/api/office-deductions', requireAuth, async (req, res) => {
  const { employee_id, description, amount, deduction_date, notes } = req.body;
  if (!employee_id || !description || !amount)
    return res.status(400).json({ error: 'employee_id, description and amount required' });
  const { rows } = await q(
    'INSERT INTO office_deductions (employee_id, description, amount, deduction_date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    [employee_id, description, amount, deduction_date || new Date().toISOString().slice(0,10), notes || '', req.admin.id]
  );
  res.json({ id: rows[0].id });
});

app.delete('/api/office-deductions/:id', requireAuth, async (req, res) => {
  await q('DELETE FROM office_deductions WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ─── BONUSES ─────────────────────────────────────────────────────────────────

app.get('/api/bonuses/:employeeId', requireAuth, async (req, res) => {
  const { rows } = await q(
    'SELECT *, bonus_date::TEXT AS bonus_date FROM bonuses WHERE employee_id = ? ORDER BY bonuses.bonus_date DESC',
    [req.params.employeeId]
  );
  res.json(rows);
});

app.post('/api/bonuses', requireAuth, async (req, res) => {
  const { employee_id, amount, bonus_date, reason, notes } = req.body;
  if (!employee_id || !amount)
    return res.status(400).json({ error: 'employee_id and amount required' });
  const { rows } = await q(
    'INSERT INTO bonuses (employee_id, amount, bonus_date, reason, notes, created_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    [employee_id, amount, bonus_date || new Date().toISOString().slice(0,10), reason || '', notes || '', req.admin.id]
  );
  res.json({ id: rows[0].id });
});

app.delete('/api/bonuses/:id', requireAuth, async (req, res) => {
  await q('DELETE FROM bonuses WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ─── SALARY HISTORY ──────────────────────────────────────────────────────────

app.get('/api/salary-history/:employeeId', requireAuth, async (req, res) => {
  const { rows } = await q(
    `SELECT sh.*, sh.effective_from::TEXT AS effective_from, ad.username AS created_by_name
     FROM salary_history sh LEFT JOIN admins ad ON ad.id = sh.created_by
     WHERE sh.employee_id = ? ORDER BY sh.effective_from DESC, sh.created_at DESC`,
    [req.params.employeeId]
  );
  res.json(rows);
});

app.post('/api/salary-history', requireAuth, async (req, res) => {
  const { employee_id, annual_salary, currency, effective_from, reason } = req.body;
  if (!employee_id || !annual_salary) return res.status(400).json({ error: 'employee_id and annual_salary required' });
  const cur = ['GBP','AED'].includes(currency) ? currency : 'GBP';
  const { rows } = await q(
    'INSERT INTO salary_history (employee_id, annual_salary, currency, effective_from, reason, created_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    [employee_id, parseFloat(annual_salary), cur, effective_from || new Date().toISOString().slice(0,10), reason || '', req.admin.id]
  );
  res.json({ id: rows[0].id });
});

app.delete('/api/salary-history/:id', requireAuth, async (req, res) => {
  await q('DELETE FROM salary_history WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ─── CALENDAR REMINDERS ──────────────────────────────────────────────────────

function expandReminders(rows, year, month) {
  const from = `${year}-${String(month).padStart(2,'0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
  const results = [];
  rows.forEach(r => {
    const baseDate = r.reminder_date;
    const [,, bD] = baseDate.split('-').map(Number);
    const bM = parseInt(baseDate.split('-')[1]);
    if (r.recurrence === 'none') {
      if (baseDate >= from && baseDate <= to) results.push({ ...r, virtual_date: baseDate });
    } else if (r.recurrence === 'monthly') {
      const daysInMonth = new Date(year, month, 0).getDate();
      const day = Math.min(bD, daysInMonth);
      results.push({ ...r, virtual_date: `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}` });
    } else if (r.recurrence === 'yearly' && bM === month) {
      const daysInMonth = new Date(year, month, 0).getDate();
      const day = Math.min(bD, daysInMonth);
      results.push({ ...r, virtual_date: `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}` });
    }
  });
  return results;
}

app.get('/api/calendar-reminders/upcoming', requireAuth, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const future = new Date(today); future.setDate(future.getDate() + days);
    const futureStr = future.toISOString().slice(0, 10);
    const { rows } = await q('SELECT id, title, reminder_date::TEXT AS reminder_date, recurrence, category, amount, currency, notes, created_by, created_at FROM calendar_reminders ORDER BY reminder_date');
    const upcoming = [];
    rows.forEach(r => {
      const [, bM, bD] = r.reminder_date.split('-').map(Number);
      for (let offset = 0; offset <= 1; offset++) {
        const d = new Date(today); d.setMonth(d.getMonth() + offset);
        const cY = d.getFullYear(), cM = d.getMonth() + 1;
        if (r.recurrence === 'none') {
          if (r.reminder_date >= todayStr && r.reminder_date <= futureStr)
            upcoming.push({ ...r, virtual_date: r.reminder_date });
        } else if (r.recurrence === 'monthly') {
          const dim = new Date(cY, cM, 0).getDate();
          const vd = `${cY}-${String(cM).padStart(2,'0')}-${String(Math.min(bD, dim)).padStart(2,'0')}`;
          if (vd >= todayStr && vd <= futureStr) upcoming.push({ ...r, virtual_date: vd });
        } else if (r.recurrence === 'yearly' && bM === cM) {
          const dim = new Date(cY, cM, 0).getDate();
          const vd = `${cY}-${String(cM).padStart(2,'0')}-${String(Math.min(bD, dim)).padStart(2,'0')}`;
          if (vd >= todayStr && vd <= futureStr) upcoming.push({ ...r, virtual_date: vd });
        }
      }
    });
    const seen = new Set();
    const deduped = upcoming.filter(r => { const k = `${r.id}:${r.virtual_date}`; if (seen.has(k)) return false; seen.add(k); return true; });
    deduped.sort((a, b) => a.virtual_date.localeCompare(b.virtual_date));
    res.json(deduped);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/calendar-reminders', requireAuth, async (req, res) => {
  try {
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
    const { rows } = await q('SELECT id, title, reminder_date::TEXT AS reminder_date, recurrence, category, amount, currency, notes, created_by, created_at FROM calendar_reminders ORDER BY reminder_date');
    res.json(expandReminders(rows, year, month));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/calendar-reminders', requireAuth, async (req, res) => {
  try {
    const { title, reminder_date, recurrence, category, amount, currency, notes } = req.body;
    if (!title || !reminder_date) return res.status(400).json({ error: 'title and reminder_date required' });
    const rec = ['none','monthly','yearly'].includes(recurrence) ? recurrence : 'none';
    const cat = ['rent','subscription','deposit','utility','other'].includes(category) ? category : 'other';
    const cur = ['GBP','AED'].includes(currency) ? currency : 'GBP';
    const { rows } = await q(
      'INSERT INTO calendar_reminders (title, reminder_date, recurrence, category, amount, currency, notes, created_by) VALUES (?,?,?,?,?,?,?,?) RETURNING id',
      [title, reminder_date, rec, cat, amount || null, cur, notes || '', req.admin.id]
    );
    res.json({ id: rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/calendar-reminders/:id', requireAuth, async (req, res) => {
  try {
    await q('DELETE FROM calendar_reminders WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── EMPLOYEE NOTES ──────────────────────────────────────────────────────────

app.get('/api/employee-notes/:employeeId', requireAuth, async (req, res) => {
  try {
    const { rows } = await q(
      `SELECT en.*, ad.username AS created_by_name
       FROM employee_notes en
       LEFT JOIN admins ad ON ad.id = en.created_by
       WHERE en.employee_id = ?
       ORDER BY en.created_at DESC`,
      [req.params.employeeId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/employee-notes', requireAuth, async (req, res) => {
  try {
    const { employee_id, note, note_type } = req.body;
    if (!employee_id || !note) return res.status(400).json({ error: 'employee_id and note required' });
    const validTypes = ['general','performance','hr','warning'];
    const type = validTypes.includes(note_type) ? note_type : 'general';
    const { rows } = await q(
      'INSERT INTO employee_notes (employee_id, note, note_type, created_by) VALUES (?,?,?,?) RETURNING id',
      [employee_id, note, type, req.admin.id]
    );
    res.json({ id: rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/employee-notes/:id', requireAuth, async (req, res) => {
  try {
    await q('DELETE FROM employee_notes WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── CONTRACTS EXPIRING ───────────────────────────────────────────────────────

app.get('/api/contracts/expiring', requireAuth, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const today = new Date().toISOString().slice(0, 10);
    const future = new Date(); future.setDate(future.getDate() + days);
    const futureStr = future.toISOString().slice(0, 10);
    const { rows } = await q(
      `SELECT id, name, job_title, department, contract_end_date::TEXT AS contract_end_date
       FROM employees
       WHERE active = 1 AND contract_end_date IS NOT NULL
         AND contract_end_date <= ?
       ORDER BY contract_end_date ASC`,
      [futureStr]
    );
    res.json(rows.map(r => ({ ...r, expired: r.contract_end_date < today })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── PAYROLL CSV EXPORT ───────────────────────────────────────────────────────

app.get('/api/export/payroll-csv', requireAuth, async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const { rows: employees } = await q('SELECT * FROM employees WHERE active = 1 ORDER BY department, name');

    const rows = await Promise.all(employees.map(async emp => {
      const annualSal = parseFloat(emp.annual_salary) || 0;
      const { rows: payments } = await q(
        'SELECT SUM(amount) AS total FROM monthly_payments WHERE employee_id = ? AND payment_year = ?',
        [emp.id, year]
      );
      const totalPaid = parseFloat(payments[0]?.total || 0);
      const ukPay = emp.employment_type === 'payroll' && annualSal > 0
        ? calcUKNetPay(annualSal, parseFloat(emp.pension_rate) || 0) : null;
      const netMonthly = ukPay ? ukPay.net_monthly : annualSal / 12;
      const grossMonthly = ukPay ? ukPay.gross_monthly : annualSal / 12;
      const outstanding = parseFloat(emp.employment_type === 'payroll' && ukPay
        ? (ukPay.net_annual - totalPaid).toFixed(2)
        : (annualSal - totalPaid).toFixed(2));
      return {
        name: emp.name,
        department: emp.department || '',
        job_title: emp.job_title || '',
        employment_type: emp.employment_type,
        currency: emp.currency || 'GBP',
        annual_salary: annualSal,
        gross_monthly: parseFloat(grossMonthly.toFixed(2)),
        net_monthly: parseFloat(netMonthly.toFixed(2)),
        income_tax_yr: ukPay ? ukPay.income_tax : 0,
        ni_yr: ukPay ? ukPay.national_insurance : 0,
        pension_yr: ukPay ? ukPay.pension : 0,
        total_paid: totalPaid,
        outstanding
      };
    }));

    const headers = ['Name','Department','Job Title','Type','Currency','Annual Salary',
      'Gross/Month','Net/Month','Income Tax/Yr','NI/Yr','Pension/Yr','Total Paid','Outstanding'];
    const escape = v => `"${String(v).replace(/"/g,'""')}"`;
    const csv = [
      headers.map(escape).join(','),
      ...rows.map(r => [
        r.name, r.department, r.job_title, r.employment_type, r.currency,
        r.annual_salary, r.gross_monthly, r.net_monthly,
        r.income_tax_yr, r.ni_yr, r.pension_yr,
        r.total_paid, r.outstanding
      ].map(escape).join(','))
    ].join('\r\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="payroll-${year}.csv"`);
    res.send(csv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── GLOBAL ERROR HANDLER ────────────────────────────────────────────────────
// Catches any unhandled async errors thrown in routes (e.g. DB failures)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled route error:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ─── START ────────────────────────────────────────────────────────────────────

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Employee Time Tracker running on http://localhost:${PORT}`);
    console.log('Default login: admin / admin123');
  });
}
