const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Build connection config — support DATABASE_URL or individual POSTGRES_* vars
function getPoolConfig() {
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    console.log('Using DATABASE_URL, hostname:', new URL(dbUrl).hostname);
    return { connectionString: dbUrl, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false };
  }
  // Fallback: Zeabur individual env vars
  const host = process.env.POSTGRES_HOST;
  const port = process.env.POSTGRES_PORT || 5432;
  const user = process.env.POSTGRES_USERNAME || process.env.POSTGRES_USER || 'root';
  const password = process.env.POSTGRES_PASSWORD;
  const database = process.env.POSTGRES_DATABASE || process.env.POSTGRES_DB || 'zeabur';
  if (host && password) {
    console.log('Using individual POSTGRES_* vars, host:', host, 'port:', port);
    return { host, port: parseInt(port), user, password, database, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false };
  }
  console.error('No DATABASE_URL or POSTGRES_* environment variables found!');
  return { connectionString: 'postgresql://localhost:5432/scredirect' };
}

const pool = new Pool(getPoolConfig());

// Convert ? placeholders to $1, $2, ... for PostgreSQL
function pg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => '$' + (++i));
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'User',
      status TEXT DEFAULT 'Active',
      created TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      html_code TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      created TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS versions (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL,
      version TEXT,
      file_name TEXT,
      file_path TEXT,
      original_name TEXT,
      notes TEXT,
      date TEXT,
      active INTEGER DEFAULT 0
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS domains (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      page_id TEXT,
      dns_type TEXT DEFAULT 'A',
      dns_value TEXT,
      auto_ssl INTEGER DEFAULT 1,
      ssl_active INTEGER DEFAULT 0,
      ssl_date TEXT,
      notes TEXT,
      created TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity (
      id SERIAL PRIMARY KEY,
      action TEXT,
      details TEXT,
      user_name TEXT,
      date TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_blocks (
      id SERIAL PRIMARY KEY,
      ip TEXT NOT NULL,
      user_agent TEXT,
      reason TEXT NOT NULL,
      block_type TEXT NOT NULL,
      path TEXT,
      created TEXT NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_ip_list (
      id SERIAL PRIMARY KEY,
      ip TEXT NOT NULL,
      list_type TEXT NOT NULL,
      note TEXT,
      created TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS visitor_logs (
      id SERIAL PRIMARY KEY,
      ip TEXT NOT NULL,
      country_code TEXT,
      country_name TEXT,
      region_name TEXT,
      city_name TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      isp TEXT,
      domain TEXT,
      usage_type TEXT,
      proxy_flags TEXT,
      user_agent TEXT,
      path TEXT,
      page_id TEXT,
      is_blocked INTEGER DEFAULT 0,
      block_reason TEXT,
      created TEXT NOT NULL
    )
  `);

  // Seed default admin
  const adminCheck = await pool.query("SELECT id FROM users WHERE role = 'Admin' LIMIT 1");
  if (adminCheck.rows.length === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    await pool.query(
      'INSERT INTO users (id, name, email, password, role, status, created) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, 'Admin', 'admin@admin.com', hash, 'Admin', 'Active', new Date().toISOString().split('T')[0]]
    );
    console.log('Default admin created: admin@admin.com / admin123');
  }
}

async function queryAll(sql, params) {
  const result = await pool.query(pg(sql), params);
  return result.rows;
}

async function queryOne(sql, params) {
  const result = await pool.query(pg(sql), params);
  return result.rows.length > 0 ? result.rows[0] : null;
}

async function runSql(sql, params) {
  await pool.query(pg(sql), params);
}

// Raw query (no placeholder conversion — use $1, $2 directly)
async function rawQueryAll(sql, params) {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function rawQueryOne(sql, params) {
  const result = await pool.query(sql, params);
  return result.rows.length > 0 ? result.rows[0] : null;
}

module.exports = { initDb, queryAll, queryOne, runSql, rawQueryAll, rawQueryOne };
