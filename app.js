/* Predictions: game state, rendering and input. Needs engine.js loaded first. */
'use strict';

/* ---------- State ---------- */
const other = p => (p === 'R' ? 'B' : 'R');
const HISTORY_LIMIT = 500;
const STEAL = 's';   // in the move log; every other entry is a [square, piece] pair
let starter = 'R', S, history = [], sel = 12;

/* Two ways to play.
   'local': both players share this device and simply take turns.
   'link':  play by correspondence. Each copy of the link belongs to one player (its seat). You can only move
            when it's your seat's turn; then you send the link, and your own copy waits for the reply.
            Undo only takes back the move you haven't sent yet. */
let mode = 'local';
let seat = 'R';         // link mode: whose copy of the game this is
let base = 0;           // link mode: length of the move log as it arrived (or was last sent); later moves are yours, unsent
let sent = '';          // link mode: '' or how the position last went out: 'sent' / 'copied' / 'manual'
let pushCode = false;   // the next address change gets its own entry in the browser's history (a new game)
const pending = () => mode === 'link' && S.log.length > base;
const canMove = () => S.phase === 'play' && (mode === 'local' || S.turn === seat);
// The mode is chosen at the start: same-device play locks at the first move, link play once a link has gone out
// or come in. A new game unlocks it.
const modeLocked = () => (mode === 'local' ? S.log.length > 0 : base > 0 || !!sent);
const canUndo = () => (mode === 'local' ? history.length > 0 : pending());

function fresh() {
  return { board: Array(25).fill(null), first: starter, turn: starter, phase: 'play', moves: 0, last: -1,
           status: LINES.map(() => ({ decided: false })), log: [] };
}
const save = () => { history.push(JSON.stringify(S)); if (history.length > HISTORY_LIMIT) history.shift(); };
const finishIfDone = () => { if (S.status.every(s => s.decided)) S.phase = 'over'; };

function newGame() {
  if (mode === 'local') {
    if (S.moves > 0) save();   // keep the old game reachable with undo
  } else {
    history = [];              // in link mode the old game stays reachable with the browser's back button
    pushCode = true;
  }
  S = fresh(); seat = S.first; base = 0; sent = ''; sel = 12; render();
}
function applyPlay(i, v) {
  if (S.phase !== 'play' || !isLegal(S.board, i, v)) return false;
  save();
  S.board[i] = { v, o: S.turn };
  S.moves++; S.last = i;
  S.log.push([i, v]);
  S.status = S.status.map((s, li) => (s.decided ? s : analyzeLine(S.board, LINES[li].cells)));
  finishIfDone();
  if (S.phase !== 'over') S.turn = other(S.turn);
  return true;
}
const canSteal = () => S.phase === 'play' && S.moves === 1 && S.board[S.last]?.o === S.first;
function applySteal() {
  if (!canSteal()) return false;
  save();
  S.board[S.last] = { ...S.board[S.last], o: S.turn };
  S.turn = S.first;
  S.log.push(STEAL);
  S.status = analyzeAll(S.board);
  finishIfDone();
  return true;
}
function play(i, v) { if (applyPlay(i, v)) { sel = -1; render(); } }
function steal() { if (applySteal()) { sel = -1; render(); } }
function undo() {
  if (!canUndo()) return;
  const was = S.last;
  S = JSON.parse(history.pop());
  starter = S.first;
  sel = canMove() && was >= 0 && !S.board[was] ? was : -1;   // the square you took back stays picked
  render();
}
function scores() {
  const sc = { R: 0, B: 0 };
  for (const s of S.status) if (s.decided && s.winner) sc[s.winner]++;
  return sc;
}

/* ---------- The game in the address ----------
   The hash holds the whole game, packed small; reloading or opening the link replays it.
   Two characters of header: five flags plus 32 × the number of pieces down. Then the moves as one number:
   each move picks one of the empty squares left and one of six pieces, so the choices multiply into a single
   number, written in base 64. A full 25-move game is about 26 characters.
   In link play each copy belongs to one seat, and a copy marked sent is waiting for the reply. So on reload an
   unsent move can still be sent or taken back, and a sent one just waits. */
