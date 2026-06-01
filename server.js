const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { sql, initDb } = require('./database');

// Email transporter — configured via env vars; silently disabled if not set
function createMailTransport() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

async function sendAdminEmail(subject, html) {
  const to = process.env.ADMIN_EMAIL;
  if (!to) return;
  try {
    const transport = createMailTransport();
    if (!transport) return;
    await transport.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, html });
  } catch (e) {
    console.warn('Email send failed:', e.message);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'lpgp-tracker-jwt-2024';

// Lazy init: retry on every request until it succeeds once, then skip forever.
let dbInitialized = false;
let dbMigrationsRun = false;
let dbInitPromise = null; // serialise concurrent first-request inits

async function runLateMigrations() {
  const steps = [
    `CREATE TABLE IF NOT EXISTS employee_portfolio_events (id SERIAL PRIMARY KEY, employee_id INTEGER NOT NULL, event_name TEXT NOT NULL, event_date DATE, notes TEXT NOT NULL DEFAULT '', added_by TEXT NOT NULL DEFAULT 'employee', allocated_by INT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS employee_reminders (id SERIAL PRIMARY KEY, employee_id INTEGER NOT NULL, title TEXT NOT NULL, reminder_date DATE, is_done BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `ALTER TABLE day_off_requests ADD COLUMN IF NOT EXISTS reason TEXT`,
    `ALTER TABLE calendar_reminders ADD COLUMN IF NOT EXISTS visible_to_staff BOOLEAN DEFAULT FALSE`,
    `CREATE TABLE IF NOT EXISTS deal_tracker (
      id SERIAL PRIMARY KEY,
      month_label TEXT NOT NULL DEFAULT '',
      company TEXT NOT NULL,
      paid_inc_vat NUMERIC(12,2),
      deal_amount NUMERIC(12,2),
      tax_vat NUMERIC(12,2),
      date_invoice_issued DATE,
      date_paid DATE,
      bank TEXT DEFAULT '',
      invoice_number TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      invoice_sent TEXT DEFAULT 'no',
      signature_received TEXT DEFAULT 'no',
      initials TEXT DEFAULT '',
      row_color TEXT DEFAULT 'green',
      status TEXT DEFAULT 'active',
      sort_order INT DEFAULT 0,
      created_by INT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `ALTER TABLE deal_tracker ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'`,
    `ALTER TABLE deal_tracker ADD COLUMN IF NOT EXISTS is_flagged BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE monthly_payments ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'GBP'`,
    `CREATE TABLE IF NOT EXISTS agenda_notifications (
      id SERIAL PRIMARY KEY,
      event_id INT NOT NULL,
      event_name TEXT NOT NULL DEFAULT '',
      employee_id INT,
      employee_name TEXT NOT NULL DEFAULT '',
      uploaded_at TIMESTAMPTZ DEFAULT NOW(),
      is_read BOOLEAN DEFAULT FALSE
    )`,
    `ALTER TABLE deals ADD COLUMN IF NOT EXISTS deal_month TEXT DEFAULT ''`,
    `ALTER TABLE deals ADD COLUMN IF NOT EXISTS fiscal_year INT`,
    `CREATE TABLE IF NOT EXISTS event_kits (
      id SERIAL PRIMARY KEY,
      event_id INT NOT NULL,
      agenda_file TEXT DEFAULT '',
      agenda_data TEXT DEFAULT '',
      brochure_url TEXT DEFAULT '',
      brochure_file TEXT DEFAULT '',
      brochure_data TEXT DEFAULT '',
      banner_url TEXT DEFAULT '',
      banner_file TEXT DEFAULT '',
      banner_data TEXT DEFAULT '',
      roundtable_url TEXT DEFAULT '',
      roundtable_file TEXT DEFAULT '',
      roundtable_data TEXT DEFAULT '',
      presentation_url TEXT DEFAULT '',
      presentation_file TEXT DEFAULT '',
      presentation_data TEXT DEFAULT '',
      backdrop_url TEXT DEFAULT '',
      backdrop_file TEXT DEFAULT '',
      backdrop_data TEXT DEFAULT '',
      name_badges_url TEXT DEFAULT '',
      name_badges_file TEXT DEFAULT '',
      name_badges_data TEXT DEFAULT '',
      access_emails TEXT DEFAULT '[]',
      notes TEXT DEFAULT '',
      created_by INT,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(event_id)
    )`,
    `CREATE TABLE IF NOT EXISTS deal_invoices (
      id SERIAL PRIMARY KEY,
      deal_id INT NOT NULL,
      file_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_data TEXT NOT NULL,
      file_size INT DEFAULT 0,
      created_by INT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
  ];
  for (const step of steps) {
    try { await sql(step); } catch(e) { console.warn('Migration step skipped:', e.message); }
  }
}

async function ensureDb() {
  if (!dbInitialized) {
    // Only one concurrent init attempt at a time; reset on failure so next request can retry
    if (!dbInitPromise) {
      dbInitPromise = initDb()
        .then(() => { dbInitialized = true; })
        .catch(err => { dbInitPromise = null; throw err; });
    }
    await dbInitPromise;
  }
  if (!dbMigrationsRun) {
    dbMigrationsRun = true; // set before running so a failure never blocks the API
    runLateMigrations().catch(e => console.warn('Late migrations failed:', e.message));
  }
}

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(cookieParser());

// Serve PWA assets without auth so browsers can install the app
const publicDir = path.join(__dirname, 'public');
app.get('/manifest.json', (req, res) => res.sendFile(path.join(publicDir, 'manifest.json')));
app.get('/sw.js',         (req, res) => res.sendFile(path.join(publicDir, 'sw.js')));
app.get('/icon-192.png',  (req, res) => { res.setHeader('Content-Type','image/svg+xml'); res.send(makePwaIcon(192)); });
app.get('/icon-512.png',  (req, res) => { res.setHeader('Content-Type','image/svg+xml'); res.send(makePwaIcon(512)); });
app.get('/favicon.ico',   (req, res) => { res.setHeader('Content-Type','image/svg+xml'); res.send(makePwaIcon(32)); });

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

function safeJsonParse(v, fallback) { try { return JSON.parse(v); } catch { return fallback; } }

function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; req.admin = req.user;
    next();
  } catch {
    res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

function requireAdmin(req, res, next) {
  if (req.admin?.role !== 'admin') return res.status(403).json({ error: 'Access restricted to admins' });
  next();
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

app.post('/api/employee-login', async (req, res) => {
  try {
    const { email, pin } = req.body;
    if (!email || !pin) return res.status(400).json({ error: 'Email and PIN required' });
    const { rows } = await q(`SELECT * FROM employees WHERE LOWER(email) = LOWER(?) AND active = 1`, [email.trim()]);
    const emp = rows[0];
    if (!emp || !emp.portal_pin) return res.status(401).json({ error: 'Invalid email or PIN' });
    if (!bcrypt.compareSync(String(pin), emp.portal_pin)) return res.status(401).json({ error: 'Invalid email or PIN' });
    const token = jwt.sign({ role: 'employee', employee_id: emp.id, name: emp.name, email: emp.email }, JWT_SECRET, { expiresIn: '12h' });
    res.cookie('token', token, { httpOnly: true, sameSite: 'strict', maxAge: 12 * 60 * 60 * 1000 });
    res.json({ success: true, role: 'employee', name: emp.name, employee_id: emp.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/me', requireAuth, (req, res) => {
  if (req.user.role === 'employee') {
    return res.json({ role: 'employee', employee_id: req.user.employee_id, name: req.user.name, email: req.user.email });
  }
  res.json({ username: req.user.username, role: req.user.role || 'admin' });
});

// PWA icons — generated as SVG served with image/png MIME for compatibility
function makePwaIcon(size) {
  const r = Math.round(size * 0.18);
  const fontSize = Math.round(size * 0.38);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${r}" fill="#4f6ef7"/>
    <text x="50%" y="54%" font-family="system-ui,Arial,sans-serif" font-weight="700" font-size="${fontSize}" fill="white" text-anchor="middle" dominant-baseline="middle">L</text>
  </svg>`;
}
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
  if (req.user.role !== 'admin') {
    return res.json(rows.map(({ annual_salary, daily_rate, pension_rate, ...rest }) => rest));
  }
  res.json(rows);
});

app.get('/api/employees/all', requireAuth, async (req, res) => {
  const { rows } = await q('SELECT * FROM employees ORDER BY name');
  if (req.user.role !== 'admin') {
    return res.json(rows.map(({ annual_salary, daily_rate, pension_rate, ...rest }) => rest));
  }
  res.json(rows);
});

app.post('/api/employees', requireAuth, async (req, res) => {
  const { name, employment_type, annual_salary, currency, start_date, pension_rate,
          job_title, department, phone, email, contract_end_date } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const annualSal = parseFloat(annual_salary) || 0;
  const daily_rate = parseFloat((annualSal / 260).toFixed(4));
  const cur = ['GBP','AED','PHP'].includes(currency) ? currency : 'GBP';
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
          start_date, pension_rate, job_title, department, phone, email, contract_end_date,
          portal_pin } = req.body;
  const annualSal = parseFloat(annual_salary) || 0;
  const daily_rate = parseFloat((annualSal / 260).toFixed(4));
  const cur = ['GBP','AED','PHP'].includes(currency) ? currency : 'GBP';
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

  const pinVal = portal_pin ? String(portal_pin).replace(/\D/g,'').slice(0,6) || null : null;

  await q(
    `UPDATE employees SET name=?, daily_rate=?, active=?, employment_type=?, annual_salary=?,
     currency=?, start_date=?, pension_rate=?,
     job_title=?, department=?, phone=?, email=?, contract_end_date=?, portal_pin=?
     WHERE id=?`,
    [name, daily_rate, active !== undefined ? active : 1, employment_type || 'payroll',
     annualSal, cur, start_date || null, pensionRate,
     job_title || '', department || '', phone || '', email || '',
     contract_end_date || null, pinVal, req.params.id]
  );
  res.json({ success: true });
});

