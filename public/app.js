'use strict';

const MEMBERS = [
  { id: 0, name: 'Łukasz Kaniecki', nick: 'Kanonier' },
  { id: 1, name: 'Marcin Piotrowski', nick: 'Turbo Marcin' },
  { id: 2, name: 'Natalia Pietnoczko', nick: 'Nataliada' },
  { id: 3, name: 'Paweł Gawędzki', nick: 'Sędzia-Zawodnik' },
  { id: 4, name: 'Piotr Pawłowski', nick: 'Piotr Piorun' },
  { id: 5, name: 'Radosław Sęk', nick: 'Sęk w tym' },
  { id: 6, name: 'Sławomir Kwiatkowski', nick: 'Kwiat Mistrzostw' },
  { id: 7, name: 'Zuzanna Adamiec', nick: 'Zuza Zamiata' },
  { id: 8, name: 'Dominik Oczoś', nick: 'Oko Cyklonu' },
  { id: 9, name: 'Filip Liwiński', nick: 'Filip Flesz' },
  { id: 10, name: 'Grzegorz Izdebski', nick: 'Grzesiek Grand' },
  { id: 11, name: 'Jakub Gaj', nick: 'Gaj Fajny' },
];
const WD_GEN = ['niedziel', 'poniedziałków', 'wtorków', 'śród', 'czwartków', 'piątków', 'sobót'];
const SHOW_NICKS = true;
const HISTORY_LENGTH = 14;

const PIN_STORAGE_KEY = 'dwt-pin';

// `today` comes from the server, which is the only judge of what day it is.
const state = { entries: [], today: '', pinRequired: false, announceComment: '', busy: false, spinning: false };

// --- date / text helpers ------------------------------------------------