const ALPHA = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';
const BASE = ALPHA.length, BIG = BigInt(BASE);
const F_LINK = 1, F_BLUE_SEAT = 2, F_SENT = 4, F_BLUE_FIRST = 8, F_STEAL = 16;

function encode(who) {
  const link = mode === 'link';
  const plays = S.log.filter(t => t !== STEAL);
  const flags = (link ? F_LINK : 0) | (link && who === 'B' ? F_BLUE_SEAT : 0) | (link && sent && who === seat ? F_SENT : 0)
              | (S.first === 'B' ? F_BLUE_FIRST : 0) | (S.log.includes(STEAL) ? F_STEAL : 0);
  const header = flags + 32 * plays.length;
  const empty = range(25);
  let n = 0n, scale = 1n;
  for (const [i, v] of plays) {
    const k = empty.indexOf(i);
    n += BigInt(k * 6 + v - 1) * scale;
    scale *= BigInt(empty.length * 6);
    empty.splice(k, 1);
  }
  let tail = '';
  for (; n > 0n; n /= BIG) tail = ALPHA[Number(n % BIG)] + tail;
  return ALPHA[Math.floor(header / BASE)] + ALPHA[header % BASE] + tail;
}
function decode(code) {
  const digits = [...code].map(c => ALPHA.indexOf(c));
  if (digits.length < 2 || digits.includes(-1)) return null;
  const header = digits[0] * BASE + digits[1], flags = header % 32, count = Math.floor(header / 32);
  if (count > 25 || ((flags & F_STEAL) && !count)) return null;   // a steal needs a first move to take
  let n = 0n;
  for (const d of digits.slice(2)) n = n * BIG + BigInt(d);
  const empty = range(25), plays = [];
  for (let k = 0; k < count; k++) {
    const r = BigInt(empty.length * 6), d = Number(n % r);
    n /= r;
    plays.push([empty.splice(Math.floor(d / 6), 1)[0], d % 6 + 1]);
  }
  if (n !== 0n) return null;
  const link = !!(flags & F_LINK);
  return { link, seat: flags & F_BLUE_SEAT ? 'B' : 'R', sent: link && !!(flags & F_SENT),
           first: flags & F_BLUE_FIRST ? 'B' : 'R', steal: !!(flags & F_STEAL), plays };
}
const gameCode = () => encode(seat);

function writeCode() {
  const code = gameCode(), push = pushCode;
  pushCode = false;
  if (location.hash.slice(1) === code) return;
  window.history[push ? 'pushState' : 'replaceState'](null, '', '#' + code);
}
function loadCode(code) {
  const g = decode(code);
  if (!g) return false;
  const was = { S, history, starter };
  starter = g.first; S = fresh(); history = [];
  for (const [k, [i, v]] of g.plays.entries()) {
    if (!applyPlay(i, v) || (k === 0 && g.steal && !applySteal())) { ({ S, history, starter } = was); return false; }
  }
  mode = g.link ? 'link' : 'local';
  seat = g.link ? g.seat : S.turn;
  sent = g.sent ? 'sent' : '';
  base = S.log.length;
  // In link play only your own unsent move can be taken back. If this copy's last move is yours and it isn't
  // marked sent, it's still pending: keep the position before it for undo.
  if (mode === 'link') {
    const before = history.length ? JSON.parse(history[history.length - 1]) : null;
    const lastMover = S.phase === 'over' ? S.turn : other(S.turn);
    history = [];
    if (before && !sent && lastMover === seat) { history = [JSON.stringify(before)]; base = before.log.length; }
  }
  sel = S.phase === 'play' && S.moves === 0 ? 12 : -1;
  return true;
}
function setMode(m) {
  if (m === mode || modeLocked()) return;
  mode = m;
  // Switching to link play hands this device to the player to move: they move, then send.
  seat = S.turn; base = S.log.length; sent = '';
  if (mode === 'link') history = [];
  sel = canMove() && S.moves === 0 ? 12 : -1;
  render();
}

