# Kto wygrał dzień?

Daily "who won the day" tracker for the team. Click a player to announce them
as today's winner (confetti, fanfare, the works), or let the slot-machine spin
pick one for you. Add an optional comment on why they won — it's shown on the
winner card and history, and read aloud via the browser's speech synthesis.
Leaderboard, podium, streaks and badges update instantly.

## Running it

Requires Node.js 18+, no dependencies to install.

```
node server.js
```

Then open http://localhost:3000. Change the port with `PORT=8080 node server.js`.

To keep it running persistently (e.g. on a home server or VPS), use your
process manager of choice, for example:

```
pm2 start server.js --name daily-winner
```

or a systemd unit that runs `node server.js` with `Restart=always`.

## How data is stored

All entries live in `data.json` at the repo root, written atomically
(write-to-temp-file + rename) on every announce/undo/reset. It's gitignored —
it's runtime data, not source. On first run, if `data.json` doesn't exist yet,
the server seeds it with some demo history so the board isn't empty.

Because storage is a local file, the server needs to run on a host with a
persistent filesystem (your own machine, a home server, a VPS, or a PaaS
with a persistent volume attached). Static/serverless hosts (GitHub Pages,
Vercel, Netlify) won't work — their filesystems don't persist writes.

## Project layout

- `server.js` — zero-dependency Node HTTP server: serves `public/` and exposes
  `/api/entries` (GET/POST), `/api/entries/undo`, `/api/entries/reset`.
- `public/` — the frontend (plain HTML/CSS/JS, no build step).
- `Tracker Dnia.dc.html` — the original design export this app was built from
  (kept for reference; not used at runtime).
