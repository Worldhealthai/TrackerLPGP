const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { pool, initDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'lpgp-tracker-jwt-2024';

// Initialize DB once; promise is reused across requests in the same instance
// NOTE: Do NOT call process.exit() here — it kills the serverless function
let dbInitError = null;
const dbReady = initDb().catch(err => {
  console.error('DB init failed:', err.message);
  dbInitError = err;
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Redirect unauthenticated root requests to login
app.get('/', async (req, res, next) => {
  // Show a setup page if DB isn't configured yet
  await dbReady;
  if (dbInitError) {
    const hint = !process.env.DATABASE_URL
      ? '<p>Set the <strong>DATABASE_URL</strong> environment variable in Vercel → Project Settings → Environment Variables, then redeploy.</p>'
      : `<p>DB error: ${dbInitError.message}</p>`;
    return res.status(503).send(`<!DOCTYPE html><html><head><title>Setup Required</title>
      <style>body{font-family:sans-serif;max-width:600px;margin:80px auto;padding:20px}
      h1{color:#d93025}code{background:#f1f3f4;padding:2px 8px;border-radius:4px}</style></head>
      <body><h1>Database Not Connected</h1>${hint}
      <p>In your <strong>Vercel dashboard</strong>: go to <strong>Storage → Create Database → Postgres</strong>, connect it to this project, then redeploy.</p>
      </body></html>`);
  }
  const token = req.cookies.token;
  if (!token) return res.redirect('/login.html');
  try { jwt.verify(token, JWT_SECRET); next(); } catch { res.redirect('/login.html'); }
});

app.use(express.static(path.join(__dirname, 'public')));

// Wait for DB init before handling any API request
app.use('/api', async (req, res, next) => {
  await dbReady;
  if (dbInitError) {
    const msg = !(process.env.DATABASE_URL || process.env.POSTGRES_URL)
      ? 'No database connected. In Vercel: go to Storage → Create Database → Postgres → connect to this project → redeploy.'
      : `Database connection failed: ${dbInitError.message}`;
    return res.status(503).json({ error: msg });
  }
  next();
});

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────

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

// Helper: run a parameterised query using ? placeholders (auto-converts to $1, $2…)
function q(sql, params = []) {
  let i = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++i}`);
  return pool.query(pgSql, params);
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

// ─── ADMINS (admin only) ─────────────────────────────────────────────────────

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
  if (parseInt(req.params.id) === req.admin.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  await q('DELETE FROM admins WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

app.put('/api/admins/:id/password', requireAuth, async (req, res) => {
  if (req.admin.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  const hash = bcrypt.hashSync(password, 10);
  await q('UPDATE admins SET password_hash = ? WHERE id = ?', [hash, req.params.id]);
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
  const { name, daily_rate } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const { rows } = await q(
    'INSERT INTO employees (name, daily_rate) VALUES (?, ?) RETURNING id',
    [name, daily_rate || 0]
  );
  res.json({ id: rows[0].id, name, daily_rate: daily_rate || 0 });
});

app.put('/api/employees/:id', requireAuth, async (req, res) => {
  const { name, daily_rate, active } = req.body;
  await q('UPDATE employees SET name = ?, daily_rate = ?, active = ? WHERE id = ?',
    [name, daily_rate, active !== undefined ? active : 1, req.params.id]);
  res.json({ success: true });
});

app.delete('/api/employees/:id', requireAuth, async (req, res) => {
  await q('UPDATE employees SET active = 0 WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ─── DAILY RECORDS ───────────────────────────────────────────────────────────

const SHIFT_HOURS = 8;
const ALLOWED_BREAK_MINUTES = 40;

function calcDeduction(record, dailyRate) {
  if (record.is_day_off) {
    return { deductible_minutes: SHIFT_HOURS * 60, deduction_amount: dailyRate };
  }
  const excessBreak = Math.max(0, record.break_minutes - ALLOWED_BREAK_MINUTES);
  const deductible = excessBreak + record.phone_minutes + record.wasted_minutes + record.late_minutes;
  const ratePerMinute = dailyRate / (SHIFT_HOURS * 60);
  return {
    deductible_minutes: deductible,
    deduction_amount: parseFloat((deductible * ratePerMinute).toFixed(2))
  };
}

app.get('/api/records/:employeeId', requireAuth, async (req, res) => {
  const { from, to } = req.query;
  let sql = `
    SELECT r.*,
      r.record_date::TEXT AS record_date,
      e.daily_rate,
      e.name AS employee_name,
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
    const calc = calcDeduction(r, r.daily_rate);
    const totalDeductMinutes = calc.deductible_minutes + (r.manual_adj || 0);
    const ratePerMin = r.daily_rate / (SHIFT_HOURS * 60);
    return {
      ...r,
      ...calc,
      manual_adj_minutes: r.manual_adj || 0,
      total_deductible_minutes: totalDeductMinutes,
      total_deduction: parseFloat((totalDeductMinutes * ratePerMin).toFixed(2))
    };
  });
  res.json(enriched);
});

