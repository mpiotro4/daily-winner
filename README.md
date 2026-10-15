# Kto wygrał dzień?

Daily "who won the day" tracker for the team. Pick today's winner (confetti,
fanfare, the works), or let the slot-machine spin pick one for you. Add an
optional comment on why they won — it's shown on the winner card and history,
and read aloud via the browser's speech synthesis.

## Rules (enforced by the server, not the browser)

- **One verdict per day.** The date is always the server's "today"; once it's
  saved, the day is locked and the form disappears until tomorrow.
- **The past can't be changed.** There is no edit, undo, delete or reset over
  HTTP — not in the UI, not in the API.
- **Optional judge PIN.** Start the server with `ADMIN_PIN` set and only people
  who know it can announce. 5 wrong attempts lock that IP out for 15 minutes.

Made a mistake? Stop the server, edit `data.json` by hand, start it again.

## Running it

Requires Node.js 18+, no dependencies to install.

```
ADMIN_PIN='something-long' TZ=Europe/Warsaw node server.js
```

Then open http://localhost:3000. Change the port with `PORT=8080`.
`TZ` decides when "today" rolls over, so set it to your team's timezone.

To keep it running persistently (e.g. on a home server or VPS), use your
process manager of choice, for example:

```
ADMIN_PIN='something-long' TZ=Europe/Warsaw pm2 start server.js --name daily-winner
```

or a systemd unit that runs `node server.js` with `Restart=always` and those
environment variables.

## How data is stored

All entries live in `data.json` at the repo root, written atomically
(write-to-temp-file + rename) on every new verdict. It's gitignored — it's
runtime data, not source. If the file is missing the server starts with an
empty one; if it's corrupt the server refuses to start rather than overwrite it.

Because storage is a local file, the server needs to run on a host with a
persistent filesystem (your own machine, a home server, a VPS, or a PaaS
with a persistent volume attached). Static/serverless hosts (GitHub Pages,
Vercel, Netlify) won't work — their filesystems don't persist writes.

## Importing the old spreadsheet

```
# stop the server first — it would overwrite the file on its next save
node scripts/import-csv.js zwyciezca_dnia.csv           # dry run
node scripts/import-csv.js zwyciezca_dnia.csv --write   # apply
```

Rows without a winner are skipped, "Werdykt Pawła" becomes the comment, dates
already in `data.json` are never overwritten, and nothing dated today or later
is imported. Safe to re-run; the previous file is kept as `data.json.bak`.

## Project layout

- `server.js` — zero-dependency Node HTTP server: serves `public/` and exposes
  `GET /api/entries` and `POST /api/entries` (today's verdict only).
- `public/` — the frontend (plain HTML/CSS/JS, no build step).
- `scripts/import-csv.js` — one-off import of the old spreadsheet export.
- `Tracker Dnia.dc.html` — the original design export this app was built from
  (kept for reference; not used at runtime).