function isoOf(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function todayISO() { return state.today || isoOf(new Date()); }
function parseISO(s) { return new Date(s + 'T00:00:00'); }
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function initials(name) { return name.split(' ').filter(Boolean).map((w) => w[0].toUpperCase()).join('').slice(0, 2); }
function fmt(iso, withWeekday) {
  const opts = withWeekday ? { weekday: 'long', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long' };
  return new Intl.DateTimeFormat('pl-PL', opts).format(parseISO(iso));
}
function memberById(id) { return MEMBERS.find((m) => m.id === id); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- API ------------------------------------------------------------------

async function apiGetState() {
  const res = await fetch('/api/entries', { cache: 'no-store' });
  if (!res.ok) throw new Error('load failed');
  return res.json();
}
// Returns { status, data } so callers can react to 401/409/429 individually.
async function apiAnnounce(winnerId, comment, pin) {
  const res = await fetch('/api/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Pin': pin },
    body: JSON.stringify({ winnerId, comment }),
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}

function applyServerState(data) {
  if (!data || !Array.isArray(data.entries)) return;
  state.entries = data.entries;
  state.today = data.today;
  state.pinRequired = !!data.pinRequired;
}

async function refreshState() {
  try {
    applyServerState(await apiGetState());
    render();
  } catch (err) {
    console.error(err);
  }
}

// --- derived stats (leaderboard, podium, badges, streaks) ------------------

function computeDerived() {
  const entries = [...state.entries].sort((a, b) => (a.date < b.date ? -1 : 1));
  const total = entries.length;

  const wins = {}, longest = {}, current = {}, monthWins = {}, wdCount = {};
  MEMBERS.forEach((m) => { wins[m.id] = 0; longest[m.id] = 0; current[m.id] = 0; });
  const monthPrefix = todayISO().slice(0, 7);

  let run = 0, prev = null;
  entries.forEach((e) => {
    if (wins[e.winnerId] != null) wins[e.winnerId]++;
    if (e.winnerId === prev) run++; else { run = 1; prev = e.winnerId; }
    if (run > (longest[e.winnerId] || 0)) longest[e.winnerId] = run;
    if (e.date.slice(0, 7) === monthPrefix) monthWins[e.winnerId] = (monthWins[e.winnerId] || 0) + 1;
    const day = parseISO(e.date).getDay();
    const k = e.winnerId + '-' + day;
    wdCount[k] = (wdCount[k] || 0) + 1;
  });
  if (total) {
    const lastId = entries[total - 1].winnerId;
    let c = 0;
    for (let i = total - 1; i >= 0; i--) { if (entries[i].winnerId === lastId) c++; else break; }
    current[lastId] = c;
  }

  const nickOf = (m) => (SHOW_NICKS ? '„' + m.nick + '”' : '');

  const lb = MEMBERS.map((m) => ({ m, wins: wins[m.id], longest: longest[m.id], cur: current[m.id] }))
    .sort((a, b) => b.wins - a.wins || b.longest - a.longest || a.m.name.localeCompare(b.m.name, 'pl'));
  const medals = ['🥇', '🥈', '🥉'];
  const leaderboard = lb.map((r, i) => ({
    rankBadge: i < 3 ? medals[i] : String(i + 1),
    initials: initials(r.m.name),
    name: r.m.name,
    nick: nickOf(r.m),
    wins: r.wins,
    winRateLabel: total ? Math.round((r.wins / total) * 100) + '%' : '0%',
    streakLabel: r.cur > 0 ? r.cur + ' 🔥' : '—',
    longest: r.longest,
  }));

  const P = (idx) => {
    const r = lb[idx];
    if (!r) return {};
    return { name: r.m.name, initials: initials(r.m.name), wins: r.wins, rate: total ? Math.round((r.wins / total) * 100) : 0 };
  };
  const p1 = P(0), p2 = P(1), p3 = P(2);

  const todayIso = todayISO();
  const te = entries.find((e) => e.date === todayIso);
  const tm = te ? memberById(te.winnerId) : null;

  const leader = lb[0] && lb[0].wins > 0 ? lb[0] : null;
  let recCount = 0, recHolder = null;
  MEMBERS.forEach((m) => { if (longest[m.id] > recCount) { recCount = longest[m.id]; recHolder = m; } });
  let hotName = '—', hotCount = 0;
  if (total) { const lastId = entries[total - 1].winnerId; hotCount = current[lastId]; hotName = memberById(lastId).name; }

  const badges = [];
  if (leader) badges.push({ emoji: '👑', title: 'Wielki Mistrz', holder: leader.m.name, desc: leader.wins + ' zwycięskich dni' });
  else badges.push({ emoji: '👑', title: 'Wielki Mistrz', holder: 'Wakat', desc: 'Tron czeka na pierwszego zwycięzcę' });

  if (hotCount >= 2) badges.push({ emoji: '🔥', title: 'Gorąca Passa', holder: hotName, desc: hotCount + ' dni z rzędu — nie do zatrzymania' });
  else badges.push({ emoji: '🧊', title: 'Gorąca Passa', holder: 'Nikt (na razie)', desc: 'Passa czeka na bohatera' });

  if (recHolder) badges.push({ emoji: '🐐', title: 'Rekord Wszech Czasów', holder: recHolder.name, desc: 'Najdłuższa passa: ' + recCount + ' dni' });
  else badges.push({ emoji: '🐐', title: 'Rekord Wszech Czasów', holder: '—', desc: 'Brak danych' });

  let wdBest = 0, wdKey = null;
  Object.keys(wdCount).forEach((k) => { if (wdCount[k] > wdBest) { wdBest = wdCount[k]; wdKey = k; } });
  if (wdKey) {
    const [wid, day] = wdKey.split('-').map(Number);
    badges.push({ emoji: '📅', title: 'Postrach ' + WD_GEN[day], holder: memberById(wid).name, desc: 'Wygrał w ten dzień ' + wdBest + ' razy' });
  } else badges.push({ emoji: '📅', title: 'Postrach Tygodnia', holder: '—', desc: 'Brak danych' });

  let mBest = 0, mId = null;
  Object.keys(monthWins).forEach((k) => { if (monthWins[k] > mBest) { mBest = monthWins[k]; mId = Number(k); } });
  if (mId != null) badges.push({ emoji: '🍀', title: 'Szczęściarz Miesiąca', holder: memberById(mId).name, desc: mBest + ' wygranych w tym miesiącu' });
  else badges.push({ emoji: '🍀', title: 'Szczęściarz Miesiąca', holder: '—', desc: 'Miesiąc dopiero się rozkręca' });

  const minW = Math.min(...MEMBERS.map((m) => wins[m.id]));
  const maxW = Math.max(...MEMBERS.map((m) => wins[m.id]));
  const cursed = MEMBERS.find((m) => wins[m.id] === minW);
  if (maxW > minW) badges.push({ emoji: '🥶', title: 'Klątwa Ostatniego', holder: cursed.name, desc: minW === 0 ? 'Wciąż 0 wygranych — legenda głosi, że kiedyś...' : 'Ledwie ' + minW + ' — trzymamy kciuki' });
  else badges.push({ emoji: '🤝', title: 'Idealny Remis', holder: 'Cały zespół', desc: 'Wszyscy po równo — Paweł ma zagwozdkę' });

  const history = [...entries].reverse().slice(0, HISTORY_LENGTH).map((e) => {
    const m = memberById(e.winnerId);
    return {
      initials: initials(m.name),
      name: m.name,
      nick: m.nick,
      comment: e.comment || '',
      dateLabel: cap(fmt(e.date, false)),
      weekday: fmt(e.date, true).split(',')[0] || parseISO(e.date).toLocaleDateString('pl-PL', { weekday: 'long' }),
    };
  });

  const chips = MEMBERS.map((m) => ({
    id: m.id,
    initials: initials(m.name),
    name: m.name,
    nick: SHOW_NICKS ? m.nick : '',
    crown: tm && tm.id === m.id ? '👑' : '',
  }));

  return {
    heroDateLabel: cap(fmt(todayIso, true)),
    todayWinnerExists: !!tm,
    todayName: tm ? tm.name : '',
    todayNick: tm ? '„' + tm.nick + '”' : '',
    todayInitials: tm ? initials(tm.name) : '',
    todayComment: te && te.comment ? te.comment : '',
    chips,
    totalDays: total,
    leaderName: leader ? leader.m.name : 'Brak',
    leaderWins: leader ? leader.wins : 0,
    recordCount: recCount,
    recordHolder: recHolder ? recHolder.name : '—',
    hotCount, hotName,
    p1Name: p1.name || '—', p1Initials: p1.initials || '', p1Wins: p1.wins || 0, p1Rate: p1.rate || 0,
    p2Name: p2.name || '—', p2Initials: p2.initials || '', p2Wins: p2.wins || 0,
    p3Name: p3.name || '—', p3Initials: p3.initials || '', p3Wins: p3.wins || 0,
    leaderboard, badges, history,
  };
}

// --- rendering --------------------------------------------------------------

function render() {
  const d = computeDerived();

  document.getElementById('heroDateLabel').textContent = d.heroDateLabel;
  document.getElementById('heroWinner').hidden = !d.todayWinnerExists;
  document.getElementById('heroPending').hidden = d.todayWinnerExists;
  document.getElementById('announceForm').hidden = d.todayWinnerExists;
  document.getElementById('announceLocked').hidden = !d.todayWinnerExists;
  document.getElementById('pinLabel').hidden = !state.pinRequired;
  if (d.todayWinnerExists) {
    document.getElementById('todayInitials').textContent = d.todayInitials;
    document.getElementById('todayName').textContent = d.todayName;
    document.getElementById('todayNick').textContent = d.todayNick;
    const commentEl = document.getElementById('todayComment');
    commentEl.textContent = d.todayComment ? '„' + d.todayComment + '”' : '';
    commentEl.hidden = !d.todayComment;
  }

  document.getElementById('totalDays').textContent = d.totalDays;
  document.getElementById('leaderName').textContent = d.leaderName;
  document.getElementById('leaderWins').textContent = d.leaderWins;
  document.getElementById('recordCount').textContent = d.recordCount;
  document.getElementById('recordHolder').textContent = d.recordHolder;
  document.getElementById('hotCount').textContent = d.hotCount;
  document.getElementById('hotName').textContent = d.hotName;

  document.getElementById('p1Name').textContent = d.p1Name;
  document.getElementById('p1Initials').textContent = d.p1Initials;
  document.getElementById('p1Wins').textContent = d.p1Wins;
  document.getElementById('p1Rate').textContent = d.p1Rate;
  document.getElementById('p2Name').textContent = d.p2Name;
  document.getElementById('p2Initials').textContent = d.p2Initials;
  document.getElementById('p2Wins').textContent = d.p2Wins;
  document.getElementById('p3Name').textContent = d.p3Name;
  document.getElementById('p3Initials').textContent = d.p3Initials;
  document.getElementById('p3Wins').textContent = d.p3Wins;

  renderChips(d.chips);
  renderLeaderboard(d.leaderboard);
  renderBadges(d.badges);
  renderHistory(d.history);
}

function renderChips(chips) {
  const grid = document.getElementById('chipGrid');
  grid.innerHTML = chips.map((c) => `
    <button class="chip" data-id="${c.id}">
      <span class="avatar-chip">${escapeHtml(c.initials)}</span>
      <span class="chip-info">
        <span class="chip-name">${escapeHtml(c.name)} ${c.crown}</span>
        <span class="chip-nick">${escapeHtml(c.nick)}</span>
      </span>
    </button>
  `).join('');
  grid.querySelectorAll('.chip').forEach((btn) => {
    btn.addEventListener('click', () => announce(Number(btn.dataset.id)));
  });
}

function renderLeaderboard(rows) {
  document.getElementById('leaderboardBody').innerHTML = rows.map((r) => `
    <div class="leaderboard-row">
      <div class="rank">${r.rankBadge}</div>
      <div class="player">
        <span class="avatar-row">${escapeHtml(r.initials)}</span>
        <span class="player-info">
          <span class="player-name">${escapeHtml(r.name)}</span>
          <span class="player-nick">${escapeHtml(r.nick)}</span>
        </span>
      </div>
      <div class="wins-cell">${r.wins}</div>
      <div class="rate-cell">${r.winRateLabel}</div>
      <div class="streak-cell">${r.streakLabel}</div>
      <div class="longest-cell">${r.longest}</div>
    </div>
  `).join('');
}

function renderBadges(badges) {
  document.getElementById('badgesGrid').innerHTML = badges.map((b) => `
    <div class="badge-card">
      <div class="badge-emoji">${b.emoji}</div>
      <div class="badge-title">${escapeHtml(b.title)}</div>
      <div class="badge-holder">${escapeHtml(b.holder)}</div>
      <div class="badge-desc">${escapeHtml(b.desc)}</div>
    </div>
  `).join('');
}

function renderHistory(history) {
  document.getElementById('historyList').innerHTML = history.map((h) => `
    <div class="history-row">
      <span class="avatar-history">${escapeHtml(h.initials)}</span>
      <div class="history-info">
        <span class="history-name">${escapeHtml(h.name)}</span>
        <span class="history-nick"> — ${escapeHtml(h.nick)}</span>
        ${h.comment ? `<div class="history-comment">„${escapeHtml(h.comment)}”</div>` : ''}
      </div>
      <div class="history-date">
        <div class="history-date-day">${escapeHtml(h.dateLabel)}</div>
        <div class="history-date-weekday">${escapeHtml(h.weekday)}</div>
      </div>
    </div>
  `).join('');
}

// --- effects: confetti / audio / speech / fanfare banner --------------------

let audioCtx = null;
function getAudioCtx() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = audioCtx || new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  } catch (e) { return null; }
}

function blip(freq) {
  const ac = getAudioCtx(); if (!ac) return;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'square'; o.frequency.value = freq;
  const t = ac.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.06, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  o.connect(g); g.connect(ac.destination);
  o.start(t); o.stop(t + 0.07);
}

function playFanfareSound() {
  const ac = getAudioCtx(); if (!ac) return;
  const now = ac.currentTime;
  const melody = [523.25, 659.25, 783.99, 1046.5];
  melody.forEach((f, i) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    const t = now + i * 0.12;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.24, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(g); g.connect(ac.destination);
    o.start(t); o.stop(t + 0.55);
  });
  [523.25, 659.25, 783.99, 1046.5].forEach((f) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sawtooth'; o.frequency.value = f;
    const t = now + 0.52;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    o.connect(g); g.connect(ac.destination);
    o.start(t); o.stop(t + 1.35);
  });
}