app.post('/api/records', requireAuth, async (req, res) => {
  const { employee_id, record_date, break_minutes, phone_minutes, wasted_minutes, late_minutes, is_day_off, notes } = req.body;
  if (!employee_id || !record_date) return res.status(400).json({ error: 'employee_id and record_date required' });
  try {
    const { rows } = await q(
      `INSERT INTO daily_records
         (employee_id, record_date, break_minutes, phone_minutes, wasted_minutes, late_minutes, is_day_off, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [employee_id, record_date, break_minutes || 0, phone_minutes || 0, wasted_minutes || 0,
       late_minutes || 0, is_day_off ? 1 : 0, notes || '', req.admin.id]
    );
    res.json({ id: rows[0].id });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Record for this date already exists. Use edit to update.' });
    throw e;
  }
});

app.put('/api/records/:id', requireAuth, async (req, res) => {
  const { break_minutes, phone_minutes, wasted_minutes, late_minutes, is_day_off, notes } = req.body;
  await q(
    `UPDATE daily_records
     SET break_minutes=?, phone_minutes=?, wasted_minutes=?, late_minutes=?, is_day_off=?, notes=?, updated_at=NOW()
     WHERE id=?`,
    [break_minutes || 0, phone_minutes || 0, wasted_minutes || 0, late_minutes || 0,
     is_day_off ? 1 : 0, notes || '', req.params.id]
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
             FROM manual_adjustments a
             LEFT JOIN admins ad ON ad.id = a.created_by
             WHERE a.employee_id = ?`;
  const params = [req.params.employeeId];
  if (date) { sql += ' AND a.record_date = ?'; params.push(date); }
  sql += ' ORDER BY a.created_at DESC';
  const { rows } = await q(sql, params);
  res.json(rows);
});

app.post('/api/adjustments', requireAuth, async (req, res) => {
  const { employee_id, record_date, adjustment_minutes, reason } = req.body;
  if (!employee_id || !record_date || adjustment_minutes === undefined || !reason) {
    return res.status(400).json({ error: 'All fields required' });
  }
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

// ─── SUMMARY REPORT ──────────────────────────────────────────────────────────

app.get('/api/summary', requireAuth, async (req, res) => {
  const { from, to } = req.query;
  const { rows: employees } = await q('SELECT * FROM employees WHERE active = 1 ORDER BY name');

  const summary = await Promise.all(employees.map(async emp => {
    let sql = `
      SELECT r.*,
        r.record_date::TEXT AS record_date,
        COALESCE((SELECT SUM(a.adjustment_minutes)::INT FROM manual_adjustments a
                  WHERE a.employee_id = r.employee_id AND a.record_date = r.record_date), 0) AS manual_adj
      FROM daily_records r
      WHERE r.employee_id = ?
    `;
    const params = [emp.id];
    if (from) { sql += ' AND r.record_date >= ?'; params.push(from); }
    if (to)   { sql += ' AND r.record_date <= ?'; params.push(to); }

    const { rows: records } = await q(sql, params);
    let totalDeductMinutes = 0;
    let totalDeduction = 0;
    let daysOff = 0;

    records.forEach(r => {
      const calc = calcDeduction(r, emp.daily_rate);
      const totalMin = calc.deductible_minutes + (r.manual_adj || 0);
      totalDeductMinutes += totalMin;
      totalDeduction += totalMin * (emp.daily_rate / (SHIFT_HOURS * 60));
      if (r.is_day_off) daysOff++;
    });

    return {
      employee_id: emp.id,
      name: emp.name,
      daily_rate: emp.daily_rate,
      record_count: records.length,
      days_off: daysOff,
      total_deductible_minutes: totalDeductMinutes,
      total_deduction: parseFloat(totalDeduction.toFixed(2))
    };
  }));

  res.json(summary);
});

// ─── START ────────────────────────────────────────────────────────────────────

// Export for Vercel (serverless handler)
module.exports = app;

// Also listen when run directly (local dev)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Employee Time Tracker running on http://localhost:${PORT}`);
    console.log('Default login: admin / admin123');
  });
}
