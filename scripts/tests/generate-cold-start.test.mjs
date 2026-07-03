import { test } from "node:test";
import assert from "node:assert/strict";
import { pickColdStart, toColdStartTs } from "../generate-cold-start.mjs";

function makeSet() {
  const rows = [];
  const mk = (difficulty, i, extra) => ({
    puzzle: `${difficulty[0]}${i}`.padEnd(81, "0"),
    solution: "1".repeat(81),
    difficulty,
    givens: 25,
    fun_score: extra.fun_score ?? null,
    er_rating: extra.er_rating ?? null,
  });
  for (const d of ["very_easy", "easy", "medium"]) for (let i = 0; i < 5; i++) rows.push(mk(d, i, { fun_score: (i % 2) + 1 }));
  for (let i = 0; i < 5; i++) rows.push(mk("hard", i, { er_rating: 3.4 + i / 10 }));
  return rows;
}

test("pickColdStart returns 12 items, 3 per app tier in order", () => {
  const got = pickColdStart(makeSet());
  assert.equal(got.length, 12);
  assert.deepEqual(got.map((p) => p.difficulty), [
    "easy", "easy", "easy", "medium", "medium", "medium",
    "hard", "hard", "hard", "extreme", "extreme", "extreme",
  ]);
});

test("pickColdStart is deterministic", () => {
  assert.deepEqual(pickColdStart(makeSet()), pickColdStart(makeSet()));
});

test("toColdStartTs keeps the static helper exports and emits 12 entries", () => {
  const ts = toColdStartTs(pickColdStart(makeSet()));
  assert.match(ts, /export function firstColdStart/);
  assert.match(ts, /export function randomColdStart/);
  assert.match(ts, /export const COLD_START: ColdStartPuzzle\[\] = \[/);
  assert.equal((ts.match(/difficulty:/g) || []).length, 12);
});
