const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

// Create an HTTP-based SQL client — no persistent TCP connections, no stale TLS issues
const sql = connectionString ? neon(connectionString) : null;

async function initDb() {
  if (!sql) throw new Error('DATABASE_URL or POSTGRES_URL environment variable is not set');

  await sql(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'manager',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await sql(`
    CREATE TABLE IF NOT EXISTS employees (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      daily_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
      active INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await sql(`
    ALTER TABLE employees
      ADD COLUMN IF NOT EXISTS employment_type TEXT NOT NULL DEFAULT 'payroll',
      ADD COLUMN IF NOT EXISTS annual_salary NUMERIC(12,2) NOT NULL DEFAULT 0
  `);

  await sql(`
    CREATE TABLE IF NOT EXISTS daily_records (
      id SERIAL PRIMARY KEY,
      employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      record_date DATE NOT NULL,
      break_minutes INT NOT NULL DEFAULT 0,
      phone_minutes INT NOT NULL DEFAULT 0,
      wasted_minutes INT NOT NULL DEFAULT 0,
      late_minutes INT NOT NULL DEFAULT 0,
      is_day_off NUMERIC(3,1) NOT NULL DEFAULT 0,
      notes TEXT DEFAULT '',
      created_by INT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(employee_id, record_date)
    )
  `);

  await sql(`
    DO $$ BEGIN
      IF (SELECT data_type FROM information_schema.columns
          WHERE table_name='daily_records' AND column_name='is_day_off') = 'integer' THEN
        ALTER TABLE daily_records
          ALTER COLUMN is_day_off TYPE NUMERIC(3,1)
          USING is_day_off::NUMERIC(3,1);
      END IF;
    END $$
  `);

  await sql(`
    CREATE TABLE IF NOT EXISTS manual_adjustments (
      id SERIAL PRIMARY KEY,
      employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      record_date DATE NOT NULL,
      adjustment_minutes INT NOT NULL,
      reason TEXT NOT NULL,
      created_by INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await sql(`
    CREATE TABLE IF NOT EXISTS monthly_payments (
      id SERIAL PRIMARY KEY,
      employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      payment_year INT NOT NULL,
      payment_month INT NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      notes TEXT DEFAULT '',
      created_by INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const rows = await sql('SELECT COUNT(*) AS c FROM admins');
  if (parseInt(rows[0].c) === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    await sql(`INSERT INTO admins (username, password_hash, role) VALUES ($1, $2, 'admin')`,
      ['admin', hash]);
    console.log('Default admin created: username=admin password=admin123');
  }
}

module.exports = { sql, initDb };