/* Sending: the phone's share sheet where there is one, otherwise the link goes on the clipboard. */
async function send() {
  if (mode !== 'link' || canMove()) return;
  const url = location.href.split('#')[0] + '#' + encode(other(seat));   // your opponent's copy
  const text = S.phase === 'over' ? 'Our game of Predictions is over.' : 'Your move in Predictions.';
  if (navigator.share) {
    try { await navigator.share({ title: 'Predictions', text, url }); return markSent('sent'); }
    catch (e) { if (e?.name === 'AbortError') return; }   // closed the share sheet: nothing was sent
  }
  try { await navigator.clipboard.writeText(url); markSent('copied'); } catch (_) { markSent('manual'); }
}
function markSent(how) { base = S.log.length; sent = how; sel = -1; render(); }
window.addEventListener('hashchange', () => {   // a newer link opened in this tab, or the back button
  const code = location.hash.slice(1);
  if (code === gameCode()) return;
  if (loadCode(code)) render(); else writeCode();   // not a game: put the current one back in the address
});

/* ---------- Render ---------- */
const $ = id => document.getElementById(id);
const NAME = { R: 'Red', B: 'Blue' };
const label = v => (v === X ? '×' : String(v));
const cx = (...p) => p.filter(Boolean).join(' ');

function render() {
  const focusKey = document.activeElement?.dataset?.key;
  const sc = scores();

  $('ptsR').textContent = sc.R;
  $('ptsB').textContent = sc.B;
  const drawn = S.status.filter(s => s.decided && !s.winner).length;
  const open = 10 - sc.R - sc.B - drawn;
  const segs = [...Array(sc.R).fill('R'), ...Array(Math.floor(open / 2)).fill(''), ...Array(drawn).fill('N'),
                ...Array(Math.ceil(open / 2)).fill(''), ...Array(sc.B).fill('B')];
  $('bar').innerHTML = segs.map(c => `<span class="${c}"></span>`).join('');
  $('score').setAttribute('aria-label', `Score: Red ${sc.R}, Blue ${sc.B}`);
  if (S.phase === 'over') {
    const [cls, text] = sc.R > sc.B ? ['R', `Red wins, ${sc.R}–${sc.B}`]
                      : sc.B > sc.R ? ['B', `Blue wins, ${sc.B}–${sc.R}`]
                      : ['', `A draw, ${sc.R}–${sc.B}`];
    $('turn').className = cx('turn', 'final', cls);
    $('turn').textContent = text;
  } else {
    $('turn').className = cx('turn', S.turn);
    $('turn').innerHTML = `<span class="dot"></span>${NAME[S.turn]} to move`;
  }

  let html = '<div class="corner"></div>';
  for (let c = 0; c < 5; c++) html += ind(5 + c);
  for (let r = 0; r < 5; r++) {
    html += ind(r);
    for (let c = 0; c < 5; c++) html += cell(r * 5 + c);
  }
  $('board').innerHTML = html;
  $('panel').innerHTML = panel();
  const locked = modeLocked();
  for (const b of document.querySelectorAll('[data-mode]')) {
    const on = b.dataset.mode === mode;
    b.setAttribute('aria-pressed', String(on));
    b.hidden = locked && !on;   // once locked, only the mode in play is shown
    b.disabled = locked;
  }
  writeCode();

  // On the board, keyboard focus follows the selection; with nothing selected it lets go,
  // so no stray ring is left on a square that was just played.
  let key = focusKey;
  if (key?.[0] === 'c') key = sel >= 0 ? `c${sel}` : null;
  const target = key && document.querySelector(`[data-key="${key}"]:not(:disabled)`);
  if (target) target.focus();
  else if (focusKey?.[0] === 'c') document.activeElement?.blur();
}

function ind(li) {
  const s = S.status[li];
  return `<div class="${cx('ind', LINES[li].kind, s.decided && (s.winner ?? 'N'))}" aria-hidden="true"></div>`;
}

