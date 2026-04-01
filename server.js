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
  const { name, employment_type, annual_salary } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  // Derive daily rate from annual salary (260 working days/year)
  const annualSal = parseFloat(annual_salary) || 0;
  const daily_rate = parseFloat((annualSal / 260).toFixed(4));
  const { rows } = await q(
    'INSERT INTO employees (name, daily_rate, employment_type, annual_salary) VALUES (?, ?, ?, ?) RETURNING id',
    [name, daily_rate, employment_type || 'payroll', annualSal]
  );
  res.json({ id: rows[0].id, name, daily_rate });
});

app.put('/api/employees/:id', requireAuth, async (req, res) => {
  const { name, active, employment_type, annual_salary } = req.body;
  const annualSal = parseFloat(annual_salary) || 0;
  const daily_rate = parseFloat((annualSal / 260).toFixed(4));
  await q(
    'UPDATE employees SET name=?, daily_rate=?, active=?, employment_type=?, annual_salary=? WHERE id=?',
    [name, daily_rate, active !== undefined ? active : 1, employment_type || 'payroll', annualSal, req.params.id]
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
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const { rows: employees } = await q('SELECT * FROM employees WHERE active = 1 ORDER BY name');

  const overview = await Promise.all(employees.map(async emp => {
    const { rows: payments } = await q(
      'SELECT * FROM monthly_payments WHERE employee_id = ? AND payment_year = ? ORDER BY payment_month',
      [emp.id, year]
    );

    const allowance  = DAY_OFF_ALLOWANCE[emp.employment_type] || 20;
    const annualSal  = parseFloat(emp.annual_salary) || 0;
    const dayCalc    = await calcExcessDeductions(emp.id, year, annualSal, allowance);

    const { rows: officeRows } = await q(
      'SELECT * FROM office_deductions WHERE employee_id = ? ORDER BY deduction_date DESC',
      [emp.id]
    );
    const totalOffice = officeRows.reduce((a, b) => a + parseFloat(b.amount), 0);
    const totalPaid   = payments.reduce((a, b) => a + parseFloat(b.amount), 0);
    const netRemaining = parseFloat((annualSal - totalPaid - dayCalc.excess_deduction - totalOffice).toFixed(2));
    const pctPaid     = annualSal > 0 ? Math.min(100, Math.round((totalPaid / annualSal) * 100)) : 0;

    return {
      employee_id:       emp.id,
      name:              emp.name,
      employment_type:   emp.employment_type,
      annual_salary:     annualSal,
      payments,
      office_deductions: officeRows,
      total_office_deductions: parseFloat(totalOffice.toFixed(2)),
      total_paid:        parseFloat(totalPaid.toFixed(2)),
      total_days_off:    dayCalc.total_days_off,
      allowance_days:    allowance,
      excess_days:       dayCalc.excess_days,
      excess_deduction:  dayCalc.excess_deduction,
      breakdown:         dayCalc.breakdown,
      net_remaining:     netRemaining,
      pct_paid:          pctPaid
    };
  }));

  res.json(overview);
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

// ─── START ────────────────────────────────────────────────────────────────────

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Employee Time Tracker running on http://localhost:${PORT}`);
    console.log('Default login: admin / admin123');
  });
}
