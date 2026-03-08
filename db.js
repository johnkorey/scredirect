const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'sc_landing.db');

let db = null;

function saveDb() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

async function initDb() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
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
  db.run(`
    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      html_code TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      created TEXT
    )
  `);
  db.run(`
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
  db.run(`
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
  db.run(`
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT,
      details TEXT,
      user_name TEXT,
      date TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS bot_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      user_agent TEXT,
      reason TEXT NOT NULL,
      block_type TEXT NOT NULL,
      path TEXT,
      created TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS bot_ip_list (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      list_type TEXT NOT NULL,
      note TEXT,
      created TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS visitor_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      country_code TEXT,
      country_name TEXT,
      region_name TEXT,
      city_name TEXT,
      latitude REAL,
      longitude REAL,
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
  const adminCheck = db.exec("SELECT id FROM users WHERE role = 'Admin' LIMIT 1");
  if (adminCheck.length === 0 || adminCheck[0].values.length === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    db.run('INSERT INTO users (id, name, email, password, role, status, created) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, 'Admin', 'admin@admin.com', hash, 'Admin', 'Active', new Date().toISOString().split('T')[0]]
    );
    saveDb();
    console.log('Default admin created: admin@admin.com / admin123');
  }

  return db;
}

// Helper to run queries and return results as array of objects
function queryAll(sql, params) {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function queryOne(sql, params) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function runSql(sql, params) {
  db.run(sql, params);
  saveDb();
}

module.exports = { initDb, queryAll, queryOne, runSql, saveDb, getDb: () => db };
