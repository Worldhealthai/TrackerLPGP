const { Database } = require('node-sqlite3-wasm');
const bcrypt = require('bcryptjs');
const path = require('path');

// On Vercel production the only writable path is /tmp
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'tracker.db');

const db = new Database(DB_PATH);

db.run('PRAGMA journal_mode = WAL');
db.run('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'manager',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    daily_rate REAL NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS daily_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    record_date TEXT NOT NULL,
    break_minutes INTEGER NOT NULL DEFAULT 0,
    phone_minutes INTEGER NOT NULL DEFAULT 0,
    wasted_minutes INTEGER NOT NULL DEFAULT 0,
    late_minutes INTEGER NOT NULL DEFAULT 0,
    is_day_off INTEGER NOT NULL DEFAULT 0,
    notes TEXT DEFAULT '',
    created_by INTEGER,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    UNIQUE(employee_id, record_date)
  );

  CREATE TABLE IF NOT EXISTS manual_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    record_date TEXT NOT NULL,
    adjustment_minutes INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
  );
`);

// Seed default admin if none exist
const adminCount = db.get('SELECT COUNT(*) as c FROM admins');
if (parseInt(adminCount.c) === 0) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.run(`INSERT INTO admins (username, password_hash, role) VALUES (?, ?, 'admin')`,
    ['admin', hash]);
  console.log('Default admin created: username=admin password=admin123');
}

module.exports = db;
