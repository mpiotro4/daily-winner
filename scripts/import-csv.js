'use strict';
/*
 * One-off import of the old "Kronika Zwycięzców Dnia" spreadsheet export into data.json.
 *
 *   node scripts/import-csv.js path/to/zwyciezca_dnia.csv            # dry run, prints what would change
 *   node scripts/import-csv.js path/to/zwyciezca_dnia.csv --write    # actually writes data.json
 *
 * STOP THE SERVER FIRST: it keeps entries in memory and would overwrite the
 * imported file on its next save.
 *
 * Rules: rows without a winner are skipped, dates already in data.json are never
 * overwritten, and nothing dated today or later is imported.
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data.json');

// Must match MEMBERS in public/app.js (index = winnerId).
const MEMBER_NAMES = [
  'Łukasz Kaniecki', 'Marcin Piotrowski', 'Natalia Pietnoczko', 'Paweł Gawędzki',
  'Piotr Pawłowski', 'Radosław Sęk', 'Sławomir Kwiatkowski', 'Zuzanna Adamiec',
  'Dominik Oczoś', 'Filip Liwiński', 'Grzegorz Izdebski', 'Jakub Gaj',
];
const COMMENT_MAX_LEN = 300;

// Columns: 📅 Data, 📆 Dzień tygodnia, 👑 Zwycięzca Dnia, 💬 Werdykt Pawła, ...
const COL_DATE = 0;
const COL_WINNER = 2;
const COL_COMMENT = 3;

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function main() {
  const [csvPath, flag] = process.argv.slice(2);
  if (!csvPath) {
    console.error('Usage: node scripts/import-csv.js <file.csv> [--write]');
    process.exit(1);
  }
  const write = flag === '--write';

  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, ''));
  const today = todayISO();
  const imported = [];
  const problems = [];

  for (const r of rows) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec((r[COL_DATE] || '').trim());
    if (!m) continue; // title, blank and header rows
    const date = m[1];
    const name = (r[COL_WINNER] || '').trim();
    if (!name) continue; // weekend / day off
    const winnerId = MEMBER_NAMES.indexOf(name);
    if (winnerId === -1) { problems.push(`${date}: unknown player "${name}"`); continue; }
    if (date >= today) { problems.push(`${date}: today or in the future, skipped`); continue; }
    const comment = (r[COL_COMMENT] || '').trim().slice(0, COMMENT_MAX_LEN);
    const entry = { date, winnerId };
    if (comment) entry.comment = comment;
    imported.push(entry);
  }

  let existing = [];
  if (fs.existsSync(DATA_FILE)) {
    existing = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!Array.isArray(existing)) throw new Error('data.json must contain a JSON array');
  }
  const taken = new Set(existing.map((e) => e.date));
  const toAdd = imported.filter((e) => !taken.has(e.date));
  const kept = imported.length - toAdd.length;

  console.log(`CSV verdicts found:        ${imported.length}`);
  console.log(`Already in data.json, kept: ${kept}`);
  console.log(`New entries to add:         ${toAdd.length}`);
  if (problems.length) console.log('Problems:\n  ' + problems.join('\n  '));

  if (!write) {
    console.log('\nDry run — nothing written. Re-run with --write to apply.');
    return;
  }
  if (problems.some((p) => p.includes('unknown player'))) {
    console.error('\nRefusing to write: fix unknown player names first.');
    process.exit(1);
  }

  const merged = [...existing, ...toAdd].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, DATA_FILE + '.bak');
  const tmp = DATA_FILE + '.import.tmp';
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
  console.log(`\nWrote ${merged.length} entries to ${DATA_FILE}` + (existing.length ? ' (previous file saved as data.json.bak)' : ''));
}

main();
