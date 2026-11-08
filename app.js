/* Predictions: game state, rendering and input. Needs engine.js loaded first. */
'use strict';

/* ---------- State ---------- */
const other = p => (p === 'R' ? 'B' : 'R');
const HISTORY_LIMIT = 500;
let starter = 'R', S, history = [], sel = 12;

function fresh() {
  return { board: Array(25).fill(null), first: starter, turn: starter, phase: 'play', moves: 0, last: -1,
           status: LINES.map(() => ({ decided: false })), log: '' };
}
const save = () => { history.push(JSON.stringify(S)); if (history.length > HISTORY_LIMIT) history.shift(); };
const finishIfDone = () => { if (S.status.every(s => s.decided)) S.phase = 'over'; };

function newGame() {
  if (S && S.moves > 0) save();   // keep the old game reachable with undo
  S = fresh(); sel = 12; render();
}
function applyPlay(i, v) {
  if (S.phase !== 'play' || !isLegal(S.board, i, v)) return false;
  save();
  S.board[i] = { v, o: S.turn };
  S.moves++; S.last = i;
  S.log += CELLS[i] + (v === X ? 'x' : v);
  S.status = S.status.map((s, li) => (s.decided ? s : analyzeLine(S.board, LINES[li].cells)));
  finishIfDone();
  if (S.phase !== 'over') S.turn = other(S.turn);
  return true;
}
function play(i, v) {
  if (!applyPlay(i, v)) return;
  sel = -1;
  render();
}
const canSteal = () => S.phase === 'play' && S.moves === 1 && S.last >= 0 && S.board[S.last]?.o === S.first;
function applySteal() {
  if (!canSteal()) return false;
  save();
  S.board[S.last] = { ...S.board[S.last], o: S.turn };
  S.turn = S.first;
  S.log += '_';
  S.status = analyzeAll(S.board);
  finishIfDone();
  return true;
}
function steal() {
  if (!applySteal()) return;
  sel = -1;
  render();
}
function undo() {
  if (!history.length) return;
  S = JSON.parse(history.pop());
  starter = S.first;
  sel = -1;
  render();
}
function scores() {
  const sc = { R: 0, B: 0 };
  for (const s of S.status) if (s.decided && s.winner) sc[s.winner]++;
  return sc;
}

/* ---------- The game in the URL ----------
   The address ends in a code like #Rm3gx_a5: who moved first (R or B), then each move in order,
   as a square (a–y, reading left to right, top to bottom) and a piece (1–5 or x). An _ is a steal.
   Reloading or opening the link replays those moves, so undo still works afterwards. */
const CELLS = 'abcdefghijklmnopqrstuvwxy';
const gameCode = () => S.first + S.log;

function writeCode() {
  const code = gameCode();
  if (location.hash.slice(1) === code) return;
  try { window.history.replaceState(null, '', '#' + code); } catch (_) { location.hash = code; }
}
function loadCode(code) {
  const m = /^([RB])((?:[a-y][1-5x]|_)*)$/.exec(code);
  if (!m) return false;
  const was = { S, history, starter };
  starter = m[1]; S = fresh(); history = [];
  for (const t of m[2].match(/[a-y][1-5x]|_/g) || []) {
    const ok = t === '_' ? applySteal()
                         : applyPlay(CELLS.indexOf(t[0]), t[1] === 'x' ? X : +t[1]);
    if (!ok) { ({ S, history, starter } = was); return false; }
  }
  starter = S.first;
  sel = S.phase === 'play' && S.moves === 0 ? 12 : -1;
  return true;
}
window.addEventListener('hashchange', () => {
  const code = location.hash.slice(1);
  if (code && code !== gameCode() && loadCode(code)) render();
});

/* ---------- Render ---------- */
const $ = id => document.getElementById(id);
const NAME = { R: 'Red', B: 'Blue' };
const label = v => (v === X ? '×' : String(v));
const cx = (...p) => p.filter(Boolean).join(' ');
const COLS = 'abcde';

