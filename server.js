'use strict';
/*
 * Kto wygrał dzień? — tiny zero-dependency server.
 * Serves the static frontend and persists entries to data.json
 * (repo root) via atomic write-then-rename. No database, no build step.
 */

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data.json');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = process.env.PORT || 3000;

const SEED = [0, 3, 3, 7, 2, 2, 2, 10, 4, 1, 7, 7, 7, 5, 8, 3, 11, 6, 2, 2, 9, 4, 4, 2];
const MEMBER_COUNT = 12;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COMMENT_MAX_LEN = 300;

function isoOf(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function seedEntries() {
  const today = new Date();
  return SEED.map((winnerId, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (SEED.length - i));
    return { date: isoOf(d), winnerId };
  });
}

function sortEntries(list) {
  list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return list;
}

function isValidEntry(body) {
  if (!body || !DATE_RE.test(body.date) || !Number.isInteger(body.winnerId)) return false;
  if (body.winnerId < 0 || body.winnerId >= MEMBER_COUNT) return false;
  if (body.comment !== undefined && body.comment !== null) {
    if (typeof body.comment !== 'string' || body.comment.length > COMMENT_MAX_LEN) return false;
  }
  return true;
}

// --- in-memory cache + serialized persistence -------------------------

let entries = [];
let writeChain = Promise.resolve();

async function loadEntries() {
  try {
    const raw = await fsp.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    entries = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    entries = seedEntries();
    await persist();
  }
}

function persist() {
  const snapshot = JSON.stringify(entries, null, 2);
  writeChain = writeChain.then(async () => {
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
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1e6) {
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
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

async function serveStatic(req, res) {
  const reqPath = decodeURIComponent(req.url.split('?')[0]);
  const relPath = reqPath === '/' ? '/index.html' : reqPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, relPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
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

// --- routing -------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/entries' && req.method === 'GET') {
      return sendJson(res, 200, entries);
    }

    if (url.pathname === '/api/entries' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!isValidEntry(body)) {
        return sendJson(res, 400, { error: 'Expected { date: "YYYY-MM-DD", winnerId: 0-' + (MEMBER_COUNT - 1) + ', comment?: string up to ' + COMMENT_MAX_LEN + ' chars }' });
      }
      const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
      entries = entries.filter((e) => e.date !== body.date);
      const entry = { date: body.date, winnerId: body.winnerId };
      if (comment) entry.comment = comment;
      entries.push(entry);
      sortEntries(entries);
      await persist();
      return sendJson(res, 200, entries);
    }

    if (url.pathname === '/api/entries/undo' && req.method === 'POST') {
      sortEntries(entries);
      entries.pop();
      await persist();
      return sendJson(res, 200, entries);
    }

    if (url.pathname === '/api/entries/reset' && req.method === 'POST') {
      entries = [];
      await persist();
      return sendJson(res, 200, entries);
    }

    if (url.pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: 'Not found' });
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
    });
  })
  .catch((err) => {
    console.error('Failed to load data.json:', err);
    process.exit(1);
  });
