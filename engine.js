/* Predictions: rules engine.
   No DOM access, so the same file runs in the browser (as globals) and in Node (for the tests). */
'use strict';

const X = 6;                          // the × piece; numbers are 1–5
const VALUES = [1, 2, 3, 4, 5, X];
const range = n => [...Array(n).keys()];
const bit = v => 1 << v;
const LINES = [
  ...range(5).map(r => ({ kind: 'row', cells: range(5).map(c => r * 5 + c) })),
  ...range(5).map(c => ({ kind: 'col', cells: range(5).map(r => r * 5 + c) })),
];

/* A number can't repeat in its row or column; an × can go on any empty square. */
function isLegal(board, i, v) {
  if (!Number.isInteger(i) || i < 0 || i > 24 || board[i]) return false;
  if (v === X) return true;
  if (!Number.isInteger(v) || v < 1 || v > 5) return false;
  const r = Math.floor(i / 5), c = i % 5;
  return range(5).every(j => board[r * 5 + j]?.v !== v && board[j * 5 + c]?.v !== v);
}

/* Is a line settled, and for whom?
   Tries every way the line's empty squares could still be filled. Options for each square are taken
   from the board as it stands now; later moves can only remove options, never add them, so a line
   called settled here can never change. A full line goes to whoever owns the piece showing the count
   of numbers in it, or to nobody (winner: null) if no piece shows that count. */
function analyzeLine(board, cells) {
  const empties = [], cellOf = {};
  let used = 0;
  for (const i of cells) {
    const p = board[i];
    if (!p) empties.push(i);
    else if (p.v !== X) { used |= bit(p.v); cellOf[p.v] = i; }
  }
  const placed = Object.keys(cellOf).length;
  if (!empties.length) {
    const cell = cellOf[placed] ?? -1;
    return { decided: true, winner: cell >= 0 ? board[cell].o : null };
  }
  const options = empties.map(e => VALUES.filter(v => isLegal(board, e, v)));
  let outcome, open = false;
  (function fill(k, mask, count) {
    if (open) return;
    if (k === empties.length) {
      const cell = cellOf[count] ?? -1;
      // The winning number would be one still to be placed, and either player might place it.
      if (cell < 0 && (mask & bit(count))) { open = true; return; }
      const result = cell >= 0 ? board[cell].o : null;
      if (outcome === undefined) outcome = result;
      else if (outcome !== result) open = true;
      return;
    }
    for (const v of options[k]) {
      if (v === X) fill(k + 1, mask, count);
      else if (!(mask & bit(v))) fill(k + 1, mask | bit(v), count + 1);
    }
  })(0, used, placed);
  return open ? { decided: false } : { decided: true, winner: outcome };
}
const analyzeAll = board => LINES.map(L => analyzeLine(board, L.cells));

if (typeof module !== 'undefined') module.exports = { X, VALUES, LINES, isLegal, analyzeLine, analyzeAll };
