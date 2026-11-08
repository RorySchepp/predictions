/* Predictions: game state, rendering and input. Needs engine.js loaded first. */
'use strict';

/* ---------- State ---------- */
const other = p => (p === 'R' ? 'B' : 'R');
const STORE_KEY = 'predictions:v1';
const HISTORY_LIMIT = 500;
let starter = 'R', S, history = [], sel = 12;

function fresh() {
  return { board: Array(25).fill(null), first: starter, turn: starter, phase: 'play', moves: 0, last: -1,
           status: LINES.map(() => ({ decided: false })) };
}
const save = () => { history.push(JSON.stringify(S)); if (history.length > HISTORY_LIMIT) history.shift(); };
const finishIfDone = () => { if (S.status.every(s => s.decided)) S.phase = 'over'; };

function newGame() {
  if (S && S.moves > 0) save();   // keep the old game reachable with undo
  S = fresh(); sel = 12; render();
}
function play(i, v) {
  if (S.phase !== 'play' || !isLegal(S.board, i, v)) return;
  save();
  S.board[i] = { v, o: S.turn };
  S.moves++; S.last = i;
  S.status = S.status.map((s, li) => (s.decided ? s : analyzeLine(S.board, LINES[li].cells)));
  finishIfDone();
  if (S.phase !== 'over') S.turn = other(S.turn);
  sel = -1;
  render();
}
const canSteal = () => S.phase === 'play' && S.moves === 1 && S.last >= 0 && S.board[S.last]?.o === S.first;
function steal() {
  if (!canSteal()) return;
  save();
  S.board[S.last] = { ...S.board[S.last], o: S.turn };
  S.turn = S.first;
  S.status = analyzeAll(S.board);
  finishIfDone();
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

/* ---------- Saving between visits ----------
   Browser storage can be missing, full or blocked; the game works the same without it. */
function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ S, history, starter })); } catch (_) {}
}
function validState(s) {
  return s && Array.isArray(s.board) && s.board.length === 25
    && s.board.every(p => p === null || (VALUES.includes(p.v) && (p.o === 'R' || p.o === 'B')))
    && (s.phase === 'play' || s.phase === 'over') && (s.turn === 'R' || s.turn === 'B')
    && (s.first === 'R' || s.first === 'B') && Number.isInteger(s.moves) && Number.isInteger(s.last);
}
function restore() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY));
    if (!d || !validState(d.S)) return false;
    S = d.S;
    S.status = analyzeAll(S.board);   // re-derive rather than trust what was stored
    history = Array.isArray(d.history) ? d.history.filter(h => typeof h === 'string').slice(-HISTORY_LIMIT) : [];
    starter = d.starter === 'B' ? 'B' : 'R';
    sel = S.phase === 'play' && S.moves === 0 ? 12 : -1;
    return true;
  } catch (_) { return false; }
}

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
  persist();

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
      <div class="pal" style="margin-top:14px"><button class="k word armed" data-action="again" data-key="again">Play again</button>${undoBtn()}</div>`;
  }
  const armed = sel >= 0 && !S.board[sel];
  const keys = VALUES.map(v => {
    const ok = armed && isLegal(S.board, sel, v);
    return `<button class="${cx('k', armed && 'armed')}" data-action="play" data-v="${v}" data-key="v${v}" aria-label="Place ${label(v)}"${ok ? '' : ' disabled'}>${label(v)}</button>`;
  }).join('');
  const stealRow = canSteal()
    ? `<div class="pal" style="margin-top:8px"><button class="k word" data-action="steal" data-key="steal" title="Take ${NAME[S.first]}'s opening move as your own (S)">Steal opening move</button></div>`
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

if (!restore()) S = fresh();
render();
