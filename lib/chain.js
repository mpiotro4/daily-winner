'use strict';
/*
 * "Blockchain" for the verdict log: every entry stores the SHA-256 of
 * (previous entry's hash + its own content). Editing any past verdict by hand
 * breaks every hash from that point on, which verifyChain() reports.
 *
 * It's tamper-evident, not tamper-proof: someone with access to the server
 * can always recompute the whole chain. It catches casual edits of data.json.
 */

const crypto = require('crypto');

const GENESIS = '0'.repeat(64);

function blockHash(prevHash, entry) {
  const payload = JSON.stringify([prevHash, entry.date, entry.winnerId, entry.comment || '']);
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function lastHash(entries) {
  return entries.length ? entries[entries.length - 1].hash : GENESIS;
}

// Recomputes every hash. Only for legitimate admin operations (first-time
// sealing of a legacy file, the CSV import) — never for normal appends.
function sealChain(entries) {
  let prev = GENESIS;
  for (const e of entries) {
    e.hash = blockHash(prev, e);
    prev = e.hash;
  }
  return entries;
}

// Expects entries sorted by date. Returns { ok, blocks, brokenAt, head }.
function verifyChain(entries) {
  let prev = GENESIS;
  for (const e of entries) {
    if (e.hash !== blockHash(prev, e)) {
      return { ok: false, blocks: entries.length, brokenAt: e.date, head: lastHash(entries) || null };
    }
    prev = e.hash;
  }
  return { ok: true, blocks: entries.length, brokenAt: null, head: prev };
}

module.exports = { GENESIS, blockHash, lastHash, sealChain, verifyChain };