function render() {
  const focusKey = document.activeElement?.dataset?.key;
  const sc = scores();
  const active = S.phase === 'play' ? S.turn : null;

  $('ptsR').textContent = sc.R;
  $('ptsB').textContent = sc.B;
  const drawn = S.status.filter(s => s.decided && !s.winner).length;
  const open = 10 - sc.R - sc.B - drawn;
  const segs = [...Array(sc.R).fill('R'), ...Array(Math.floor(open / 2)).fill(''), ...Array(drawn).fill('N'),
                ...Array(Math.ceil(open / 2)).fill(''), ...Array(sc.B).fill('B')];
  $('bar').innerHTML = segs.map(c => `<span class="${c}"></span>`).join('');
  $('score').setAttribute('aria-label', `Score: Red ${sc.R}, Blue ${sc.B}`);
  $('turn').className = cx('turn', active);
  $('turn').innerHTML = active ? `<span class="dot"></span>${NAME[active]} to move` : '';

  let html = '<div class="corner"></div>';
  for (let c = 0; c < 5; c++) html += ind(5 + c);
  for (let r = 0; r < 5; r++) {
    html += ind(r);
    for (let c = 0; c < 5; c++) html += cell(r * 5 + c);
  }
  $('board').innerHTML = html;
  $('panel').innerHTML = panel(sc);
  writeCode();

  // On the board, keyboard focus follows the selection; with nothing selected it lets go,
  // so no stray ring is left on a square that was just played.
  let key = focusKey;
  if (key && key[0] === 'c') key = sel >= 0 ? `c${sel}` : null;
  const target = key && document.querySelector(`[data-key="${key}"]:not(:disabled)`);
  if (target) target.focus();
  else if (focusKey && focusKey[0] === 'c') document.activeElement?.blur();
}

function ind(li) {
  const s = S.status[li];
  return `<div class="${cx('ind', LINES[li].kind, s.decided && (s.winner ?? 'N'))}" aria-hidden="true"></div>`;
}

function cell(i) {
  const p = S.board[i];
  const name = `${COLS[i % 5]}${Math.floor(i / 5) + 1}`;
  const playing = S.phase === 'play';
  if (p) {
    const cls = cx('sq', p.o, p.v === X && 'x', i === S.last && 'last', playing && i === sel && 'sel');
    const glyph = label(p.v);
    return `<button class="${cls}" data-key="c${i}" data-i="${i}" aria-label="${name}, ${NAME[p.o]} ${label(p.v)}">${glyph}</button>`;
  }
  const cls = cx('sq', playing && 'can', playing && i === sel && 'sel');
  return `<button class="${cls}" data-key="c${i}" data-i="${i}" aria-label="${name}, empty"${playing ? '' : ' disabled'}></button>`;
}

const UNDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
const undoBtn = () => `<button class="k undo" data-action="undo" data-key="undo" aria-label="Undo" title="Undo (U)"${history.length ? '' : ' disabled'}>${UNDO}</button>`;

function panel(sc) {
  if (S.phase === 'over') {
    const [cls, text] = sc.R > sc.B ? ['R', `Red wins, ${sc.R}–${sc.B}`]
                      : sc.B > sc.R ? ['B', `Blue wins, ${sc.B}–${sc.R}`]
                      : ['', `A draw, ${sc.R}–${sc.B}`];
    return `<p class="${cx('result', cls)}">${text}</p>
      <div class="pal sub"><button class="k word armed" data-action="again" data-key="again">Play again</button>${undoBtn()}</div>`;
  }
  const armed = sel >= 0 && !S.board[sel];
  const keys = VALUES.map(v => {
    const ok = armed && isLegal(S.board, sel, v);
    return `<button class="${cx('k', armed && 'armed')}" data-action="play" data-v="${v}" data-key="v${v}" aria-label="Place ${label(v)}"${ok ? '' : ' disabled'}>${label(v)}</button>`;
  }).join('');
  const stealRow = canSteal()
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
  }
});
$('new').addEventListener('click', newGame);

const KEYS = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, x: X, X: X };
const ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
const clamp = n => Math.min(4, Math.max(0, n));
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (k === 'z' || k === 'u' || k === 'U') return undo();
  if (S.phase !== 'play') return;
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

// The address is the only place the game is kept. Clear what older versions saved in the browser.
try { localStorage.removeItem('predictions:v1'); } catch (_) {}
if (!loadCode(location.hash.slice(1))) S = fresh();
render();