app.patch('/api/employees/:id', requireAuth, async (req, res) => {
  try {
    const { portal_pin } = req.body;
    const pinVal = portal_pin ? String(portal_pin).replace(/\D/g,'').slice(0,6) || null : null;
    const { rows } = await q('UPDATE employees SET portal_pin=? WHERE id=? RETURNING id', [pinVal, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
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

app.delete('/api/employees/:id/hard', requireAuth, requireAdmin, async (req, res) => {
  try {
    await q('DELETE FROM employees WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin: set portal PIN for employee
app.put('/api/employees/:id/portal-pin', requireAuth, requireAdmin, async (req, res) => {
  const { pin } = req.body;
  if (!pin || String(pin).length < 4) return res.status(400).json({ error: 'PIN must be at least 4 characters' });
  const hash = bcrypt.hashSync(String(pin), 10);
  await q('UPDATE employees SET portal_pin = ? WHERE id = ?', [hash, req.params.id]);
  res.json({ success: true });
});

// Employee: own profile
app.get('/api/employee/profile', requireAuth, async (req, res) => {
  if (req.user.role !== 'employee') return res.status(403).json({ error: 'Employees only' });
  const empId = req.user.employee_id;
  const { rows } = await q('SELECT id, name, email, job_title, department, employment_type, annual_salary, currency, start_date FROM employees WHERE id = ?', [empId]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  const emp = rows[0];
  const year = new Date().getFullYear();
  const allowance = DAY_OFF_ALLOWANCE[emp.employment_type] || 20;
  const calc = await calcExcessDeductions(empId, year, parseFloat(emp.annual_salary) || 0, allowance);
  res.json({ ...emp, year, days_used: calc.total_days_off, allowance_days: allowance, excess_days: calc.excess_days, excess_deduction: calc.excess_deduction });
});

// Employee: own calendar records for a month
app.get('/api/employee/my-records', requireAuth, async (req, res) => {
  if (req.user.role !== 'employee') return res.status(403).json({ error: 'Employees only' });
  const year  = parseInt(req.query.year  || new Date().getFullYear());
  const month = parseInt(req.query.month || new Date().getMonth() + 1);
  const { rows } = await q(
    `SELECT record_date::TEXT AS record_date, is_day_off, notes FROM daily_records
     WHERE employee_id = ? AND EXTRACT(YEAR FROM record_date) = ? AND EXTRACT(MONTH FROM record_date) = ?
     ORDER BY record_date`,
    [req.user.employee_id, year, month]
  );
  res.json(rows);
});

// Employee: submit day-off request
app.post('/api/employee/day-off', requireAuth, async (req, res) => {
  if (req.user.role !== 'employee') return res.status(403).json({ error: 'Employees only' });
  const { date, is_day_off } = req.body;
  if (!date) return res.status(400).json({ error: 'date required' });
  const val = parseFloat(is_day_off) || 1;
  // Check for duplicate
  const { rows: existing } = await q('SELECT id FROM day_off_requests WHERE employee_id = ? AND request_date = ? AND status != ?', [req.user.employee_id, date, 'declined']);
  if (existing.length) return res.status(409).json({ error: 'A request already exists for this date' });
  const reason = (req.body.reason || '').trim();
  await q('INSERT INTO day_off_requests (employee_id, request_date, is_day_off, reason) VALUES (?, ?, ?, ?)', [req.user.employee_id, date, val, reason]);
  res.json({ success: true, status: 'pending' });
});

// Employee: cancel a pending day-off request
app.delete('/api/employee/day-off/:date', requireAuth, async (req, res) => {
  if (req.user.role !== 'employee') return res.status(403).json({ error: 'Employees only' });
  await q('DELETE FROM day_off_requests WHERE employee_id = ? AND request_date = ? AND status = ?', [req.user.employee_id, req.params.date, 'pending']);
  res.json({ success: true });
});

// Admin: get all pending day-off requests
app.get('/api/day-off-requests', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await q(`SELECT r.*, e.name as employee_name, e.department, e.job_title
    FROM day_off_requests r JOIN employees e ON r.employee_id = e.id
    WHERE r.status = 'pending' ORDER BY r.request_date ASC`);
  res.json(rows);
});

// Admin: approve a day-off request
app.put('/api/day-off-requests/:id/approve', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await q('SELECT * FROM day_off_requests WHERE id = ?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  const r = rows[0];
  // Write to daily_records
  await q(`INSERT INTO daily_records (employee_id, record_date, is_day_off, notes) VALUES (?, ?, ?, ?)
    ON CONFLICT (employee_id, record_date) DO UPDATE SET is_day_off = EXCLUDED.is_day_off`,
    [r.employee_id, r.request_date, r.is_day_off, 'Approved day off']);
  // Update request status
  await q('UPDATE day_off_requests SET status = ?, reviewed_at = NOW(), reviewed_by = ? WHERE id = ?',
    ['approved', req.user.username || 'admin', req.params.id]);
  // Notify employee
  const dateStr = new Date(r.request_date).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'});
  const typeLabel = parseFloat(r.is_day_off) === 1 ? 'Full day' : 'Half day';
  await q('INSERT INTO emp_notifications (employee_id, message, type) VALUES (?, ?, ?)',
    [r.employee_id, `Your ${typeLabel} off request for ${dateStr} has been approved.`, 'approved']);
  res.json({ success: true });
});

// Admin: decline a day-off request
app.put('/api/day-off-requests/:id/decline', requireAuth, requireAdmin, async (req, res) => {
  const { reason } = req.body;
  const { rows } = await q('SELECT * FROM day_off_requests WHERE id = ?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  const r = rows[0];
  await q('UPDATE day_off_requests SET status = ?, decline_reason = ?, reviewed_at = NOW(), reviewed_by = ? WHERE id = ?',
    ['declined', reason || '', req.user.username || 'admin', req.params.id]);
  // Notify employee
  const dateStr = new Date(r.request_date).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'});
  const typeLabel = parseFloat(r.is_day_off) === 1 ? 'Full day' : 'Half day';
  const msg = reason
    ? `Your ${typeLabel} off request for ${dateStr} was declined. Reason: ${reason}`
    : `Your ${typeLabel} off request for ${dateStr} was declined.`;
  await q('INSERT INTO emp_notifications (employee_id, message, type) VALUES (?, ?, ?)',
    [r.employee_id, msg, 'declined']);
  res.json({ success: true });
});

// Employee: get own notifications
app.get('/api/employee/notifications', requireAuth, async (req, res) => {
  if (req.user.role !== 'employee') return res.status(403).json({ error: 'Employees only' });
  const { rows } = await q('SELECT * FROM emp_notifications WHERE employee_id = ? ORDER BY created_at DESC LIMIT 20', [req.user.employee_id]);
  res.json(rows);
});

// Employee: mark all notifications as read
app.put('/api/employee/notifications/read-all', requireAuth, async (req, res) => {
  if (req.user.role !== 'employee') return res.status(403).json({ error: 'Employees only' });
  await q('UPDATE emp_notifications SET is_read = 1 WHERE employee_id = ?', [req.user.employee_id]);
  res.json({ success: true });
});

// Employee: get own day-off requests with status
app.get('/api/employee/day-off-requests', requireAuth, async (req, res) => {
  if (req.user.role !== 'employee') return res.status(403).json({ error: 'Employees only' });
  const { rows } = await q('SELECT * FROM day_off_requests WHERE employee_id = ? ORDER BY request_date DESC', [req.user.employee_id]);
  res.json(rows);
});

// Employee: own salary card data
app.get('/api/employee/salary', requireAuth, async (req, res) => {
  if (req.user.role !== 'employee') return res.status(403).json({ error: 'Employees only' });
  try {
    const empId = req.user.employee_id;
    const year  = parseInt(req.query.year) || new Date().getFullYear();
    const { rows: empRows } = await q('SELECT * FROM employees WHERE id = ?', [empId]);
    if (!empRows[0]) return res.status(404).json({ error: 'Not found' });
    const emp = empRows[0];

    const { rows: payments } = await q(
      'SELECT * FROM monthly_payments WHERE employee_id = ? AND payment_year = ? ORDER BY payment_month',
      [empId, year]
    );
    const allowance   = DAY_OFF_ALLOWANCE[emp.employment_type] || 20;
    const annualSal   = parseFloat(emp.annual_salary) || 0;
    const dayCalc     = await calcExcessDeductions(empId, year, annualSal, allowance);
    const startDateStr = emp.start_date ? emp.start_date.toISOString().slice(0,10) : null;
    const startedThisYear = startDateStr && startDateStr.startsWith(String(year));
    const isTerminated = !emp.active && !!emp.termination_date;

    const earnedPay = isTerminated
      ? calcEarnedPay(annualSal, startDateStr, emp.termination_date.toISOString().slice(0,10))
      : (startedThisYear ? calcProRatedPay(annualSal, startDateStr) : null);

    let firstMonthFull = null;
    if (!isTerminated && startedThisYear && startDateStr) {
      const [fY, fM] = startDateStr.split('-').map(Number);
      const lastDay = new Date(fY, fM, 0).getDate();
      firstMonthFull = calcEarnedPay(annualSal, startDateStr, `${fY}-${String(fM).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`);
    }

    let salaryTarget = annualSal;
    if (isTerminated) {
      salaryTarget = earnedPay?.total_expected ?? annualSal;
    } else if (startedThisYear) {
      const yearEnd = calcEarnedPay(annualSal, startDateStr, `${year}-12-31`);
      salaryTarget = yearEnd?.total_expected ?? annualSal;
    }

    const ukPay = emp.employment_type === 'payroll' && annualSal > 0
      ? calcUKNetPay(annualSal, parseFloat(emp.pension_rate) || 0)
      : null;
    const netFactor       = ukPay ? ukPay.net_annual / annualSal : 1;
    const netSalaryTarget = parseFloat((salaryTarget * netFactor).toFixed(2));
    const totalPaid       = payments.reduce((a, b) => a + parseFloat(b.amount), 0);
    const netRemaining    = parseFloat((netSalaryTarget - totalPaid - dayCalc.excess_deduction).toFixed(2));
    const pctPaid         = netSalaryTarget > 0 ? Math.min(100, Math.round((totalPaid / netSalaryTarget) * 100)) : 0;

    res.json({
      name:             emp.name,
      employment_type:  emp.employment_type,
      currency:         emp.currency || 'GBP',
      annual_salary:    annualSal,
      pension_rate:     parseFloat(emp.pension_rate) || 0,
      paye_breakdown:   ukPay,
      net_monthly:      ukPay ? ukPay.net_monthly : null,
      salary_target:    netSalaryTarget,
      start_date:       startDateStr,
      is_terminated:    isTerminated,
      pro_rated:        !isTerminated ? earnedPay : null,
      first_month_full: firstMonthFull,
      payments,
      total_paid:       parseFloat(totalPaid.toFixed(2)),
      total_days_off:   dayCalc.total_days_off,
      allowance_days:   allowance,
      excess_days:      dayCalc.excess_days,
      excess_deduction: dayCalc.excess_deduction,
      net_remaining:    netRemaining,
      pct_paid:         pctPaid,
      year
    });
  } catch (e) {
    console.error('/api/employee/salary error:', e);
    res.status(500).json({ error: e.message });
  }
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

app.get('/api/payments/:employeeId', requireAuth, requireAdmin, async (req, res) => {
  const { year } = req.query;
  let sql = 'SELECT * FROM monthly_payments WHERE employee_id = ?';
  const params = [req.params.employeeId];
  if (year) { sql += ' AND payment_year = ?'; params.push(year); }
  sql += ' ORDER BY payment_year DESC, payment_month DESC';
  const { rows } = await q(sql, params);
  res.json(rows);
});

app.post('/api/payments', requireAuth, requireAdmin, async (req, res) => {
  const { employee_id, payment_year, payment_month, amount, notes, currency } = req.body;
  if (!employee_id || !payment_year || !payment_month || !amount)
    return res.status(400).json({ error: 'employee_id, year, month, amount required' });
  const cur = ['GBP','AED','PHP'].includes(currency) ? currency : 'GBP';
  const { rows } = await q(
    'INSERT INTO monthly_payments (employee_id, payment_year, payment_month, amount, notes, currency, created_by) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
    [employee_id, payment_year, payment_month, amount, notes || '', cur, req.admin.id]
  );
  res.json({ id: rows[0].id });
});

app.delete('/api/payments/:id', requireAuth, requireAdmin, async (req, res) => {
  await q('DELETE FROM monthly_payments WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ─── SALARY OVERVIEW ─────────────────────────────────────────────────────────

app.get('/api/salary-overview', requireAuth, requireAdmin, async (req, res) => {
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
        pct_paid:            pctPaid,
        has_pin:             !!emp.portal_pin
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

app.get('/api/salary-history/:employeeId', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await q(
    `SELECT sh.*, sh.effective_from::TEXT AS effective_from, ad.username AS created_by_name
     FROM salary_history sh LEFT JOIN admins ad ON ad.id = sh.created_by
     WHERE sh.employee_id = ? ORDER BY sh.effective_from DESC, sh.created_at DESC`,
    [req.params.employeeId]
  );
  res.json(rows);
});

app.post('/api/salary-history', requireAuth, requireAdmin, async (req, res) => {
  const { employee_id, annual_salary, currency, effective_from, reason } = req.body;
  if (!employee_id || !annual_salary) return res.status(400).json({ error: 'employee_id and annual_salary required' });
  const cur = ['GBP','AED','PHP'].includes(currency) ? currency : 'GBP';
  const { rows } = await q(
    'INSERT INTO salary_history (employee_id, annual_salary, currency, effective_from, reason, created_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    [employee_id, parseFloat(annual_salary), cur, effective_from || new Date().toISOString().slice(0,10), reason || '', req.admin.id]
  );
  res.json({ id: rows[0].id });
});

app.delete('/api/salary-history/:id', requireAuth, requireAdmin, async (req, res) => {
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
    const { title, reminder_date, recurrence, category, amount, currency, notes, visible_to_staff } = req.body;
    if (!title || !reminder_date) return res.status(400).json({ error: 'title and reminder_date required' });
    const rec = ['none','monthly','yearly'].includes(recurrence) ? recurrence : 'none';
    const cat = ['rent','subscription','deposit','utility','other'].includes(category) ? category : 'other';
    const cur = ['GBP','AED','PHP'].includes(currency) ? currency : 'GBP';
    const { rows } = await q(
      'INSERT INTO calendar_reminders (title, reminder_date, recurrence, category, amount, currency, notes, created_by, visible_to_staff) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id',
      [title, reminder_date, rec, cat, amount || null, cur, notes || '', req.admin.id, visible_to_staff ? true : false]
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

app.get('/api/export/payroll-csv', requireAuth, requireAdmin, async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const { rows: employees } = await q('SELECT * FROM employees WHERE active = 1 ORDER BY department, name');

    const rows = await Promise.all(employees.map(async emp => {
      const annualSal = parseFloat(emp.annual_salary) || 0;
      const [{ rows: payments }, { rows: officeRows }] = await Promise.all([
        q('SELECT SUM(amount) AS total FROM monthly_payments WHERE employee_id = ? AND payment_year = ?', [emp.id, year]),
        q('SELECT COALESCE(SUM(amount),0) AS total FROM office_deductions WHERE employee_id = ?', [emp.id])
      ]);
      const totalPaid   = parseFloat(payments[0]?.total || 0);
      const totalOffice = parseFloat(officeRows[0]?.total || 0);
      const ukPay = emp.employment_type === 'payroll' && annualSal > 0
        ? calcUKNetPay(annualSal, parseFloat(emp.pension_rate) || 0) : null;
      const netMonthly    = ukPay ? ukPay.net_monthly : annualSal / 12;
      const grossMonthly  = ukPay ? ukPay.gross_monthly : annualSal / 12;
      const grossTarget   = emp.employment_type === 'payroll' && ukPay ? ukPay.net_annual : annualSal;
      const outstanding   = parseFloat((grossTarget - totalPaid).toFixed(2));
      const netOutstanding = parseFloat((outstanding - totalOffice).toFixed(2));
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
        office_deductions: totalOffice,
        outstanding,
        net_outstanding: netOutstanding
      };
    }));

    const headers = ['Name','Department','Job Title','Type','Currency','Annual Salary',
      'Gross/Month','Net/Month','Income Tax/Yr','NI/Yr','Pension/Yr',
      'Total Paid','Office Deductions','Outstanding (before office)','Net Outstanding'];
    const escape = v => `"${String(v).replace(/"/g,'""')}"`;
    const csv = [
      headers.map(escape).join(','),
      ...rows.map(r => [
        r.name, r.department, r.job_title, r.employment_type, r.currency,
        r.annual_salary, r.gross_monthly, r.net_monthly,
        r.income_tax_yr, r.ni_yr, r.pension_yr,
        r.total_paid, r.office_deductions, r.outstanding, r.net_outstanding
      ].map(escape).join(','))
    ].join('\r\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="payroll-${year}.csv"`);
    res.send(csv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── HOTEL EXPENSES ──────────────────────────────────────────────────────────

app.get('/api/hotel-expenses', requireAuth, async (req, res) => {
  try {
    const { rows } = await q('SELECT * FROM hotel_expenses ORDER BY sort_order, id');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/hotel-expenses', requireAuth, async (req, res) => {
  try {
    const { event_name, hotel, cost, av_amount, av_billing, paid_amount,
            currency, staff_hotel, flights, printing, status, notes, event_year } = req.body;
    const { rows } = await q(
      `INSERT INTO hotel_expenses (event_name, hotel, cost, av_amount, av_billing, paid_amount, currency, staff_hotel, flights, printing, status, notes, event_year, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
      [event_name, hotel||'', cost||'', av_amount||null, av_billing||'separate',
       paid_amount||null, currency||'USD', staff_hotel||null, flights||null, printing||null,
       status||'pending', notes||'', event_year||null, req.user?.id||null]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/hotel-expenses/:id', requireAuth, async (req, res) => {
  try {
    const { event_name, hotel, cost, av_amount, av_billing, paid_amount,
            currency, staff_hotel, flights, printing, status, notes, event_year } = req.body;
    const { rows } = await q(
      `UPDATE hotel_expenses SET event_name=?, hotel=?, cost=?, av_amount=?,
       av_billing=?, paid_amount=?, currency=?, staff_hotel=?, flights=?, printing=?,
       status=?, notes=?, event_year=?
       WHERE id=? RETURNING *`,
      [event_name, hotel||'', cost||'', av_amount||null, av_billing||'separate',
       paid_amount||null, currency||'USD', staff_hotel||null, flights||null, printing||null,
       status||'pending', notes||'', event_year||null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Upload invoice (base64) for a hotel expense
app.post('/api/hotel-expenses/:id/invoice', requireAuth, async (req, res) => {
  try {
    const { invoice_name, invoice_data } = req.body;
    if (!invoice_name || !invoice_data) return res.status(400).json({ error: 'invoice_name and invoice_data required' });
    const { rows } = await q(
      `UPDATE hotel_expenses SET invoice_name=?, invoice_data=? WHERE id=? RETURNING id, invoice_name`,
      [invoice_name, invoice_data, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Download invoice
app.get('/api/hotel-expenses/:id/invoice', requireAuth, async (req, res) => {
  try {
    const { rows } = await q(`SELECT invoice_name, invoice_data FROM hotel_expenses WHERE id=?`, [req.params.id]);
    const r = rows[0];
    if (!r || !r.invoice_data) return res.status(404).json({ error: 'No invoice stored' });
    const buf = Buffer.from(r.invoice_data, 'base64');
    const ext = (r.invoice_name || '').split('.').pop().toLowerCase();
    const mime = ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${r.invoice_name}"`);
    res.send(buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete invoice
app.delete('/api/hotel-expenses/:id/invoice', requireAuth, async (req, res) => {
  try {
    await q(`UPDATE hotel_expenses SET invoice_name=NULL, invoice_data=NULL WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/hotel-expenses/:id', requireAuth, async (req, res) => {
  try {
    await q('DELETE FROM hotel_expenses WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH: update individual fields of a hotel expense row
app.patch('/api/hotel-expenses/:id', requireAuth, async (req, res) => {
  try {
    const allowed = ['event_name','hotel','cost','currency','av_amount','av_billing','paid_amount','staff_hotel','flights','printing','status','notes','invoice_name','event_year'];
    const fields = Object.keys(req.body).filter(k => allowed.includes(k));
    if (!fields.length) return res.status(400).json({ error: 'No valid fields' });
    const sets = fields.map(f => `${f}=?`).join(', ');
    const vals = fields.map(f => req.body[f] === '' ? null : req.body[f]);
    const { rows } = await q(`UPDATE hotel_expenses SET ${sets} WHERE id=? RETURNING *`, [...vals, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    // Refresh in-memory for summary recalc (client will re-fetch)
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Middleware: admin OR manager ─────────────────────────────────────────────
function requireAdminOrManager(req, res, next) {
  const r = req.admin?.role;
  if (r !== 'admin' && r !== 'manager') return res.status(403).json({ error: 'Access restricted' });
  next();
}

// ─── SUBSCRIPTIONS ────────────────────────────────────────────────────────────
app.get('/api/subscriptions', requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    const { rows } = await q('SELECT * FROM subscriptions ORDER BY created_at DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/subscriptions', requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    const { name, vendor, amount, currency, billing_cycle, renewal_date, notes } = req.body;
    const { rows } = await q(
      `INSERT INTO subscriptions (name, vendor, amount, currency, billing_cycle, renewal_date, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?) RETURNING *`,
      [name, vendor||'', parseFloat(amount)||0, currency||'GBP', billing_cycle||'monthly', renewal_date||null, notes||'', req.admin.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/subscriptions/:id', requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    const { name, vendor, amount, currency, billing_cycle, renewal_date, notes, active } = req.body;
    const { rows } = await q(
      `UPDATE subscriptions SET name=?, vendor=?, amount=?, currency=?, billing_cycle=?, renewal_date=?, notes=?, active=? WHERE id=? RETURNING *`,
      [name, vendor||'', parseFloat(amount)||0, currency||'GBP', billing_cycle||'monthly', renewal_date||null, notes||'', active !== false, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/subscriptions/:id', requireAuth, requireAdminOrManager, async (req, res) => {
  try { await q('DELETE FROM subscriptions WHERE id=?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── PORTFOLIO EVENTS ─────────────────────────────────────────────────────────
app.get('/api/portfolio-events', requireAuth, async (req, res) => {
  try {
    const { rows } = await q(`
      SELECT pe.*,
        COALESCE(SUM(COALESCE(d.paid_inc_vat, 0)),0) AS total_won,
        COALESCE(SUM(de.allocated_amount),0) AS total_pipeline,
        COUNT(DISTINCT de.deal_id) AS deal_count,
        string_agg(DISTINCT NULLIF(COALESCE(NULLIF(d.company,''), d.title),''), ', ') AS companies
      FROM portfolio_events pe
      LEFT JOIN deal_events de ON de.event_id=pe.id
      LEFT JOIN deals d ON d.id=de.deal_id
      GROUP BY pe.id ORDER BY pe.event_date DESC NULLS LAST, pe.created_at DESC`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// GET /api/portfolio-events/:id/deals — deals linked to an event with paid status
app.get('/api/portfolio-events/:id/deals', requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    const { rows } = await q(`
      SELECT d.id, COALESCE(NULLIF(d.company,''),d.title) AS company,
        de.allocated_amount AS amount, d.currency,
        d.paid_inc_vat, d.stage
      FROM deal_events de
      JOIN deals d ON d.id=de.deal_id
      WHERE de.event_id=?
      ORDER BY d.company`, [req.params.id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/portfolio-events', requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    const { name, event_date, location, notes } = req.body;
    const { rows } = await q(
      `INSERT INTO portfolio_events (name, event_date, location, notes, created_by) VALUES (?,?,?,?,?) RETURNING *`,
      [name, event_date||null, location||'', notes||'', req.admin.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/portfolio-events/:id', requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    const { name, event_date, location, notes } = req.body;
    const { rows } = await q(
      `UPDATE portfolio_events SET name=?, event_date=?, location=?, notes=? WHERE id=? RETURNING *`,
      [name, event_date||null, location||'', notes||'', req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/portfolio-events/:id', requireAuth, requireAdminOrManager, async (req, res) => {
  try { await q('DELETE FROM portfolio_events WHERE id=?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── DEALS ────────────────────────────────────────────────────────────────────
app.get('/api/deals', requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    const { rows: deals } = await q(`
      SELECT d.*,
        COALESCE(json_agg(json_build_object('event_id',de.event_id,'event_name',pe.name,'allocated_amount',de.allocated_amount))
          FILTER (WHERE de.event_id IS NOT NULL), '[]') AS events
      FROM deals d
      LEFT JOIN deal_events de ON de.deal_id = d.id
      LEFT JOIN portfolio_events pe ON pe.id = de.event_id
      GROUP BY d.id ORDER BY d.created_at DESC`);
    res.json(deals);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// GET /api/deals/revenue-by-event — per-event revenue & payment breakdown
app.get('/api/deals/revenue-by-event', requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    const { rows } = await q(`
      SELECT
        pe.id AS event_id,
        pe.name AS event_name,
        pe.event_date,
        COUNT(DISTINCT d.id) AS deal_count,
        COALESCE(SUM(d.amount), 0) AS total_amount,
        COALESCE(SUM(d.paid_inc_vat), 0) AS total_paid,
        COALESCE(SUM(CASE WHEN COALESCE(d.paid_inc_vat,0) > 0 THEN COALESCE(d.tax_vat,0) ELSE 0 END), 0) AS total_vat_collected,
        COUNT(DISTINCT CASE WHEN COALESCE(d.paid_inc_vat,0) > 0 THEN d.id END) AS paid_count,
        json_agg(
          json_build_object(
            'id', d.id,
            'company', COALESCE(NULLIF(d.company,''), d.title, ''),
            'amount', COALESCE(d.amount, 0),
            'paid_inc_vat', COALESCE(d.paid_inc_vat, 0),
            'currency', COALESCE(d.currency, 'GBP')
          ) ORDER BY d.company
        ) FILTER (WHERE d.id IS NOT NULL) AS clients
      FROM portfolio_events pe
      LEFT JOIN deal_events de ON de.event_id = pe.id
      LEFT JOIN deals d ON d.id = de.deal_id
      GROUP BY pe.id, pe.name, pe.event_date
      ORDER BY pe.event_date DESC NULLS LAST, pe.created_at DESC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── EMPLOYEE PORTFOLIO EVENTS ───────────────────────────────────────────────

// Employee: get own portfolio events
app.get('/api/employee/portfolio', requireAuth, async (req, res) => {
  try {
    const empId = req.user.employee_id;
    if (!empId) return res.status(403).json({ error: 'Employee only' });
    const { rows } = await q(
      'SELECT * FROM employee_portfolio_events WHERE employee_id = ? ORDER BY event_date DESC NULLS LAST, created_at DESC',
      [empId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/deals/last-invoice — return last invoice number used (must be before /:id routes)
app.get('/api/deals/last-invoice', requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    const { rows } = await q(`SELECT id, invoice_number FROM deals WHERE invoice_number IS NOT NULL AND invoice_number != '' ORDER BY created_at DESC LIMIT 20`);
    let maxNum = 0; let lastRow = null;
    for (const r of rows) {
      const m = r.invoice_number.match(/(\d+)$/);
      if (m && parseInt(m[1]) > maxNum) { maxNum = parseInt(m[1]); lastRow = r; }
    }
    res.json(lastRow ? { id: lastRow.id, invoice_number: lastRow.invoice_number, next_number: maxNum + 1 } : { id: null, invoice_number: null, next_number: null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/deals', requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    const { title, company, contact_name, amount, currency, stage, event_ids, notes,
            invoice1_name, invoice1_data, invoice2_name, invoice2_data,
            paid_inc_vat, tax_vat, invoice_date, paid_date, bank, invoice_number,
            invoice_agreement_sent, signature_received, initials, deal_month, fiscal_year } = req.body;
    const { rows } = await q(
      `INSERT INTO deals (title, company, contact_name, amount, currency, stage, notes,
        invoice1_name, invoice1_data, invoice2_name, invoice2_data, created_by,
        paid_inc_vat, tax_vat, invoice_date, paid_date, bank, invoice_number,
        invoice_agreement_sent, signature_received, initials, deal_month, fiscal_year)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
      [title, company||'', contact_name||'', parseFloat(amount)||0, currency||'GBP',
       stage||'Prospect', notes||'', invoice1_name||null, invoice1_data||null,
       invoice2_name||null, invoice2_data||null, req.admin.id,
       paid_inc_vat != null ? parseFloat(paid_inc_vat) : null,
       tax_vat != null ? parseFloat(tax_vat) : null,
       invoice_date||null, paid_date||null, bank||'', invoice_number||'',
       invoice_agreement_sent ? true : false, signature_received ? true : false, initials||'',
       deal_month||'', fiscal_year ? parseInt(fiscal_year) : null]
    );
    const deal = rows[0];
    if (Array.isArray(event_ids) && event_ids.length > 0) {
      const perEvent = parseFloat((parseFloat(amount) / event_ids.length).toFixed(2));
      for (const eid of event_ids) {
        await q('INSERT INTO deal_events (deal_id, event_id, allocated_amount) VALUES (?,?,?)',
          [deal.id, eid, perEvent]);
      }
    }
    res.json(deal);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/deals/:id', requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    const { title, company, contact_name, amount, currency, stage, event_ids, notes,
            invoice1_name, invoice1_data, invoice2_name, invoice2_data,
            paid_inc_vat, tax_vat, invoice_date, paid_date, bank, invoice_number,
            invoice_agreement_sent, signature_received, initials, deal_month } = req.body;
    const { rows } = await q(
      `UPDATE deals SET title=?, company=?, contact_name=?, amount=?, currency=?, stage=?, notes=?,
        invoice1_name=COALESCE(?,invoice1_name), invoice1_data=COALESCE(?,invoice1_data),
        invoice2_name=COALESCE(?,invoice2_name), invoice2_data=COALESCE(?,invoice2_data),
        paid_inc_vat=?, tax_vat=?, invoice_date=?, paid_date=?, bank=?, invoice_number=?,
        invoice_agreement_sent=?, signature_received=?, initials=?, deal_month=?
       WHERE id=? RETURNING *`,
      [title, company||'', contact_name||'', parseFloat(amount)||0, currency||'GBP',
       stage||'Prospect', notes||'',
       invoice1_name||null, invoice1_data||null, invoice2_name||null, invoice2_data||null,
       paid_inc_vat != null ? parseFloat(paid_inc_vat) : null,
       tax_vat != null ? parseFloat(tax_vat) : null,
       invoice_date||null, paid_date||null, bank||'', invoice_number||'',
       invoice_agreement_sent ? true : false, signature_received ? true : false, initials||'',
       deal_month||'', req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (Array.isArray(event_ids)) {
      await q('DELETE FROM deal_events WHERE deal_id=?', [req.params.id]);
      const perEvent = event_ids.length > 0 ? parseFloat((parseFloat(amount) / event_ids.length).toFixed(2)) : 0;
      for (const eid of event_ids) {
        await q('INSERT INTO deal_events (deal_id, event_id, allocated_amount) VALUES (?,?,?)',
          [req.params.id, eid, perEvent]);
      }
    }
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.patch('/api/deals/:id/stage', requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    const { stage } = req.body;
    const { rows } = await q('UPDATE deals SET stage=? WHERE id=? RETURNING *', [stage, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/deals/bulk', requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids required' });
    const safe = ids.map(Number).filter(n => Number.isInteger(n) && n > 0);
    if (!safe.length) return res.status(400).json({ error: 'No valid ids' });
    await q(`DELETE FROM deals WHERE id IN (${safe.join(',')})`, []);
    res.json({ ok: true, deleted: safe.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.patch('/api/deals/bulk-year', requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    const { ids, fiscal_year } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids required' });
    const yr = fiscal_year ? parseInt(fiscal_year) : null;
    const safe = ids.map(Number).filter(n => Number.isInteger(n) && n > 0);
    if (!safe.length) return res.status(400).json({ error: 'No valid ids' });
    await q(`UPDATE deals SET fiscal_year=? WHERE id IN (${safe.join(',')})`, [yr]);
    res.json({ ok: true, updated: safe.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/deals/:id', requireAuth, requireAdminOrManager, async (req, res) => {
  try { await q('DELETE FROM deals WHERE id=?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/deals/:id/invoice/:n', requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    const n = req.params.n === '2' ? 2 : 1;
    const { rows } = await q(`SELECT invoice${n}_name AS name, invoice${n}_data AS data FROM deals WHERE id=?`, [req.params.id]);
    const r = rows[0];
    if (!r || !r.data) return res.status(404).json({ error: 'No invoice' });
    const ext = (r.name||'').split('.').pop().toLowerCase();
    const mimes = { pdf:'application/pdf', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc:'application/msword', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg' };
    res.setHeader('Content-Type', mimes[ext] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${r.name}"`);
    res.send(Buffer.from(r.data, 'base64'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/deals/:id/invoice/:n — upload invoice file (base64)
app.post('/api/deals/:id/invoice/:n', requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    const n = req.params.n === '2' ? 2 : 1;
    const { invoice_name, invoice_data } = req.body;
    if (!invoice_name || !invoice_data) return res.status(400).json({ error: 'invoice_name and invoice_data required' });
    const { rows } = await q(
      `UPDATE deals SET invoice${n}_name=?, invoice${n}_data=? WHERE id=? RETURNING id`,
      [invoice_name, invoice_data, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/deals/:id/invoice/:n — remove invoice file
app.delete('/api/deals/:id/invoice/:n', requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    const n = req.params.n === '2' ? 2 : 1;
    await q(`UPDATE deals SET invoice${n}_name=NULL, invoice${n}_data=NULL WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/deals/:id/row-status — set row color status
app.patch('/api/deals/:id/row-status', requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    const { row_status } = req.body;
    const valid = ['none','paid','flagged','issue','urgent'];
    if (!valid.includes(row_status)) return res.status(400).json({ error: 'Invalid status' });
    const { rows } = await q('UPDATE deals SET row_status=? WHERE id=? RETURNING id,row_status', [row_status, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/deals/:id/field — inline cell edit (single field update)
app.patch('/api/deals/:id/field', requireAuth, requireAdminOrManager, async (req, res) => {
  const ALLOWED = ['title','company','initials','stage','amount','currency','paid_inc_vat',
    'tax_vat','invoice_number','invoice_date','paid_date','bank','deal_month','fiscal_year',
    'invoice_agreement_sent','signature_received','notes','cancelled_reason','is_flagged'];
  try {
    const { field, value } = req.body;
    if (!ALLOWED.includes(field)) return res.status(400).json({ error: 'Field not allowed' });
    const { rows } = await q(`UPDATE deals SET ${field}=? WHERE id=? RETURNING id`, [value, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/deals/:id/cancel — mark deal as cancelled with optional reason
app.patch('/api/deals/:id/cancel', requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    const { reason = '' } = req.body;
    const { rows } = await q(
      `UPDATE deals SET stage_cancelled=true, cancelled_reason=?, stage='Cancelled' WHERE id=? RETURNING id`,
      [reason, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/deals/:id/uncancel — restore a cancelled deal
app.patch('/api/deals/:id/uncancel', requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    const { rows } = await q(
      `UPDATE deals SET stage_cancelled=false, cancelled_reason='', stage='Prospect' WHERE id=? RETURNING id`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Employee: add own portfolio event
app.post('/api/employee/portfolio', requireAuth, async (req, res) => {
  try {
    const empId = req.user.employee_id;
    if (!empId) return res.status(403).json({ error: 'Employee only' });
    const { event_name, event_date, notes } = req.body;
    if (!event_name) return res.status(400).json({ error: 'event_name required' });
    await q(
      'INSERT INTO employee_portfolio_events (employee_id, event_name, event_date, notes, added_by) VALUES (?,?,?,?,?)',
      [empId, event_name.trim(), event_date || null, (notes || '').trim(), 'employee']
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Employee: delete own portfolio event
app.delete('/api/employee/portfolio/:id', requireAuth, async (req, res) => {
  try {
    const empId = req.user.employee_id;
    if (!empId) return res.status(403).json({ error: 'Employee only' });
    await q('DELETE FROM employee_portfolio_events WHERE id = ? AND employee_id = ?', [req.params.id, empId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin: get all employees with their portfolio events
app.get('/api/admin/staff-portfolio', requireAuth, async (req, res) => {
  try {
    const { rows: emps } = await q('SELECT id AS employee_id, name, role, department FROM employees WHERE active = 1 ORDER BY name');
    let events = [];
    try {
      const { rows } = await q('SELECT e.*, emp.name AS employee_name FROM employee_portfolio_events e JOIN employees emp ON emp.id = e.employee_id ORDER BY e.event_date DESC NULLS LAST, e.created_at DESC');
      events = rows;
    } catch(tableErr) { /* table may not exist yet */ }
    res.json({ employees: emps, events });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin: allocate/add event to an employee
app.post('/api/admin/staff-portfolio', requireAuth, async (req, res) => {
  try {
    const { employee_id, event_name, event_date, notes } = req.body;
    if (!employee_id || !event_name) return res.status(400).json({ error: 'employee_id and event_name required' });
    await q(
      'INSERT INTO employee_portfolio_events (employee_id, event_name, event_date, notes, added_by, allocated_by) VALUES (?,?,?,?,?,?)',
      [employee_id, event_name.trim(), event_date || null, (notes || '').trim(), 'admin', req.user.id || null]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin: delete any portfolio event
app.delete('/api/admin/staff-portfolio/:id', requireAuth, async (req, res) => {
  try {
    await q('DELETE FROM employee_portfolio_events WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Employee: upcoming — team day-offs + staff-visible reminders
app.get('/api/employee/upcoming', requireAuth, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 60;
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const future = new Date(today); future.setDate(future.getDate() + days);
    const futureStr = future.toISOString().slice(0, 10);

    // Upcoming team days off from daily_records (source of truth for approved days off)
    const { rows: dayOffs } = await q(
      `SELECT r.record_date::TEXT AS date, e.name AS employee_name, r.is_day_off
       FROM daily_records r JOIN employees e ON e.id = r.employee_id
       WHERE r.is_day_off > 0 AND r.record_date >= ? AND r.record_date <= ?
       AND r.employee_id != ? ORDER BY r.record_date ASC`,
      [todayStr, futureStr, req.user.employee_id || 0]
    );

    // Staff-visible calendar reminders
    const { rows: reminders } = await q(
      `SELECT id, title, reminder_date::TEXT AS reminder_date, recurrence, category, amount, currency, notes
       FROM calendar_reminders WHERE visible_to_staff = true ORDER BY reminder_date`
    );
    const upcoming = [];
    reminders.forEach(r => {
      const [, bM, bD] = r.reminder_date.split('-').map(Number);
      for (let offset = 0; offset <= 1; offset++) {
        const d = new Date(today); d.setMonth(d.getMonth() + offset);
        const cY = d.getFullYear(), cM = d.getMonth() + 1;
        if (r.recurrence === 'none') {
          if (r.reminder_date >= todayStr && r.reminder_date <= futureStr)
            upcoming.push({ ...r, virtual_date: r.reminder_date, type: 'reminder' });
        } else if (r.recurrence === 'monthly') {
          const dim = new Date(cY, cM, 0).getDate();
          const vd = `${cY}-${String(cM).padStart(2,'0')}-${String(Math.min(bD,dim)).padStart(2,'0')}`;
          if (vd >= todayStr && vd <= futureStr) upcoming.push({ ...r, virtual_date: vd, type: 'reminder' });
        } else if (r.recurrence === 'yearly' && bM === cM) {
          const dim = new Date(cY, cM, 0).getDate();
          const vd = `${cY}-${String(cM).padStart(2,'0')}-${String(Math.min(bD,dim)).padStart(2,'0')}`;
          if (vd >= todayStr && vd <= futureStr) upcoming.push({ ...r, virtual_date: vd, type: 'reminder' });
        }
      }
    });

    const seen = new Set();
    const dedupedReminders = upcoming.filter(r => { const k=`${r.id}:${r.virtual_date}`; if(seen.has(k))return false; seen.add(k); return true; });

    res.json({ dayOffs, reminders: dedupedReminders.sort((a,b)=>a.virtual_date.localeCompare(b.virtual_date)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ─── EMPLOYEE PERSONAL REMINDERS ─────────────────────────────────────────────
app.get('/api/employee/reminders', requireAuth, async (req, res) => {
  try {
    const empId = req.user.employee_id;
    if (!empId) return res.status(403).json({ error: 'Employee only' });
    const { rows } = await q(
      'SELECT * FROM employee_reminders WHERE employee_id = ? ORDER BY reminder_date NULLS LAST, created_at DESC',
      [empId]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/employee/reminders', requireAuth, async (req, res) => {
  try {
    const empId = req.user.employee_id;
    if (!empId) return res.status(403).json({ error: 'Employee only' });
    const { title, reminder_date } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    await q(
      'INSERT INTO employee_reminders (employee_id, title, reminder_date) VALUES (?,?,?)',
      [empId, title.trim(), reminder_date || null]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/employee/reminders/:id/done', requireAuth, async (req, res) => {
  try {
    const empId = req.user.employee_id;
    await q('UPDATE employee_reminders SET is_done = NOT is_done WHERE id = ? AND employee_id = ?', [req.params.id, empId]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/employee/reminders/:id', requireAuth, async (req, res) => {
  try {
    const empId = req.user.employee_id;
    await q('DELETE FROM employee_reminders WHERE id = ? AND employee_id = ?', [req.params.id, empId]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── DEAL TRACKER ─────────────────────────────────────────────────────────────
app.get('/api/deal-tracker', requireAuth, async (req, res) => {
  try {
    await ensureDb();
    const { rows } = await q('SELECT * FROM deal_tracker ORDER BY sort_order ASC, created_at ASC');
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/deal-tracker', requireAuth, async (req, res) => {
  try {
    await ensureDb();
    const { month_label='', company, paid_inc_vat=null, deal_amount=null, tax_vat=null,
            date_invoice_issued=null, date_paid=null, bank='', invoice_number='', notes='',
            invoice_sent='no', signature_received='no', initials='', row_color='green', status='active', sort_order=0 } = req.body;
    if (!company) return res.status(400).json({ error: 'company required' });
    const { rows } = await q(
      `INSERT INTO deal_tracker (month_label,company,paid_inc_vat,deal_amount,tax_vat,date_invoice_issued,date_paid,bank,invoice_number,notes,invoice_sent,signature_received,initials,row_color,status,sort_order,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
      [month_label,company,paid_inc_vat||null,deal_amount||null,tax_vat||null,
       date_invoice_issued||null,date_paid||null,bank,invoice_number,notes,
       invoice_sent,signature_received,initials,row_color,status,sort_order,req.user.id||null]
    );
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/deal-tracker/:id', requireAuth, async (req, res) => {
  try {
    await ensureDb();
    const { month_label, company, paid_inc_vat, deal_amount, tax_vat,
            date_invoice_issued, date_paid, bank, invoice_number, notes,
            invoice_sent, signature_received, initials, row_color, status, is_flagged, sort_order } = req.body;
    const { rows } = await q(
      `UPDATE deal_tracker SET month_label=?,company=?,paid_inc_vat=?,deal_amount=?,tax_vat=?,
       date_invoice_issued=?,date_paid=?,bank=?,invoice_number=?,notes=?,
       invoice_sent=?,signature_received=?,initials=?,row_color=?,status=?,is_flagged=?,sort_order=?
       WHERE id=? RETURNING *`,
      [month_label,company,paid_inc_vat||null,deal_amount||null,tax_vat||null,
       date_invoice_issued||null,date_paid||null,bank,invoice_number,notes,
       invoice_sent,signature_received,initials,row_color,status||'active',is_flagged?true:false,sort_order||0,req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/deal-tracker/:id', requireAuth, async (req, res) => {
  try {
    await ensureDb();
    await q('DELETE FROM deal_tracker WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/deal-tracker/auto-colour', requireAuth, async (req, res) => {
  try {
    await ensureDb();
    const { rows: paid } = await q(`UPDATE deal_tracker SET row_color='green' WHERE (paid_inc_vat IS NOT NULL AND paid_inc_vat > 0) AND row_color='none' RETURNING id`);
    const { rows: unpaid } = await q(`UPDATE deal_tracker SET row_color='none' WHERE (paid_inc_vat IS NULL OR paid_inc_vat = 0) AND row_color='green' RETURNING id`);
    res.json({ ok: true, updated: paid.length + unpaid.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/deal-tracker/bulk', requireAuth, async (req, res) => {
  try {
    await ensureDb();
    const { deals } = req.body;
    if (!Array.isArray(deals) || !deals.length) return res.status(400).json({ error: 'No deals provided' });
    let count = 0;
    for (let i = 0; i < deals.length; i++) {
      const d = deals[i];
      if (!d.company) continue;
      await q(
        `INSERT INTO deal_tracker (month_label,company,paid_inc_vat,deal_amount,tax_vat,date_invoice_issued,date_paid,bank,invoice_number,notes,invoice_sent,signature_received,initials,row_color,sort_order,created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [d.month_label||'', d.company, d.paid_inc_vat||null, d.deal_amount||null, d.tax_vat||null,
         d.date_invoice_issued||null, d.date_paid||null, d.bank||'', d.invoice_number||'', d.notes||'',
         d.invoice_sent||'no', d.signature_received||'no', d.initials||'', d.row_color||'green',
         i, req.user.id||null]
      );
      count++;
    }
    res.json({ ok: true, count });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── DEAL INVOICES ────────────────────────────────────────────────────────────
app.get('/api/deal-tracker/:id/invoices', requireAuth, async (req, res) => {
  try {
    await ensureDb();
    const { rows } = await q(
      'SELECT id, deal_id, file_type, file_name, file_size, created_at FROM deal_invoices WHERE deal_id=? ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/deal-tracker/:id/invoices', requireAuth, async (req, res) => {
  try {
    await ensureDb();
    const { file_name, file_type, file_data, file_size } = req.body;
    if (!file_data) return res.status(400).json({ error: 'No file data' });
    if ((file_size || 0) > 10 * 1024 * 1024) return res.status(400).json({ error: 'File too large (max 10 MB)' });
    const { rows } = await q(
      'INSERT INTO deal_invoices (deal_id,file_type,file_name,file_data,file_size,created_by) VALUES (?,?,?,?,?,?) RETURNING id,deal_id,file_type,file_name,file_size,created_at',
      [req.params.id, file_type, file_name, file_data, file_size || 0, req.user.id || null]
    );
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/deal-invoices/:id/download', requireAuth, async (req, res) => {
  try {
    await ensureDb();
    const { rows } = await q('SELECT file_name, file_type, file_data FROM deal_invoices WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/deal-invoices/:id', requireAuth, async (req, res) => {
  try {
    await ensureDb();
    await q('DELETE FROM deal_invoices WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
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

// ─── EMPLOYEE PORTAL (PIN auth, no session) ───────────────────────────────────

app.get('/portal', (req, res) => res.sendFile(path.join(__dirname, 'public', 'portal.html')));

app.post('/api/portal/auth', async (req, res) => {
  try {
    const { employee_id, pin } = req.body;
    if (!employee_id || !pin) return res.status(400).json({ error: 'ID and PIN required' });
    const { rows } = await q('SELECT id, name, job_title, department, employment_type, annual_salary, currency, start_date, portal_pin FROM employees WHERE id = ? AND active = true', [employee_id]);
    const emp = rows[0];
    if (!emp || !emp.portal_pin) return res.status(401).json({ error: 'Invalid credentials' });
    if (String(emp.portal_pin) !== String(pin).trim()) return res.status(401).json({ error: 'Invalid PIN' });
    res.json({ id: emp.id, name: emp.name, job_title: emp.job_title, department: emp.department, employment_type: emp.employment_type, annual_salary: emp.annual_salary, currency: emp.currency, start_date: emp.start_date });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/portal/holiday-request', async (req, res) => {
  try {
    const { employee_id, pin, date, type, note } = req.body;
    const { rows: empRows } = await q('SELECT id, name, portal_pin FROM employees WHERE id = ? AND active = true', [employee_id]);
    const emp = empRows[0];
    if (!emp || String(emp.portal_pin) !== String(pin).trim()) return res.status(401).json({ error: 'Invalid credentials' });
    // Check for duplicate pending/approved request for same date
    const { rows: existing } = await q(
      `SELECT id FROM holiday_requests WHERE employee_id = ? AND request_date = ? AND status IN ('pending','approved')`,
      [employee_id, date]
    );
    if (existing.length > 0) return res.status(409).json({ error: 'A request for this date already exists.' });
    await q(
      `INSERT INTO holiday_requests (employee_id, request_date, day_type, note) VALUES (?, ?, ?, ?)`,
      [employee_id, date, type === 'half' ? 'half' : 'full', note || '']
    );
    // Send admin email notification
    await sendAdminEmail(
      `Holiday Request: ${emp.name}`,
      `<p><strong>${emp.name}</strong> has requested a day off.</p>
       <p><strong>Date:</strong> ${date}<br><strong>Type:</strong> ${type === 'half' ? 'Half Day' : 'Full Day'}<br><strong>Note:</strong> ${note || '—'}</p>
       <p>Log in to EmpTracker to approve or deny this request.</p>`
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Holiday Requests (admin) ────────────────────────────────────────────────

app.get('/api/holiday-requests', requireAuth, async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const { rows } = await q(
      `SELECT hr.id, hr.employee_id, e.name AS employee_name, hr.request_date, hr.day_type, hr.note,
              hr.status, hr.reviewed_by, hr.reviewed_at, hr.created_at
       FROM holiday_requests hr
       JOIN employees e ON e.id = hr.employee_id
       WHERE hr.status = ?
       ORDER BY hr.created_at DESC`,
      [status]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/holiday-requests/count', requireAuth, async (req, res) => {
  try {
    const { rows } = await q(`SELECT COUNT(*) AS c FROM holiday_requests WHERE status = 'pending'`);
    res.json({ count: parseInt(rows[0].c) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/holiday-requests/:id/approve', requireAuth, async (req, res) => {
  try {
    const { rows: hrRows } = await q('SELECT * FROM holiday_requests WHERE id = ?', [req.params.id]);
    const hr = hrRows[0];
    if (!hr) return res.status(404).json({ error: 'Request not found' });
    if (hr.status !== 'pending') return res.status(400).json({ error: 'Request already reviewed' });
    const dayOff = hr.day_type === 'half' ? 0.5 : 1;
    await q(
      `INSERT INTO daily_records (employee_id, record_date, is_day_off, notes)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (employee_id, record_date) DO UPDATE SET is_day_off = EXCLUDED.is_day_off, notes = EXCLUDED.notes`,
      [hr.employee_id, hr.request_date, dayOff, hr.note || 'Portal request (approved)']
    );
    await q(
      `UPDATE holiday_requests SET status = 'approved', reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
      [req.admin.id, req.params.id]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/holiday-requests/:id/deny', requireAuth, async (req, res) => {
  try {
    const { rows: hrRows } = await q('SELECT * FROM holiday_requests WHERE id = ?', [req.params.id]);
    const hr = hrRows[0];
    if (!hr) return res.status(404).json({ error: 'Request not found' });
    if (hr.status !== 'pending') return res.status(400).json({ error: 'Request already reviewed' });
    await q(
      `UPDATE holiday_requests SET status = 'denied', reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
      [req.admin.id, req.params.id]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Portal calendar (no admin reminders — days off only) ────────────────────

app.get('/api/portal/calendar', async (req, res) => {
  try {
    const { employee_id, pin, year, month } = req.query;
    if (!employee_id || !pin) return res.status(401).json({ error: 'Authentication required' });
    const { rows: empRows } = await q('SELECT id, portal_pin FROM employees WHERE id = ? AND active = true', [employee_id]);
    const emp = empRows[0];
    if (!emp || String(emp.portal_pin) !== String(pin).trim()) return res.status(401).json({ error: 'Invalid credentials' });
    const y = parseInt(year) || new Date().getFullYear();
    const m = parseInt(month);
    const allYear = !m || isNaN(m);
    // All days off for all employees in the requested month (or full year)
    const { rows: daysOff } = allYear
      ? await q(
          `SELECT dr.employee_id, e.name AS employee_name, dr.record_date::TEXT AS record_date, dr.is_day_off
           FROM daily_records dr
           JOIN employees e ON e.id = dr.employee_id
           WHERE dr.is_day_off > 0 AND EXTRACT(YEAR FROM dr.record_date) = ?
           ORDER BY dr.record_date`, [y])
      : await q(
          `SELECT dr.employee_id, e.name AS employee_name, dr.record_date::TEXT AS record_date, dr.is_day_off
           FROM daily_records dr
           JOIN employees e ON e.id = dr.employee_id
           WHERE dr.is_day_off > 0
             AND EXTRACT(YEAR FROM dr.record_date) = ?
             AND EXTRACT(MONTH FROM dr.record_date) = ?
           ORDER BY dr.record_date`,
          [y, m]);
    // Upcoming days off for all employees (next 60 days)
    const { rows: upcoming } = await q(
      `SELECT dr.employee_id, e.name AS employee_name, dr.record_date::TEXT AS record_date, dr.is_day_off
       FROM daily_records dr
       JOIN employees e ON e.id = dr.employee_id
       WHERE dr.is_day_off > 0 AND dr.record_date >= CURRENT_DATE
       ORDER BY dr.record_date
       LIMIT 20`
    );
    res.json({ days_off: daysOff, upcoming });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── START ────────────────────────────────────────────────────────────────────

// ─── INVOICE GENERATOR ───────────────────────────────────────────────────────
app.post('/api/generate-invoice', requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    const templatePath = path.join(__dirname, 'public', 'invoice_template.docx');
    if (!fs.existsSync(templatePath)) return res.status(404).json({ error: 'Invoice template not found' });
    const content = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
      delimiters: { start: '{{', end: '}}' },
      paragraphLoop: true,
      linebreaks: true
    });
    const {
      contact_name = '', company_name = '', address = '', email = '',
      invoice_number = '', date = '', event_name = '', package_name = '',
      amount_ex_vat = '', vat_amount = '', total_due = '', client_name = '',
      benefits = [], additional_notes = ''
    } = req.body;
    const benefitsArr = Array.isArray(benefits) ? benefits : String(benefits).split('\n').map(s => s.trim()).filter(Boolean);
    doc.render({ contact_name, company_name, address, email, invoice_number, date,
      event_name, package_name, amount_ex_vat, vat_amount, total_due, client_name,
      benefits: benefitsArr, additional_notes });
    const buf = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
    const filename = `LPGPCONNECTCOMLTD${invoice_number || 'DRAFT'}.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── EVENT KITS ─────────────────────────────────────────────────────────────

app.get('/api/event-kits', requireAuth, async (req, res) => {
  try {
    const isStaff = req.admin.role === 'employee';
    let rows;
    if (isStaff) {
      const email = req.admin.email || '';
      const { rows: r } = await q(`
        SELECT ek.id, ek.event_id, pe.name AS event_name, pe.event_date,
          ek.agenda_file, ek.brochure_url, ek.brochure_file,
          ek.banner_url, ek.banner_file, ek.roundtable_url, ek.roundtable_file,
          ek.presentation_url, ek.presentation_file, ek.backdrop_url, ek.backdrop_file,
          ek.name_badges_url, ek.name_badges_file, ek.access_emails, ek.notes
        FROM event_kits ek
        JOIN portfolio_events pe ON pe.id = ek.event_id
        WHERE ek.access_emails::text ILIKE ?
        ORDER BY pe.event_date DESC NULLS LAST`, [`%${email}%`]);
      rows = r;
    } else {
      const { rows: r } = await q(`
        SELECT ek.id, ek.event_id, pe.name AS event_name, pe.event_date,
          ek.agenda_file, ek.brochure_url, ek.brochure_file,
          ek.banner_url, ek.banner_file, ek.roundtable_url, ek.roundtable_file,
          ek.presentation_url, ek.presentation_file, ek.backdrop_url, ek.backdrop_file,
          ek.name_badges_url, ek.name_badges_file, ek.access_emails, ek.notes
        FROM event_kits ek
        JOIN portfolio_events pe ON pe.id = ek.event_id
        ORDER BY pe.event_date DESC NULLS LAST`);
      rows = r;
    }
    res.json(rows.map(r => ({ ...r, access_emails: safeJsonParse(r.access_emails, []) })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/event-kits/:eventId', requireAuth, async (req, res) => {
  try {
    const { rows } = await q('SELECT * FROM event_kits WHERE event_id=?', [req.params.eventId]);
    if (!rows.length) return res.json(null);
    const kit = rows[0];
    kit.access_emails = safeJsonParse(kit.access_emails, []);
    res.json(kit);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/event-kits/:eventId/file/:type', requireAuth, async (req, res) => {
  try {
    const type = req.params.type;
    const col = type + '_data', nameCol = type + '_file';
    const { rows } = await q(`SELECT ${col}, ${nameCol} FROM event_kits WHERE event_id=?`, [req.params.eventId]);
    if (!rows.length || !rows[0][col]) return res.status(404).json({ error: 'No file' });
    const name = rows[0][nameCol] || 'file';
    const ext = name.split('.').pop().toLowerCase();
    const mimes = { pdf:'application/pdf', pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation', ppt:'application/vnd.ms-powerpoint', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg' };
    res.setHeader('Content-Type', mimes[ext] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${name}"`);
    res.send(Buffer.from(rows[0][col], 'base64'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Employee agenda upload — any authenticated user can upload for any event
app.patch('/api/event-kits/:eventId/agenda', requireAuth, async (req, res) => {
  try {
    const eid = req.params.eventId;
    const { agenda_file, agenda_data } = req.body;
    const { rows: exist } = await q('SELECT id FROM event_kits WHERE event_id=?', [eid]);
    if (exist.length) {
      await q('UPDATE event_kits SET agenda_file=?, agenda_data=?, updated_at=NOW() WHERE event_id=?', [agenda_file||'', agenda_data||'', eid]);
    } else {
      await q('INSERT INTO event_kits (event_id, agenda_file, agenda_data, created_by) VALUES (?,?,?,?)', [eid, agenda_file||'', agenda_data||'', req.admin.id]);
    }
    // Notify admins/managers if an employee uploaded (not clearing)
    if (agenda_file && req.admin.role === 'employee') {
      const { rows: ev } = await q('SELECT name FROM portfolio_events WHERE id=?', [eid]);
      const evName = ev[0]?.name || `Event #${eid}`;
      await q(
        'INSERT INTO agenda_notifications (event_id, event_name, employee_id, employee_name) VALUES (?,?,?,?)',
        [eid, evName, req.admin.id, req.admin.username || req.admin.name || 'Employee']
      );
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/agenda-notifications', requireAuth, async (req, res) => {
  try {
    const { rows } = await q('SELECT * FROM agenda_notifications WHERE is_read = FALSE ORDER BY uploaded_at DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/agenda-notifications/:id/read', requireAuth, async (req, res) => {
  try {
    await q('UPDATE agenda_notifications SET is_read = TRUE WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/event-kits/:eventId', requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    const eid = req.params.eventId;
    const fields = ['agenda_file','agenda_data','brochure_url','brochure_file','brochure_data',
      'banner_url','banner_file','banner_data','roundtable_url','roundtable_file','roundtable_data',
      'presentation_url','presentation_file','presentation_data','backdrop_url','backdrop_file','backdrop_data',
      'name_badges_url','name_badges_file','name_badges_data','access_emails','notes'];
    const body = req.body;
    const vals = fields.map(f => f === 'access_emails' ? JSON.stringify(Array.isArray(body[f]) ? body[f] : []) : (body[f] ?? ''));
    const { rows: exist } = await q('SELECT id FROM event_kits WHERE event_id=?', [eid]);
    if (exist.length) {
      await q(`UPDATE event_kits SET ${fields.map(f => `${f}=?`).join(', ')}, updated_at=NOW() WHERE event_id=?`, [...vals, eid]);
    } else {
      const cols = ['event_id', ...fields, 'created_by'].join(', ');
      await q(`INSERT INTO event_kits (${cols}) VALUES (${Array(fields.length + 2).fill('?').join(', ')})`, [eid, ...vals, req.admin.id]);
    }
    const { rows } = await q('SELECT id FROM event_kits WHERE event_id=?', [eid]);
    res.json({ ok: true, id: rows[0]?.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Employee Time Tracker running on http://localhost:${PORT}`);
    console.log('Default login: admin / admin123');
  });
}
