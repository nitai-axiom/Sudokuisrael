#!/usr/bin/env node
// add-clues.mjs — make the shipped puzzles gentler by REVEALING more of each
// puzzle's own solution. Adding givens to a uniquely-solvable puzzle keeps it
// unique and never makes it require a harder technique, so no re-rating is needed.
//
// Per DB tier (app tab in parens), deterministic per-puzzle by source_id:
//   very_easy (קל/easy)      -> target 36–40 clues
//   easy      (בינוני/medium) -> target 30–34 clues
//   medium    (קשה/hard)      -> add 1–3 clues
//   hard      (אקסטרים/extreme)-> add 1 clue
//
// Constraint: in the RESULT every row, column, and 3×3 box keeps >= 2 empty
// cells (never filled, never down to a single blank). Deterministic + idempotent
// (re-running lands on the same target and adds nothing further).
//
// Run from the sudoku-pipeline repo, AFTER the dataset exists:  node scripts/add-clues.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(__dirname, "../sudoku_150000.json");
const MIN_EMPTY = 2; // every row/col/box keeps at least this many blanks

const boxOf = (r, c) => Math.floor(r / 3) * 3 + Math.floor(c / 3);
const clues = (s) => { let n = 0; for (const ch of s) if (ch !== "0") n++; return n; };

// deterministic per-puzzle target clue count (or added count) from source_id
export function targetFor(rec) {
  const sid = rec.source_id >>> 0;
  const cur = clues(rec.puzzle);
  switch (rec.difficulty) {
    case "very_easy": return 36 + (sid % 5);          // 36–40
    case "easy":      return 30 + (sid % 5);          // 30–34
    case "medium":    return cur + (1 + (sid % 3));   // +1..3
    case "hard":      return cur + 1;                 // +1
    default:          return cur;
  }
}

// deterministic order of the empty cells (seeded LCG shuffle) so additions spread
function seededOrder(empties, seed) {
  const a = empties.slice();
  let s = (seed >>> 0) || 1;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Reveal cells from the solution up to `target` clues while keeping >= MIN_EMPTY
// blanks in every row, col, and box. Returns {puzzle, givens, added, short}.
export function addClues(rec) {
  const cells = [...rec.puzzle];
  const rowF = Array(9).fill(0), colF = Array(9).fill(0), boxF = Array(9).fill(0);
  const empties = [];
  for (let i = 0; i < 81; i++) {
    const r = (i / 9) | 0, c = i % 9;
    if (cells[i] !== "0") { rowF[r]++; colF[c]++; boxF[boxOf(r, c)]++; } else empties.push(i);
  }
  const cur = 81 - empties.length;
  const need = Math.max(0, targetFor(rec) - cur);
  const cap = 9 - MIN_EMPTY; // <= 7 filled per unit
  let added = 0;
  for (const i of seededOrder(empties, rec.source_id ?? rec.id ?? 1)) {
    if (added >= need) break;
    const r = (i / 9) | 0, c = i % 9, b = boxOf(r, c);
    if (rowF[r] < cap && colF[c] < cap && boxF[b] < cap) {
      cells[i] = rec.solution[i];
      rowF[r]++; colF[c]++; boxF[b]++;
      added++;
    }
  }
  return { puzzle: cells.join(""), givens: cur + added, added, short: need - added };
}

function main() {
  const all = JSON.parse(readFileSync(FILE, "utf8"));
  let shortCount = 0;
  for (const rec of all) {
    const { puzzle, givens, short } = addClues(rec);
    rec.puzzle = puzzle;
    rec.givens = givens;
    if (short > 0) shortCount++;
  }
  writeFileSync(FILE, JSON.stringify(all) + "\n");
  console.log(`Topped up ${all.length} puzzles -> ${FILE}${shortCount ? `  (${shortCount} fell short of target under the >=2-empty rule)` : ""}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
