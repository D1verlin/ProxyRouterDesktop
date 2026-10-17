/**
 * Proxy Router – Kernel-level Whitelist API Server (GOST v3 + nftables)
 * Node.js + Express
 *
 * Endpoints:
 *   POST   /api/whitelist  { "ip": "1.2.3.4" } (if omitted, uses client's detected public IP)
 *   DELETE /api/whitelist  { "ip": "1.2.3.4" }
 *   GET    /api/whitelist  → returns { "ips": ["1.2.3.4", ...] }
 *   GET    /health         → { "ok": true, "engine": "gost-nftables" }
 */

'use strict';

const express      = require('express');
const { execFile } = require('child_process');
const path         = require('path');
const fs           = require('fs');
const os           = require('os');

// ── Config ────────────────────────────────────────────────────────────────────
const PORT           = parseInt(process.env.PORT ?? '1135', 10);
const AUTH_TOKEN     = process.env.AUTH_TOKEN ?? '';
const AUTH_TOKENS    = (process.env.AUTH_TOKENS ?? '').split(',').map(t => t.trim()).filter(Boolean);
const TOKENS_FILE    = process.env.TOKENS_FILE ?? path.join(__dirname, 'tokens.json');
const SCRIPT         = process.env.IP_MANAGER_SCRIPT ?? path.join(__dirname, 'ip_manager.sh');
const WHITELIST_FILE = process.env.WHITELIST_FILE ?? '/etc/gost/whitelist.txt';
const LOG_FILE       = process.env.LOG_FILE ?? path.join(__dirname, 'logs', 'api.log');

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

// ── Token validation helper ──────────────────────────────────────────────────
function isTokenValid(token) {
  if (!token) return false;

  if (AUTH_TOKEN && token === AUTH_TOKEN) return { valid: true, user: 'primary' };
  if (AUTH_TOKENS.includes(token)) return { valid: true, user: 'env-user' };

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

  return false;
}

// ── IP validation ────────────────────────────────────────────────────────────
function isValidIp(ip) {
  if (typeof ip !== 'string') return false;
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every(p => {
    const n = Number(p);
    return Number.isInteger(n) && n >= 0 && n <= 255 && String(n) === p;
  });
}

function extractClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (isValidIp(first)) return first;
  }
  const raw = req.socket?.remoteAddress ?? '';
  return raw.replace(/^::ffff:/, '');
}

function runScript(action, ip) {
  return new Promise((resolve, reject) => {
    const args = ip ? [action, ip] : [action];
    execFile(SCRIPT, args, { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(stderr.trim() || stdout.trim() || err.message));
      }
      resolve(stdout.trim());
    });
  });
}

// ── Express App ──────────────────────────────────────────────────────────────
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

// Auth middleware
function requireAuth(req, res, next) {
  const header = (req.headers['authorization'] ?? '').trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  let token = match ? match[1].trim() : header;
  token = token.replace(/^Bearer\s+/i, '').trim();

  const authResult = isTokenValid(token);
  if (!authResult) {
    log('warn', 'Unauthorized request', { ip: extractClientIp(req), path: req.path });
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing Bearer token' });
  }

  req.authUserName = authResult.user;
  next();
}

// ── Routes ───────────────────────────────────────────────────────────────────

/** Health check */
app.get('/health', (_req, res) => {
  res.json({ ok: true, engine: 'gost-v3-nftables', timestamp: new Date().toISOString() });
});

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
  try {
    if (!fs.existsSync(WHITELIST_FILE)) return res.json({ ips: [], total: 0 });
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

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, _req, res, _next) => {
  log('error', 'Unhandled error', { error: err.message });
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  log('info', `Whitelist API (GOST) started`, { port: PORT });
});