function cell(i) {
  const p = S.board[i];
  const name = `${'abcde'[i % 5]}${Math.floor(i / 5) + 1}`;
  const playing = canMove();
  if (p) {
    const cls = cx('sq', p.o, p.v === X && 'x', i === S.last && 'last', playing && i === sel && 'sel');
    return `<button class="${cls}" data-key="c${i}" data-i="${i}" aria-label="${name}, ${NAME[p.o]} ${label(p.v)}">${label(p.v)}</button>`;
  }
  const cls = cx('sq', playing && 'can', playing && i === sel && 'sel');
  return `<button class="${cls}" data-key="c${i}" data-i="${i}" aria-label="${name}, empty"${playing ? '' : ' disabled'}></button>`;
}

const UNDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
const undoBtn = () => `<button class="k undo" data-action="undo" data-key="undo" aria-label="Undo" title="${mode === 'link' ? 'Take back your unsent move (U)' : 'Undo (U)'}"${canUndo() ? '' : ' disabled'}>${UNDO}</button>`;
const SENT_LABEL = { sent: 'Sent · send again', copied: 'Link copied · copy again', manual: 'Copying failed · try again' };

function panel() {
  // Link play: after your move the board waits until you send it; after sending, until the reply comes.
  if (pending()) {
    return `<div class="pal"><button class="k word armed wide" data-action="send" data-key="send" title="Send this position to your opponent (Enter)">Send move</button>${undoBtn()}</div>`;
  }
  if (mode === 'link' && S.phase === 'play' && S.turn !== seat) {   // waiting for the reply
    const text = sent ? SENT_LABEL[sent] : `Send to ${NAME[other(seat)]}`;
    return `<div class="pal"><button class="k word wide" data-action="send" data-key="send" title="Send ${NAME[other(seat)]} their copy of the game">${text}</button>${undoBtn()}</div>`;
  }
  if (S.phase === 'over') {
    return `<div class="pal"><button class="k word armed" data-action="again" data-key="again">Play again</button>${undoBtn()}</div>`;
  }
  const armed = sel >= 0 && !S.board[sel];
  const keys = VALUES.map(v => {
    const ok = armed && isLegal(S.board, sel, v);
    return `<button class="${cx('k', armed && 'armed')}" data-action="play" data-v="${v}" data-key="v${v}" aria-label="Place ${label(v)}"${ok ? '' : ' disabled'}>${label(v)}</button>`;
  }).join('');
  const stealRow = canSteal() && canMove()
    ? `<div class="pal sub"><button class="k word" data-action="steal" data-key="steal" title="Take ${NAME[S.first]}'s opening move as your own (S)">Steal opening move</button></div>`
    : '';
  return `<div class="pal">${keys}${undoBtn()}</div>${stealRow}`;
}

/* ---------- Input ---------- */
$('board').addEventListener('click', e => {
  const b = e.target.closest('.sq.can');
  if (!b) return;
  const i = +b.dataset.i;
  sel = sel === i ? -1 : i;
  render();
});
$('panel').addEventListener('click', e => {
  const b = e.target.closest('button[data-action]');
  if (!b || b.disabled) return;
  switch (b.dataset.action) {
    case 'play': play(sel, +b.dataset.v); break;
    case 'steal': steal(); break;
    case 'again': starter = other(S.first); newGame(); break;
    case 'undo': undo(); break;
    case 'send': send(); break;
  }
});
$('new').addEventListener('click', newGame);
for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => setMode(b.dataset.mode));

const KEYS = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, x: X, X: X };
const ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
const clamp = n => Math.min(4, Math.max(0, n));
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (k === 'z' || k === 'u' || k === 'U') return undo();
  if (k === 'Enter' && pending() && !e.target.closest?.('button')) return send();
  if (!canMove()) return;
  if (k === 's' || k === 'S') return steal();
  if (k === 'Escape') { sel = -1; return render(); }
  if (k in KEYS) return play(sel, KEYS[k]);
  const d = ARROWS[k];
  if (!d) return;
  e.preventDefault();
  sel = sel < 0 ? (S.last >= 0 ? S.last : 12)
                : clamp(Math.floor(sel / 5) + d[0]) * 5 + clamp((sel % 5) + d[1]);
  render();
});

if (!loadCode(location.hash.slice(1))) S = fresh();
render();
