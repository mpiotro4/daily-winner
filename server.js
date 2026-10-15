'use strict';
/*
 * Kto wygrał dzień? — tiny zero-dependency server.
 * Serves the static frontend and persists entries to data.json
 * (repo root) via atomic write-then-rename. No database, no build step.
 *
 * Rules enforced here (not in the browser):
 *  - the date of a verdict is always the server's "today" — clients can't pick it,
 *  - one verdict per day; once saved it can't be changed or removed via HTTP,
 *  - optional ADMIN_PIN env var: when set, announcing requires that PIN.
 */

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data.json');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '';

const MEMBER_COUNT = 12;
const COMMENT_MAX_LEN = 300;
const MAX_PIN_FAILURES = 5;
const PIN_LOCKOUT_MS = 15 * 60 * 1000;

function isoOf(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function todayISO() { return isoOf(new Date()); }

function sortEntries(list) {
  list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return list;
}

function isValidAnnouncement(body) {
  if (!body || !Number.isInteger(body.winnerId)) return false;
  if (body.winnerId < 0 || body.winnerId >= MEMBER_COUNT) return false;
  if (body.comment !== undefined && body.comment !== null) {
    if (typeof body.comment !== 'string' || body.comment.length > COMMENT_MAX_LEN) return false;
  }
  return true;
}

// --- PIN check with per-IP lockout ----------------------------------------

const pinFailures = new Map(); // ip -> { count, lockedUntil }

function pinMatches(given) {
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PIN).digest();
  return crypto.timingSafeEqual(a, b);
}

function checkPin(req) {
  if (!ADMIN_PIN) return { ok: true };
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const rec = pinFailures.get(ip);
  if (rec && rec.lockedUntil > now) return { ok: false, status: 429 };
  if (pinMatches(req.headers['x-admin-pin'])) {
    pinFailures.delete(ip);
    return { ok: true };
  }
  const lockExpired = rec && rec.lockedUntil && rec.lockedUntil <= now;
  const count = (rec && !lockExpired ? rec.count : 0) + 1;
  pinFailures.set(ip, { count, lockedUntil: count >= MAX_PIN_FAILURES ? now + PIN_LOCKOUT_MS : 0 });
  return { ok: false, status: 401 };
}

// --- in-memory cache + serialized persistence -------------------------

let entries = [];
let writeChain = Promise.resolve();

async function loadEntries() {
  let raw;
  try {
    raw = await fsp.readFile(DATA_FILE, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    entries = [];
    await persist();
    return;
  }
  // A corrupt file stops the server instead of being silently overwritten.
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('data.json must contain a JSON array');
  entries = sortEntries(parsed);
}

function persist() {
  const snapshot = JSON.stringify(entries, null, 2);
  // .catch keeps one failed write from blocking every later one.
  writeChain = writeChain.catch(() => {}).then(async () => {
    const tmp = `${DATA_FILE}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, snapshot, 'utf8');
    await fsp.rename(tmp, DATA_FILE);
  });
  return writeChain;
}

// --- tiny HTTP helpers --------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 10000) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        resolve(null);
      }
    });
    req.on('error', reject);
  });
}

async function serveStatic(req, res) {
  let reqPath;
  try {
    reqPath = decodeURIComponent(req.url.split('?')[0]);
  } catch (err) {
    res.writeHead(400);
    return res.end('Bad request');
  }
  const relPath = reqPath === '/' ? '/index.html' : reqPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, relPath));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  try {
    const data = await fsp.readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

function statePayload() {
  return { entries, today: todayISO(), pinRequired: !!ADMIN_PIN };
}

// --- routing -------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/entries' && req.method === 'GET') {
      return sendJson(res, 200, statePayload());
    }

    if (url.pathname === '/api/entries' && req.method === 'POST') {
      const pin = checkPin(req);
      if (!pin.ok) {
        return sendJson(res, pin.status, { error: pin.status === 429 ? 'Too many wrong PINs, try later' : 'Wrong PIN' });
      }
      const body = await readJsonBody(req);
      if (!isValidAnnouncement(body)) {
        return sendJson(res, 400, { error: 'Expected { winnerId: 0-' + (MEMBER_COUNT - 1) + ', comment?: string up to ' + COMMENT_MAX_LEN + ' chars }' });
      }
      const today = todayISO();
      if (entries.some((e) => e.date === today)) {
        return sendJson(res, 409, { error: 'Today already has a verdict', ...statePayload() });
      }
      const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
      const entry = { date: today, winnerId: body.winnerId };
      if (comment) entry.comment = comment;
      const previous = entries;
      entries = sortEntries([...entries, entry]);
      try {
        await persist();
      } catch (err) {
        entries = previous;
        throw err;
      }
      return sendJson(res, 200, statePayload());
    }

    if (url.pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: 'Not found' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      return res.end('Method not allowed');
    }
    return serveStatic(req, res);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: 'Internal error' });
  }
});

loadEntries()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Kto wygrał dzień? running at http://localhost:${PORT}`);
      console.log(`Data file: ${DATA_FILE}`);
      console.log(ADMIN_PIN ? 'Announcing requires ADMIN_PIN.' : 'ADMIN_PIN not set — anyone can announce today\'s winner (once).');
    });
  })
  .catch((err) => {
    console.error('Failed to load data.json:', err);
    process.exit(1);
  });
