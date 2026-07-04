import { test } from "node:test";
import assert from "node:assert/strict";
import { pickSample } from "../generate-sample-puzzles.mjs";

function makeSet() {
  const rows = [];
  const mk = (difficulty, i) => ({ puzzle: `${difficulty[0]}${i}`.padEnd(81, "0"), solution: "1".repeat(81), difficulty, techniques: ["naked_singles"], givens: 25, fun_score: (i % 2) + 1, er_rating: null });
  for (const d of ["very_easy", "easy", "medium", "hard"]) for (let i = 0; i < 6; i++) rows.push(mk(d, i));
  return rows;
}

test("pickSample returns 15 rows, 5 each of easy/medium/hard, prototype shape", () => {
  const got = pickSample(makeSet());
  assert.equal(got.length, 15);
  const counts = {};
  for (const p of got) counts[p.difficulty] = (counts[p.difficulty] ?? 0) + 1;
  assert.deepEqual(counts, { easy: 5, medium: 5, hard: 5 });
  assert.deepEqual(Object.keys(got[0]).sort(), ["difficulty", "givens", "puzzle", "solution", "techniques"]);
});

test("pickSample is deterministic", () => {
  assert.deepEqual(pickSample(makeSet()), pickSample(makeSet()));
});
