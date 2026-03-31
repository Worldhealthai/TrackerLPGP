const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Redirect unauthenticated root requests to login
app.get('/', (req, res, next) => {
  if (!req.session || !req.session.adminId) return res.redirect('/login.html');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'lpgp-tracker-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8 hours
}));

function requireAuth(req, res, next) {
  if (!req.session.adminId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// ─── AUTH ────────────────────────────────────────────────────────────────────

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const admin = db.get('SELECT * FROM admins WHERE username = ?', [username]);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  req.session.adminId = admin.id;
  req.session.username = admin.username;
  req.session.role = admin.role;
  res.json({ success: true, role: admin.role, username: admin.username });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ username: req.session.username, role: req.session.role });
});

// ─── ADMINS (admin only) ─────────────────────────────────────────────────────

app.get('/api/admins', requireAuth, (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  res.json(db.all('SELECT id, username, role, created_at FROM admins'));
});

app.post('/api/admins', requireAuth, (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const hash = bcrypt.hashSync(password, 10);
  try {
    const result = db.run(
      'INSERT INTO admins (username, password_hash, role) VALUES (?, ?, ?)',
      [username, hash, role || 'manager']
    );
    res.json({ id: result.lastInsertRowid, username, role: role || 'manager' });
  } catch {
    res.status(400).json({ error: 'Username already exists' });
  }
});

app.delete('/api/admins/:id', requireAuth, (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  if (parseInt(req.params.id) === req.session.adminId) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  db.run('DELETE FROM admins WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

app.put('/api/admins/:id/password', requireAuth, (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  const hash = bcrypt.hashSync(password, 10);
  db.run('UPDATE admins SET password_hash = ? WHERE id = ?', [hash, req.params.id]);
  res.json({ success: true });
});

// ─── EMPLOYEES ───────────────────────────────────────────────────────────────

app.get('/api/employees', requireAuth, (req, res) => {
  res.json(db.all('SELECT * FROM employees WHERE active = 1 ORDER BY name'));
});

app.get('/api/employees/all', requireAuth, (req, res) => {
  res.json(db.all('SELECT * FROM employees ORDER BY name'));
});

app.post('/api/employees', requireAuth, (req, res) => {
  const { name, daily_rate } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const result = db.run('INSERT INTO employees (name, daily_rate) VALUES (?, ?)', [name, daily_rate || 0]);
  res.json({ id: result.lastInsertRowid, name, daily_rate: daily_rate || 0 });
});

app.put('/api/employees/:id', requireAuth, (req, res) => {
  const { name, daily_rate, active } = req.body;
  db.run('UPDATE employees SET name = ?, daily_rate = ?, active = ? WHERE id = ?',
    [name, daily_rate, active !== undefined ? active : 1, req.params.id]);
  res.json({ success: true });
});

app.delete('/api/employees/:id', requireAuth, (req, res) => {
  db.run('UPDATE employees SET active = 0 WHERE id = ?', [req.params.id]);
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

app.get('/api/records/:employeeId', requireAuth, (req, res) => {
  const { from, to } = req.query;
  let query = `
    SELECT r.*, e.daily_rate, e.name as employee_name,
      COALESCE((SELECT SUM(adjustment_minutes) FROM manual_adjustments a
                WHERE a.employee_id = r.employee_id AND a.record_date = r.record_date), 0) as manual_adj
    FROM daily_records r
    JOIN employees e ON e.id = r.employee_id
    WHERE r.employee_id = ?
  `;
  const params = [req.params.employeeId];
  if (from) { query += ' AND r.record_date >= ?'; params.push(from); }
  if (to)   { query += ' AND r.record_date <= ?'; params.push(to); }
  query += ' ORDER BY r.record_date DESC';

  const records = db.all(query, params);
  const enriched = records.map(r => {
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

app.post('/api/records', requireAuth, (req, res) => {
  const { employee_id, record_date, break_minutes, phone_minutes, wasted_minutes, late_minutes, is_day_off, notes } = req.body;
  if (!employee_id || !record_date) return res.status(400).json({ error: 'employee_id and record_date required' });
  try {
    const result = db.run(
      `INSERT INTO daily_records (employee_id, record_date, break_minutes, phone_minutes, wasted_minutes, late_minutes, is_day_off, notes, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [employee_id, record_date, break_minutes || 0, phone_minutes || 0, wasted_minutes || 0,
       late_minutes || 0, is_day_off ? 1 : 0, notes || '', req.session.adminId]
    );
    res.json({ id: result.lastInsertRowid });
  } catch {
    res.status(400).json({ error: 'Record for this date already exists. Use edit to update.' });
  }
});

app.put('/api/records/:id', requireAuth, (req, res) => {
  const { break_minutes, phone_minutes, wasted_minutes, late_minutes, is_day_off, notes } = req.body;
  db.run(
    `UPDATE daily_records SET break_minutes=?, phone_minutes=?, wasted_minutes=?, late_minutes=?, is_day_off=?, notes=?, updated_at=datetime('now') WHERE id=?`,
    [break_minutes || 0, phone_minutes || 0, wasted_minutes || 0, late_minutes || 0, is_day_off ? 1 : 0, notes || '', req.params.id]
  );
  res.json({ success: true });
});

app.delete('/api/records/:id', requireAuth, (req, res) => {
  db.run('DELETE FROM daily_records WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ─── MANUAL ADJUSTMENTS ──────────────────────────────────────────────────────

app.get('/api/adjustments/:employeeId', requireAuth, (req, res) => {
  const { date } = req.query;
  let query = 'SELECT a.*, ad.username FROM manual_adjustments a LEFT JOIN admins ad ON ad.id = a.created_by WHERE a.employee_id = ?';
  const params = [req.params.employeeId];
  if (date) { query += ' AND a.record_date = ?'; params.push(date); }
  query += ' ORDER BY a.created_at DESC';
  res.json(db.all(query, params));
});

app.post('/api/adjustments', requireAuth, (req, res) => {
  const { employee_id, record_date, adjustment_minutes, reason } = req.body;
  if (!employee_id || !record_date || adjustment_minutes === undefined || !reason) {
    return res.status(400).json({ error: 'All fields required' });
  }
  const result = db.run(
    'INSERT INTO manual_adjustments (employee_id, record_date, adjustment_minutes, reason, created_by) VALUES (?, ?, ?, ?, ?)',
    [employee_id, record_date, adjustment_minutes, reason, req.session.adminId]
  );
  res.json({ id: result.lastInsertRowid });
});

app.delete('/api/adjustments/:id', requireAuth, (req, res) => {
  db.run('DELETE FROM manual_adjustments WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ─── SUMMARY REPORT ──────────────────────────────────────────────────────────

app.get('/api/summary', requireAuth, (req, res) => {
  const { from, to } = req.query;
  const employees = db.all('SELECT * FROM employees WHERE active = 1 ORDER BY name');

  const summary = employees.map(emp => {
    let query = `
      SELECT r.*,
        COALESCE((SELECT SUM(adjustment_minutes) FROM manual_adjustments a
                  WHERE a.employee_id = r.employee_id AND a.record_date = r.record_date), 0) as manual_adj
      FROM daily_records r
      WHERE r.employee_id = ?
    `;
    const params = [emp.id];
    if (from) { query += ' AND r.record_date >= ?'; params.push(from); }
    if (to)   { query += ' AND r.record_date <= ?'; params.push(to); }

    const records = db.all(query, params);
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
  });

  res.json(summary);
});

// ─── START ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Employee Time Tracker running on http://localhost:${PORT}`);
  console.log(`Default login: admin / admin123`);
});
