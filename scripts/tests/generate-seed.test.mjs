import { test } from "node:test";
import assert from "node:assert/strict";
import { pickTier, interleave, selectDaily, toSeedSql } from "../generate-seed.mjs";

// Small synthetic dataset: enough of each tier to satisfy 37/146/145/37.
function makeSet() {
  const rows = [];
  const mk = (difficulty, i, extra) => ({
    puzzle: `${difficulty[0]}${String(i).padStart(80, "0")}`.slice(0, 81).padEnd(81, "0"),
    solution: "1".repeat(81),
    difficulty,
    techniques: ["naked_singles"],
    givens: 25,
    fun_score: extra.fun_score ?? null,
    er_rating: extra.er_rating ?? null,
  });
  for (let i = 0; i < 40; i++) rows.push(mk("very_easy", i, { fun_score: (i % 2) + 1 }));
  for (let i = 0; i < 160; i++) rows.push(mk("easy", i, { fun_score: (i % 2) + 1 }));
  for (let i = 0; i < 160; i++) rows.push(mk("medium", i, { fun_score: (i % 4) + 2 }));
  for (let i = 0; i < 40; i++) rows.push(mk("hard", i, { er_rating: 3.4 + (i % 10) / 10 }));
  return rows;
}

test("pickTier returns n, fun_score DESC then puzzle ASC for very_easy", () => {
  const got = pickTier(makeSet(), "very_easy", 5);
  assert.equal(got.length, 5);
  for (let i = 1; i < got.length; i++) {
    const a = got[i - 1], b = got[i];
    assert.ok(a.fun_score > b.fun_score || (a.fun_score === b.fun_score && a.puzzle <= b.puzzle));
  }
});

test("pickTier for hard sorts by er_rating ASC (gentlest first)", () => {
  const got = pickTier(makeSet(), "hard", 5);
  assert.equal(got.length, 5);
  for (let i = 1; i < got.length; i++) assert.ok(got[i - 1].er_rating <= got[i].er_rating);
});

test("pickTier throws when the tier can't supply n", () => {
  assert.throws(() => pickTier(makeSet(), "very_easy", 41), /very_easy/);
});

test("interleave preserves every item and spreads tiers evenly", () => {
  const tiers = [
    { name: "very_easy", items: Array.from({ length: 37 }, (_, i) => ({ difficulty: "very_easy", puzzle: `v${i}` })) },
    { name: "easy", items: Array.from({ length: 146 }, (_, i) => ({ difficulty: "easy", puzzle: `e${i}` })) },
    { name: "medium", items: Array.from({ length: 145 }, (_, i) => ({ difficulty: "medium", puzzle: `m${i}` })) },
    { name: "hard", items: Array.from({ length: 37 }, (_, i) => ({ difficulty: "hard", puzzle: `h${i}` })) },
  ];
  const out = interleave(tiers);
  assert.equal(out.length, 365);
  const counts = {};
  for (const p of out) counts[p.difficulty] = (counts[p.difficulty] ?? 0) + 1;
  assert.deepEqual(counts, { very_easy: 37, easy: 146, medium: 145, hard: 37 });
  // Even spread: no difficulty runs more than 4 in a row (mids are ~80% combined).
  let run = 1;
  for (let i = 1; i < out.length; i++) {
    run = out[i].difficulty === out[i - 1].difficulty ? run + 1 : 1;
    assert.ok(run <= 4, `run of ${out[i].difficulty} reached ${run} at ${i}`);
  }
  // Each 40-slot window contains at least one very_easy and one hard (evenly sprinkled).
  for (let w = 0; w + 40 <= out.length; w += 40) {
    const win = out.slice(w, w + 40).map((p) => p.difficulty);
    assert.ok(win.includes("very_easy") && win.includes("hard"), `window @${w} missing a rare tier`);
  }
});

test("interleave is deterministic", () => {
  const build = () => [
    { name: "very_easy", items: [{ difficulty: "very_easy", puzzle: "v0" }] },
    { name: "easy", items: [{ difficulty: "easy", puzzle: "e0" }, { difficulty: "easy", puzzle: "e1" }] },
    { name: "medium", items: [{ difficulty: "medium", puzzle: "m0" }] },
    { name: "hard", items: [{ difficulty: "hard", puzzle: "h0" }] },
  ];
  assert.deepEqual(interleave(build()).map((p) => p.puzzle), interleave(build()).map((p) => p.puzzle));
});

test("selectDaily yields 365 with exact tier composition and a 1..365 permutation via toSeedSql", () => {
  const daily = selectDaily(makeSet());
  assert.equal(daily.length, 365);
  const counts = {};
  for (const p of daily) counts[p.difficulty] = (counts[p.difficulty] ?? 0) + 1;
  assert.deepEqual(counts, { very_easy: 37, easy: 146, medium: 145, hard: 37 });
  const sql = toSeedSql(daily);
  const positions = [...sql.matchAll(/,\s*(\d+)\)/g)].map((m) => Number(m[1]));
  assert.equal(positions.length, 365);
  assert.deepEqual([...positions].sort((a, b) => a - b), Array.from({ length: 365 }, (_, i) => i + 1));
});
