/**
 * Proxy Router – Whitelist API Server
 * Node.js + Express, managed by PM2
 *
 * POST   /api/whitelist  { "ip": "1.2.3.4" } (if ip is omitted, uses client's detected public IP)
 * DELETE /api/whitelist  { "ip": "1.2.3.4" }
 * GET    /api/whitelist  → returns { "ips": ["1.2.3.4", ...] }
 * GET    /health         → { "ok": true }
 */

'use strict';

const express    = require('express');
const { execFile } = require('child_process');
const path       = require('path');
const fs         = require('fs');
const os         = require('os');

// ── Config (override via environment variables) ──────────────────────────────
const PORT        = parseInt(process.env.PORT ?? '1135', 10);
const AUTH_TOKEN  = process.env.AUTH_TOKEN  ?? '';
const AUTH_TOKENS = (process.env.AUTH_TOKENS ?? '').split(',').map(t => t.trim()).filter(Boolean);
const TOKENS_FILE = process.env.TOKENS_FILE ?? path.join(__dirname, 'tokens.json');
const SCRIPT      = process.env.IP_MANAGER_SCRIPT ?? path.join(__dirname, 'ip_manager.sh');
const LOG_FILE    = process.env.LOG_FILE ?? path.join(__dirname, 'logs', 'api.log');

// ── Logger ───────────────────────────────────────────────────────────────────
const logDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

function log(level, msg, meta = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...meta,
  });
  fs.appendFileSync(LOG_FILE, line + os.EOL);
  console.log(line);
}

// ── Multi-token validation helper ────────────────────────────────────────────
function isTokenValid(token) {
  if (!token) return false;

  // 1. Single primary token
  if (AUTH_TOKEN && token === AUTH_TOKEN) return { valid: true, user: 'primary' };

  // 2. Comma-separated list in AUTH_TOKENS
  if (AUTH_TOKENS.includes(token)) return { valid: true, user: 'env-user' };

  // 3. tokens.json file (key-value mapping of token -> user name or array of tokens)
  if (fs.existsSync(TOKENS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
      if (Array.isArray(data) && data.includes(token)) {
        return { valid: true, user: 'token-list' };
      }
      if (typeof data === 'object' && data !== null && data[token]) {
        return { valid: true, user: data[token] };
      }
    } catch (err) {
      log('warn', 'Failed to read tokens.json', { error: err.message });
    }
  }

  // If no auth tokens configured anywhere, accept all (warning)
  if (!AUTH_TOKEN && AUTH_TOKENS.length === 0 && !fs.existsSync(TOKENS_FILE)) {
    return { valid: true, user: 'anonymous' };
  }

  return { valid: false };
}

// ── IP validation ─────────────────────────────────────────────────────────────
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
function isValidIp(ip) {
  if (!ip || !IPV4_RE.test(ip)) return false;
  return ip.split('.').every(n => parseInt(n, 10) <= 255);
}

function extractClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  let raw = forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress;
  if (raw && raw.startsWith('::ffff:')) {
    raw = raw.replace('::ffff:', '');
  }
  return raw;
}

// ── Shell helper ─────────────────────────────────────────────────────────────
function runScript(action, ip) {
  return new Promise((resolve, reject) => {
    execFile('bash', [SCRIPT, action, ip], { timeout: 10_000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

// ── Express app ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// ── CORS Middleware (Required for desktop WebViews and browsers) ──────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Request logger middleware
app.use((req, _res, next) => {
  log('info', `${req.method} ${req.path}`, { remoteIp: extractClientIp(req) });
  next();
});

// Auth middleware
function requireAuth(req, res, next) {
  const header = req.headers['authorization'] ?? '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : header;
  const auth   = isTokenValid(token);

  if (!auth.valid) {
    log('warn', 'Unauthorized request', { path: req.path, remoteIp: extractClientIp(req) });
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }

  req.authUserName = auth.user;
  next();
}

// ── Routes ───────────────────────────────────────────────────────────────────

/** Health check */
app.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

/** Add IP to whitelist */
app.post('/api/whitelist', requireAuth, async (req, res) => {
  let targetIp = req.body?.ip;
  if (!targetIp) {
    targetIp = extractClientIp(req);
  }

  if (!targetIp || !isValidIp(targetIp)) {
    return res.status(400).json({ error: `Invalid or undetectable IP address: ${targetIp}` });
  }

  try {
    const out = await runScript('add', targetIp);
    log('info', `IP whitelisted: ${targetIp}`, { user: req.authUserName, output: out });
    res.json({ ok: true, ip: targetIp, action: 'added', user: req.authUserName, output: out });
  } catch (err) {
    log('error', `Failed to whitelist IP: ${targetIp}`, { error: err.message });
    res.status(500).json({ error: 'Script execution failed', detail: err.message });
  }
});

/** Remove IP from whitelist */
app.delete('/api/whitelist', requireAuth, async (req, res) => {
  let targetIp = req.body?.ip;
  if (!targetIp) {
    targetIp = extractClientIp(req);
  }

  if (!targetIp || !isValidIp(targetIp)) {
    return res.status(400).json({ error: `Invalid or missing IP address: ${targetIp}` });
  }

  try {
    const out = await runScript('remove', targetIp);
    log('info', `IP removed: ${targetIp}`, { user: req.authUserName, output: out });
    res.json({ ok: true, ip: targetIp, action: 'removed', user: req.authUserName, output: out });
  } catch (err) {
    log('error', `Failed to remove IP: ${targetIp}`, { error: err.message });
    res.status(500).json({ error: 'Script execution failed', detail: err.message });
  }
});

/** Get current whitelist */
app.get('/api/whitelist', requireAuth, (_req, res) => {
  const WHITELIST_FILE = process.env.WHITELIST_FILE ?? '/etc/squid/whitelist.txt';
  try {
    if (!fs.existsSync(WHITELIST_FILE)) return res.json({ ips: [] });
    const ips = fs
      .readFileSync(WHITELIST_FILE, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && isValidIp(l));
    res.json({ ips, total: ips.length });
  } catch (err) {
    res.status(500).json({ error: 'Could not read whitelist', detail: err.message });
  }
});

// 404 fallback
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler
app.use((err, _req, res, _next) => {
  log('error', 'Unhandled error', { error: err.message });
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  log('info', `Whitelist API started`, { port: PORT });
});
