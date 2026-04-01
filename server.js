const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { sql, initDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'lpgp-tracker-jwt-2024';

let dbInitError = null;
const dbReady = initDb().catch(err => {
  console.error('DB init failed:', err.message);
  dbInitError = err;
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get('/', async (req, res, next) => {
  await dbReady;
  if (dbInitError) {
    const hint = !(process.env.DATABASE_URL || process.env.POSTGRES_URL)
      ? '<p>In your <strong>Vercel dashboard</strong>: go to <strong>Storage → Create Database → Postgres</strong>, connect it to this project, then redeploy.</p>'
      : `<p>DB error: ${dbInitError.message}</p>`;
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
  await dbReady;
  if (dbInitError) {
    const msg = !(process.env.DATABASE_URL || process.env.POSTGRES_URL)
      ? 'No database connected. In Vercel: Storage → Create Database → Postgres → connect project → redeploy.'
      : `Database connection failed: ${dbInitError.message}`;
    return res.status(503).json({ error: msg });
  }
  next();
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
  const year = req.query.year || new Date().getFullYear();
  const { rows: empRows } = await q('SELECT * FROM employees WHERE id = ?', [req.params.id]);
  if (!empRows[0]) return res.status(404).json({ error: 'Not found' });
  const emp = empRows[0];

  const { rows } = await q(`
    SELECT COALESCE(SUM(is_day_off), 0) AS total_days_off
    FROM daily_records
    WHERE employee_id = ? AND EXTRACT(YEAR FROM record_date) = ?
  `, [req.params.id, year]);

  const totalDaysOff = parseFloat(rows[0].total_days_off) || 0;
  const allowance = DAY_OFF_ALLOWANCE[emp.employment_type] || 20;
  const excessDays = Math.max(0, totalDaysOff - allowance);

  res.json({
    year: parseInt(year),
    total_days_off: totalDaysOff,
    allowance,
    remaining_allowance: Math.max(0, allowance - totalDaysOff),
    excess_days: excessDays,
    excess_deduction: parseFloat((excessDays * emp.daily_rate).toFixed(2)),
    employment_type: emp.employment_type
  });
});

// ─── DAILY RECORDS ───────────────────────────────────────────────────────────

function calcTimeDeduction(record, dailyRate) {
  const excessBreak = Math.max(0, record.break_minutes - ALLOWED_BREAK_MINUTES);
  const deductibleMins = excessBreak + record.phone_minutes + record.wasted_minutes + record.late_minutes;
  const ratePerMin = dailyRate / (SHIFT_HOURS * 60);
  return {
    deductible_minutes: deductibleMins,
    deduction_amount: parseFloat((deductibleMins * ratePerMin).toFixed(2))
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
    const calc = calcTimeDeduction(r, r.daily_rate);
    const adjMins = r.manual_adj || 0;
    const totalDeductMins = calc.deductible_minutes + adjMins;
    const ratePerMin = r.daily_rate / (SHIFT_HOURS * 60);
    return {
      ...r,
      is_day_off: dayOffVal,
      day_off_label: dayOffVal === 1 ? 'Full Day' : dayOffVal === 0.5 ? 'Half Day' : null,
      deductible_minutes: calc.deductible_minutes,
      deduction_amount: calc.deduction_amount,
      manual_adj_minutes: adjMins,
      total_deductible_minutes: totalDeductMins,
      total_deduction: parseFloat((totalDeductMins * ratePerMin).toFixed(2))
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

    // Year-level day-off stats
    const { rows: yearRows } = await q(`
      SELECT COALESCE(SUM(is_day_off), 0) AS total_days_off
      FROM daily_records WHERE employee_id = ? AND EXTRACT(YEAR FROM record_date) = ?
    `, [emp.id, year]);
    const totalYearDaysOff = parseFloat(yearRows[0].total_days_off) || 0;
    const allowance = DAY_OFF_ALLOWANCE[emp.employment_type] || 20;
    const excessDays = Math.max(0, totalYearDaysOff - allowance);
    const excessDayDeduction = parseFloat((excessDays * emp.daily_rate).toFixed(2));

    // Period totals (time-based only)
    let totalDeductMins = 0;
    let totalTimeDeduction = 0;
    let periodDaysOff = 0;
    records.forEach(r => {
      const calc = calcTimeDeduction(r, emp.daily_rate);
      const totalMin = calc.deductible_minutes + (r.manual_adj || 0);
      totalDeductMins += totalMin;
      totalTimeDeduction += totalMin * (emp.daily_rate / (SHIFT_HOURS * 60));
      if (parseFloat(r.is_day_off) > 0) periodDaysOff += parseFloat(r.is_day_off);
    });

    // Salary / payment summary
    const { rows: payRows } = await q(
      'SELECT COALESCE(SUM(amount), 0) AS total_paid FROM monthly_payments WHERE employee_id = ? AND payment_year = ?',
      [emp.id, year]
    );
    const totalPaid = parseFloat(payRows[0].total_paid) || 0;
    const remaining = parseFloat((emp.annual_salary - totalPaid).toFixed(2));

    return {
      employee_id: emp.id,
      name: emp.name,
      employment_type: emp.employment_type,
      daily_rate: emp.daily_rate,
      annual_salary: emp.annual_salary,
      record_count: records.length,
      period_days_off: periodDaysOff,
      total_deductible_minutes: totalDeductMins,
      total_time_deduction: parseFloat(totalTimeDeduction.toFixed(2)),
      year_days_off: totalYearDaysOff,
      allowance_days: allowance,
      excess_days: excessDays,
      excess_day_deduction: excessDayDeduction,
      total_deduction: parseFloat((totalTimeDeduction + excessDayDeduction).toFixed(2)),
      total_paid_year: totalPaid,
      salary_remaining: remaining
    };
  }));

  res.json(summary);
});

// ─── START ────────────────────────────────────────────────────────────────────

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Employee Time Tracker running on http://localhost:${PORT}`);
    console.log('Default login: admin / admin123');
  });
}
