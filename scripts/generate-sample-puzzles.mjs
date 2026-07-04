#!/usr/bin/env node
// generate-sample-puzzles.mjs — regenerate the root puzzles.json used only by
// the superseded web/ prototype (tabs easy/medium/hard). 5 per tier from
// sudoku_150000.json, fun_score DESC then puzzle ASC. Deterministic.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "../sudoku_150000.json");
const DEST = resolve(__dirname, "../puzzles.json");
const PER_TIER = 5;
const TIERS = ["easy", "medium", "hard"]; // DB tier names the prototype expects

const cmpPuzzle = (a, b) => (a.puzzle < b.puzzle ? -1 : a.puzzle > b.puzzle ? 1 : 0);

export function pickSample(all) {
  const out = [];
  for (const d of TIERS) {
    const list = all.filter((p) => p.difficulty === d).sort((a, b) => (b.fun_score - a.fun_score) || cmpPuzzle(a, b));
    if (list.length < PER_TIER) throw new Error(`Tier '${d}' has ${list.length} < ${PER_TIER}`);
    for (const p of list.slice(0, PER_TIER)) {
      out.push({ puzzle: p.puzzle, solution: p.solution, difficulty: p.difficulty, techniques: p.techniques ?? [], givens: p.givens });
    }
  }
  return out;
}

function main() {
  const all = JSON.parse(readFileSync(SRC, "utf8"));
  const sample = pickSample(all);
  writeFileSync(DEST, JSON.stringify(sample, null, 2) + "\n");
  console.log(`Wrote ${sample.length} sample puzzles to ${DEST}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