function speak(name, comment) {
  try {
    if (!('speechSynthesis' in window) || !name) return;
    let text = 'Zwycięzcą dnia zostaje... ' + name + '!';
    if (comment) text += ' ' + comment;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'pl-PL'; u.rate = 0.95; u.pitch = 1.15;
    speechSynthesis.cancel();
    setTimeout(() => speechSynthesis.speak(u), 650);
  } catch (e) {}
}

function fireConfetti() {
  const layer = document.getElementById('confettiLayer'); if (!layer) return;
  const em = ['🏆', '🥇', '✨', '🎉', '👑', '⭐', '🎊', '🏆', '💥'];
  for (let i = 0; i < 96; i++) {
    const s = document.createElement('span');
    s.textContent = em[i % em.length];
    s.style.cssText = 'position:absolute;top:-40px;left:' + (Math.random() * 100) + '%;font-size:' + (16 + Math.random() * 26) + 'px;animation:confetti-fall ' + (1.7 + Math.random() * 1.5) + 's cubic-bezier(.35,.1,.4,1) ' + (Math.random() * 0.35) + 's forwards';
    layer.appendChild(s);
    setTimeout(() => s.remove(), 3800);
  }
}

function replayAnimation(el, animation) {
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = animation;
}

function playHype() {
  replayAnimation(document.getElementById('root'), 'hype-shake .6s ease');
  replayAnimation(document.getElementById('flashLayer'), 'gold-flash .75s ease');
  playFanfareSound();
}

let fanfareTimer = null;
function showFanfareBanner(name) {
  const banner = document.getElementById('fanfareBanner');
  document.getElementById('fanfareName').textContent = name.toUpperCase();
  banner.hidden = false;
  replayAnimation(banner, 'fanfare-in .9s cubic-bezier(.2,.9,.3,1.4) both');
  clearTimeout(fanfareTimer);
  fanfareTimer = setTimeout(() => { banner.hidden = true; }, 4000);
}

// --- actions ------------------------------------------------------------

function currentPin() {
  return document.getElementById('announcePin').value;
}

function setBusy(busy) {
  state.busy = busy;
  document.querySelectorAll('#chipGrid .chip, #spinBtn').forEach((b) => { b.disabled = busy; });
}

async function announce(id) {
  if (state.busy) return;
  const m = memberById(id);
  if (!confirm('Zatwierdzić werdykt: ' + (m ? m.name : '?') + '? Dzisiejszego wyniku nie da się potem zmienić.')) return;
  const comment = state.announceComment.trim();
  setBusy(true);
  let result;
  try {
    result = await apiAnnounce(id, comment, currentPin());
  } catch (e) {
    alert('Brak połączenia z serwerem. Werdykt NIE został zapisany — spróbuj ponownie.');
    return;
  } finally {
    setBusy(false);
  }

  if (result.status === 409) {
    applyServerState(result.data);
    render();
    alert('Dzisiejszy werdykt już zapadł — ktoś był szybszy.');
    return;
  }
  if (result.status === 401) { alert('Zły PIN sędziego.'); return; }
  if (result.status === 429) { alert('Za dużo błędnych prób PIN-u. Spróbuj za 15 minut.'); return; }
  if (result.status !== 200) { alert('Nie udało się zapisać werdyktu. Spróbuj ponownie.'); return; }

  try { localStorage.setItem(PIN_STORAGE_KEY, currentPin()); } catch (e) {}
  applyServerState(result.data);
  state.announceComment = '';
  document.getElementById('announceComment').value = '';
  render();
  fireConfetti();
  playHype();
  speak(m ? m.name : '', comment);
  showFanfareBanner(m ? m.name : '');
}

function spin() {
  if (state.spinning || state.busy) return;
  if (state.pinRequired && !currentPin()) {
    alert('Najpierw wpisz PIN sędziego.');
    return;
  }
  getAudioCtx();
  const overlay = document.getElementById('spinOverlay');
  const nameEl = document.getElementById('spinName');
  const ids = MEMBERS.map((m) => m.id);
  const totalTicks = 26 + Math.floor(Math.random() * 8);
  let ticks = 0;
  state.spinning = true;
  overlay.hidden = false;
  const tick = () => {
    const m = memberById(ids[Math.floor(Math.random() * ids.length)]);
    nameEl.textContent = m.name;
    replayAnimation(nameEl, 'slot-pop .12s ease');
    blip(180 + Math.random() * 220);
    ticks++;
    if (ticks < totalTicks) {
      setTimeout(tick, 55 + ticks * ticks * 0.9);
    } else {
      const win = memberById(ids[Math.floor(Math.random() * ids.length)]);
      state.spinning = false;
      overlay.hidden = true;
      announce(win.id);
    }
  };
  tick();
}

// --- init -----------------------------------------------------------------

function init() {
  const commentInput = document.getElementById('announceComment');
  commentInput.addEventListener('input', (e) => { state.announceComment = e.target.value; });

  try { document.getElementById('announcePin').value = localStorage.getItem(PIN_STORAGE_KEY) || ''; } catch (e) {}

  document.getElementById('spinBtn').addEventListener('click', spin);

  apiGetState()
    .then((data) => { applyServerState(data); render(); })
    .catch((err) => { console.error(err); alert('Nie udało się wczytać danych z serwera.'); });

  // Keep a tab left open overnight (or open on two devices) in sync with the server.
  setInterval(() => { if (!state.busy && !state.spinning) refreshState(); }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !state.busy && !state.spinning) refreshState();
  });
}

document.addEventListener('DOMContentLoaded', init);
