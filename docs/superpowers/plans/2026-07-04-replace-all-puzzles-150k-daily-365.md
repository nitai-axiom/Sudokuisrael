# Replace-All-Puzzles (150k) + Daily-365 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-source every puzzle the product serves from `sudoku_150000.json` — regenerate the daily-365 seed, the 148k online load tooling, and the cold-start bundle; delete all superseded artifacts; leave a runbook for the one-time live Supabase reload.

**Architecture:** All generators live in `sudoku-pipeline/scripts/` and are pure-core + thin-CLI so their logic is unit-testable against small in-memory fixtures (never the 68 MB file). They write their outputs into the separate `sudoku_next` repo (`supabase/seed.sql`, `app/lib/cold-start-puzzles.ts`) and into this repo (`puzzles.json`). The 148k online load is a plain-`fetch` PostgREST streaming loader (no new dependency) run by the operator with a service-role key; the live truncate+load+seed is a documented manual step, not agent-run.

**Tech Stack:** Node ≥ 22 ESM (`.mjs`), Node built-in test runner (`node --test`), Supabase PostgREST (`fetch`), Postgres.

## Global Constraints

- Node built-in test runner only; new tests are `scripts/tests/*.test.mjs`, wired into the root `npm test` glob. No new runtime/test dependencies (loader uses global `fetch`).
- Source dataset: `sudoku-pipeline/sudoku_150000.json` (gitignored, 68 MB, present locally). Fields per record: `id, source_id, puzzle(81), solution(81), difficulty ∈ {very_easy,easy,medium,hard}, techniques[], givens, er_rating, fun_score, generated_at`.
- Field coverage: `fun_score` present for very_easy/easy/medium, **null for all hard**; `er_rating` present for hard only (band 3.4–4.5), null elsewhere.
- Daily counts (exact): very_easy 37, easy 146, medium 145, hard 37 = 365.
- Daily selection: very_easy/easy/medium ⇒ `fun_score` DESC then `puzzle` ASC; hard ⇒ `er_rating` ASC then `puzzle` ASC.
- App↔DB difficulty remap (used only by the cold-start generator's labels): DB `very_easy→`app `easy`, `easy→medium`, `medium→hard`, `hard→extreme`.
- Determinism: no `Math.random`, no `Date.now()` in any generator; re-runs are byte-identical.
- Two repos: `sudoku-pipeline` = `/Users/nitairosenberg/sudoku-pipeline`; `sudoku_next` = `/Users/nitairosenberg/sudoku_next`. Commit outputs in the repo that owns the file.
- Supabase `puzzles` unique key is `puzzle`; online upsert semantics = insert, ignore duplicates (`on_conflict=puzzle`, `Prefer: resolution=ignore-duplicates`).

---

## File structure

**sudoku-pipeline (this repo):**
- `scripts/generate-seed.mjs` — MODIFY (repoint to 150k; new distribution + deterministic interleave). Owns `sudoku_next/supabase/seed.sql`.
- `scripts/generate-cold-start.mjs` — CREATE. Owns `sudoku_next/app/lib/cold-start-puzzles.ts`.
- `scripts/load-supabase.mjs` — CREATE. Streaming PostgREST loader for the 148k.
- `scripts/generate-sample-puzzles.mjs` — CREATE. Owns root `puzzles.json` (small prototype sample).
- `scripts/tests/*.test.mjs` — CREATE (one per generator; pure-function tests).
- `package.json` — MODIFY (extend `test` glob).
- DELETE: `scripts/generate-library.mjs`, `upload_to_supabase.py`, `sudoku_10000.json`, `sudoku_lower.json`.
- `puzzles.json` — MODIFY (regenerated sample).
- `docs/*` — MODIFY.

**sudoku_next (app repo):**
- `supabase/seed.sql` — MODIFY (regenerated: 365).
- `app/lib/cold-start-puzzles.ts` — MODIFY (regenerated: 12).
- DELETE: `supabase/puzzles_library.sql`.
- `docs/*` (+ a load runbook) — MODIFY/CREATE.

---

## Task 1: Daily seed generator (`generate-seed.mjs` rewrite)

**Files:**
- Modify: `sudoku-pipeline/scripts/generate-seed.mjs`
- Modify: `sudoku-pipeline/package.json` (test glob)
- Test: `sudoku-pipeline/scripts/tests/generate-seed.test.mjs`

**Interfaces:**
- Produces (named exports from `generate-seed.mjs`, consumed by tests):
  - `pickTier(all, difficulty, n)` → `Puzzle[]` (length n; throws if fewer available). Uses the tier-aware sort key.
  - `interleave(tiers)` → `Puzzle[]` where `tiers` is `[{name, items}]` in fixed order `[very_easy, easy, medium, hard]`; returns all items woven so each tier is evenly spread; length = Σ items.
  - `selectDaily(all)` → `Puzzle[]` of length 365 (calls pickTier with 37/146/145/37, then interleave).
  - `toSeedSql(rows)` → `string` (the full seed.sql text; `position = index+1`).
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing test**

Create `sudoku-pipeline/scripts/tests/generate-seed.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nitairosenberg/sudoku-pipeline && node --test scripts/tests/generate-seed.test.mjs`
Expected: FAIL — `pickTier` / `interleave` / etc. not exported (module currently has no exports).

- [ ] **Step 3: Rewrite the script**

Replace the entire contents of `sudoku-pipeline/scripts/generate-seed.mjs`:

```js
#!/usr/bin/env node
// generate-seed.mjs — select the 365 daily puzzles from sudoku_150000.json and
// emit an idempotent SQL seed for the sudoku_next Supabase database.
//
//   Composition: 37 very_easy + 146 easy + 145 medium + 37 hard = 365.
//   Selection:   very_easy/easy/medium by fun_score DESC then puzzle ASC;
//                hard by er_rating ASC (gentlest first) then puzzle ASC.
//   Order:       deterministically interleaved so difficulty varies day-to-day.
//   Output:      sudoku_next/supabase/seed.sql  (INSERT ... ON CONFLICT (puzzle)
//                DO UPDATE, setting position; publish_date/is_active untouched).
//
// Run from the sudoku-pipeline repo:  node scripts/generate-seed.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "../sudoku_150000.json");
const DEST = resolve(__dirname, "../../sudoku_next/supabase/seed.sql");

// Fixed tier order (also the interleave tie-break order).
export const TIER_QUOTA = [
  { name: "very_easy", n: 37 },
  { name: "easy", n: 146 },
  { name: "medium", n: 145 },
  { name: "hard", n: 37 },
];

const cmpPuzzle = (a, b) => (a.puzzle < b.puzzle ? -1 : a.puzzle > b.puzzle ? 1 : 0);

export function pickTier(all, difficulty, n) {
  const list = all.filter((p) => p.difficulty === difficulty);
  const key =
    difficulty === "hard"
      ? (a, b) => (a.er_rating - b.er_rating) || cmpPuzzle(a, b) // gentlest hard first
      : (a, b) => (b.fun_score - a.fun_score) || cmpPuzzle(a, b); // most fun first
  list.sort(key);
  if (list.length < n) throw new Error(`Tier '${difficulty}' has ${list.length} < ${n} needed`);
  return list.slice(0, n);
}

// Evenly weave tiers: at each slot emit the tier whose ideal cumulative share
// (len/total * slot) most exceeds what it has already taken. Fixed tier order
// breaks ties, so the result is deterministic.
export function interleave(tiers) {
  const total = tiers.reduce((s, t) => s + t.items.length, 0);
  const state = tiers.map((t) => ({ items: t.items, len: t.items.length, taken: 0, idx: 0 }));
  const out = [];
  for (let slot = 1; slot <= total; slot++) {
    let best = null;
    let bestScore = -Infinity;
    for (const s of state) {
      if (s.idx >= s.len) continue;
      const score = (s.len / total) * slot - s.taken;
      if (score > bestScore + 1e-9) {
        bestScore = score;
        best = s;
      }
    }
    best.taken++;
    out.push(best.items[best.idx++]);
  }
  return out;
}

export function selectDaily(all) {
  const tiers = TIER_QUOTA.map((q) => ({ name: q.name, items: pickTier(all, q.name, q.n) }));
  return interleave(tiers);
}

function pgTextArray(arr) {
  if (!arr || arr.length === 0) return `'{}'`;
  return `array[${arr.map((t) => `'${String(t).replace(/'/g, "''")}'`).join(",")}]`;
}

function valuesRow(p, position) {
  const givens = Number.isFinite(p.givens) ? p.givens : "null";
  const funScore = Number.isFinite(p.fun_score) ? p.fun_score : "null";
  const erRating = p.er_rating == null ? "null" : Number(p.er_rating);
  return `  ('${p.puzzle}', '${p.solution}', '${p.difficulty}', ${pgTextArray(p.techniques)}, ${givens}, ${funScore}, ${erRating}, ${position})`;
}

export function toSeedSql(daily) {
  const rows = daily.map((p, i) => valuesRow(p, i + 1)).join(",\n");
  const counts = TIER_QUOTA.map((q) => `${q.n} ${q.name}`).join(" + ");
  return `-- seed.sql — the 365 daily Sudoku puzzles (${counts}).
-- GENERATED by sudoku-pipeline/scripts/generate-seed.mjs — do not edit by hand.
-- Idempotent: safe to re-run. publish_date and is_active are intentionally NOT
-- overwritten on conflict, so owner-assigned release dates survive a re-seed.
-- Positions 1..365 are deterministically interleaved so difficulty varies daily.

insert into public.puzzles
  (puzzle, solution, difficulty, techniques, givens, fun_score, er_rating, position)
values
${rows}
on conflict (puzzle) do update set
  solution   = excluded.solution,
  difficulty = excluded.difficulty,
  techniques = excluded.techniques,
  givens     = excluded.givens,
  fun_score  = excluded.fun_score,
  er_rating  = excluded.er_rating,
  position   = excluded.position;
`;
}

function main() {
  const all = JSON.parse(readFileSync(SRC, "utf8"));
  const daily = selectDaily(all);
  writeFileSync(DEST, toSeedSql(daily));
  const counts = TIER_QUOTA.map((q) => `${daily.filter((p) => p.difficulty === q.name).length} ${q.name}`).join(" + ");
  console.log(`Wrote ${daily.length} daily puzzles (${counts}) to ${DEST}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
```

- [ ] **Step 4: Wire the new test glob into `npm test`**

In `sudoku-pipeline/package.json`, change the `test` script to:

```json
    "test": "node --test \"tests/**/*.test.ts\" \"dataset-pipeline/tests/**/*.test.ts\" \"scripts/tests/**/*.test.mjs\""
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/nitairosenberg/sudoku-pipeline && node --test scripts/tests/generate-seed.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/nitairosenberg/sudoku-pipeline
git add scripts/generate-seed.mjs scripts/tests/generate-seed.test.mjs package.json
git commit -m "feat(seed): daily-365 generator from 150k (tier-aware pick + deterministic interleave)"
```

---

## Task 2: Cold-start generator (`generate-cold-start.mjs`)

**Files:**
- Create: `sudoku-pipeline/scripts/generate-cold-start.mjs`
- Test: `sudoku-pipeline/scripts/tests/generate-cold-start.test.mjs`

**Interfaces:**
- Produces:
  - `pickColdStart(all)` → array of 12 `{difficulty(app label), givens, puzzle, solution}` (3 per app tier, in order easy, medium, hard, extreme).
  - `toColdStartTs(items)` → full `.ts` file text (imports + type + JSDoc + `COLD_START` array + the two static helpers).
- DB→app label map inside the module: `{ very_easy:"easy", easy:"medium", medium:"hard", hard:"extreme" }`.

- [ ] **Step 1: Write the failing test**

Create `sudoku-pipeline/scripts/tests/generate-cold-start.test.mjs`:

```js
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
  assert.match(ts, /difficulty: Difficulty;/); // type field present (matches real file)
  assert.equal((ts.match(/difficulty: "/g) || []).length, 12); // 12 puzzle object entries
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nitairosenberg/sudoku-pipeline && node --test scripts/tests/generate-cold-start.test.mjs`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the script**

Create `sudoku-pipeline/scripts/generate-cold-start.mjs`:

```js
#!/usr/bin/env node
// generate-cold-start.mjs — regenerate sudoku_next/app/lib/cold-start-puzzles.ts,
// the 12-puzzle offline bundle (3 per app tier), from sudoku_150000.json.
// Deterministic: very_easy/easy/medium by fun_score DESC then puzzle ASC;
// hard by er_rating ASC then puzzle ASC. DB tier → app label via APP_LABEL.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "../sudoku_150000.json");
const DEST = resolve(__dirname, "../../sudoku_next/app/lib/cold-start-puzzles.ts");

const PER_TIER = 3;
// [DB tier, app label] in emit order.
const TIERS = [
  ["very_easy", "easy"],
  ["easy", "medium"],
  ["medium", "hard"],
  ["hard", "extreme"],
];

const cmpPuzzle = (a, b) => (a.puzzle < b.puzzle ? -1 : a.puzzle > b.puzzle ? 1 : 0);

export function pickColdStart(all) {
  const out = [];
  for (const [dbTier, appLabel] of TIERS) {
    const list = all.filter((p) => p.difficulty === dbTier);
    const key =
      dbTier === "hard"
        ? (a, b) => (a.er_rating - b.er_rating) || cmpPuzzle(a, b)
        : (a, b) => (b.fun_score - a.fun_score) || cmpPuzzle(a, b);
    list.sort(key);
    if (list.length < PER_TIER) throw new Error(`Tier '${dbTier}' has ${list.length} < ${PER_TIER}`);
    for (const p of list.slice(0, PER_TIER)) {
      out.push({ difficulty: appLabel, givens: p.givens, puzzle: p.puzzle, solution: p.solution });
    }
  }
  return out;
}

export function toColdStartTs(items) {
  const dbFor = { easy: "very_easy", medium: "easy", hard: "medium", extreme: "hard" };
  let blocks = "";
  for (const [, appLabel] of TIERS) {
    blocks += `\n  // --- ${appLabel} (DB: ${dbFor[appLabel]}) ---\n`;
    for (const p of items.filter((x) => x.difficulty === appLabel)) {
      blocks +=
        `  {\n` +
        `    difficulty: "${p.difficulty}",\n` +
        `    givens: ${p.givens},\n` +
        `    puzzle: "${p.puzzle}",\n` +
        `    solution: "${p.solution}",\n` +
        `  },\n`;
    }
  }
  return `import type { Difficulty } from "./puzzles";

export type ColdStartPuzzle = {
  puzzle: string;
  solution: string;
  givens: number;
  difficulty: Difficulty;
};

/**
 * 12-puzzle cold-start bundle — 3 per app difficulty tier.
 * GENERATED by sudoku-pipeline/scripts/generate-cold-start.mjs — do not edit by hand.
 * Picked from sudoku_150000.json and remapped: DB very_easy→easy, easy→medium,
 * medium→hard, hard→extreme.
 */
export const COLD_START: ColdStartPuzzle[] = [${blocks}];

/** Deterministic first puzzle for a given difficulty — SSR-safe. */
export function firstColdStart(d: Difficulty): ColdStartPuzzle {
  const found = COLD_START.filter((p) => p.difficulty === d)[0];
  if (!found) throw new Error(\`No cold-start puzzle for difficulty "\${d}"\`);
  return found;
}

/** Random puzzle of a difficulty — client-only (called after mount). */
export function randomColdStart(d: Difficulty): ColdStartPuzzle {
  const list = COLD_START.filter((p) => p.difficulty === d);
  if (list.length === 0) throw new Error(\`No cold-start puzzle for difficulty "\${d}"\`);
  return list[Math.floor(Math.random() * list.length)];
}
`;
}

function main() {
  const all = JSON.parse(readFileSync(SRC, "utf8"));
  const items = pickColdStart(all);
  writeFileSync(DEST, toColdStartTs(items));
  console.log(`Wrote ${items.length} cold-start puzzles to ${DEST}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/nitairosenberg/sudoku-pipeline && node --test scripts/tests/generate-cold-start.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/nitairosenberg/sudoku-pipeline
git add scripts/generate-cold-start.mjs scripts/tests/generate-cold-start.test.mjs
git commit -m "feat(cold-start): regenerate 12-puzzle bundle from 150k (deterministic)"
```

---

## Task 3: Supabase streaming loader (`load-supabase.mjs`)

**Files:**
- Create: `sudoku-pipeline/scripts/load-supabase.mjs`
- Test: `sudoku-pipeline/scripts/tests/load-supabase.test.mjs`

**Interfaces:**
- Produces:
  - `toRow(p)` → `{puzzle, solution, difficulty, techniques, givens, fun_score, er_rating}` (nulls preserved; no `position`/`is_active`).
  - `batches(arr, size)` → array of chunks (last may be short).
  - `buildRequest(baseUrl, serviceKey, rows)` → `{url, headers, body}` for a PostgREST insert with `on_conflict=puzzle` + `Prefer: resolution=ignore-duplicates,return=minimal`.
  - `loadAll({url, key, data, fetchImpl, batchSize})` → `Promise<{sent:number}>` (side-effecting; `fetchImpl` injectable for tests).

- [ ] **Step 1: Write the failing test**

Create `sudoku-pipeline/scripts/tests/load-supabase.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { toRow, batches, buildRequest, loadAll } from "../load-supabase.mjs";

test("toRow maps fields and preserves nulls", () => {
  assert.deepEqual(
    toRow({ id: 9, source_id: 3, puzzle: "p", solution: "s", difficulty: "hard", techniques: ["x"], givens: 24, fun_score: null, er_rating: 4.2, generated_at: "z" }),
    { puzzle: "p", solution: "s", difficulty: "hard", techniques: ["x"], givens: 24, fun_score: null, er_rating: 4.2 },
  );
});

test("batches splits into chunks with a short tail", () => {
  const b = batches([1, 2, 3, 4, 5], 2);
  assert.deepEqual(b, [[1, 2], [3, 4], [5]]);
});

test("buildRequest targets puzzles with ignore-duplicates upsert", () => {
  const { url, headers, body } = buildRequest("https://x.supabase.co", "KEY", [{ puzzle: "p" }]);
  assert.equal(url, "https://x.supabase.co/rest/v1/puzzles?on_conflict=puzzle");
  assert.equal(headers.apikey, "KEY");
  assert.equal(headers.Authorization, "Bearer KEY");
  assert.match(headers.Prefer, /resolution=ignore-duplicates/);
  assert.equal(body, JSON.stringify([{ puzzle: "p" }]));
});

test("loadAll posts every batch and counts rows sent", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(JSON.parse(opts.body).length);
    return { ok: true, status: 201, text: async () => "" };
  };
  const data = Array.from({ length: 5 }, (_, i) => ({ puzzle: `p${i}`, solution: "s", difficulty: "easy", techniques: [], givens: 25, fun_score: 1, er_rating: null }));
  const res = await loadAll({ url: "https://x.supabase.co", key: "K", data, fetchImpl, batchSize: 2 });
  assert.equal(res.sent, 5);
  assert.deepEqual(calls, [2, 2, 1]);
});

test("loadAll throws on a non-ok response", async () => {
  const fetchImpl = async () => ({ ok: false, status: 400, text: async () => "bad" });
  await assert.rejects(
    loadAll({ url: "u", key: "K", data: [{ puzzle: "p" }], fetchImpl, batchSize: 1 }),
    /400/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nitairosenberg/sudoku-pipeline && node --test scripts/tests/load-supabase.test.mjs`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the script**

Create `sudoku-pipeline/scripts/load-supabase.mjs`:

```js
#!/usr/bin/env node
// load-supabase.mjs — stream every puzzle in sudoku_150000.json into the live
// Supabase `puzzles` table via PostgREST. Insert + ignore duplicates (unique
// key = puzzle), so it is idempotent and re-runnable. position/publish_date/
// is_active are left to column defaults; seed.sql stamps the daily positions.
//
// Requires a SERVICE-ROLE key (bypasses RLS). Run AFTER truncating the table:
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/load-supabase.mjs
//
// No dependencies: uses global fetch (Node >= 18).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "../sudoku_150000.json");
const BATCH_SIZE = 500;

export function toRow(p) {
  return {
    puzzle: p.puzzle,
    solution: p.solution,
    difficulty: p.difficulty,
    techniques: p.techniques ?? [],
    givens: p.givens ?? null,
    fun_score: p.fun_score ?? null,
    er_rating: p.er_rating ?? null,
  };
}

export function batches(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function buildRequest(baseUrl, serviceKey, rows) {
  return {
    url: `${baseUrl}/rest/v1/puzzles?on_conflict=puzzle`,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  };
}

export async function loadAll({ url, key, data, fetchImpl = fetch, batchSize = BATCH_SIZE }) {
  let sent = 0;
  for (const chunk of batches(data, batchSize)) {
    const req = buildRequest(url, key, chunk);
    const res = await fetchImpl(req.url, { method: "POST", headers: req.headers, body: req.body });
    if (!res.ok) throw new Error(`Load failed: ${res.status} ${await res.text()}`);
    sent += chunk.length;
    console.log(`Uploaded ${sent}/${data.length}`);
  }
  return { sent };
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("ERROR: set SUPABASE_URL and SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(SRC, "utf8")).map(toRow);
  const { sent } = await loadAll({ url, key, data });
  console.log(`Done — ${sent} puzzles loaded.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/nitairosenberg/sudoku-pipeline && node --test scripts/tests/load-supabase.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/nitairosenberg/sudoku-pipeline
git add scripts/load-supabase.mjs scripts/tests/load-supabase.test.mjs
git commit -m "feat(load): PostgREST streaming loader for the 148k online pool"
```

---

## Task 4: Root prototype sample (`generate-sample-puzzles.mjs` + `puzzles.json`)

**Files:**
- Create: `sudoku-pipeline/scripts/generate-sample-puzzles.mjs`
- Modify: `sudoku-pipeline/puzzles.json` (regenerated output)
- Test: `sudoku-pipeline/scripts/tests/generate-sample-puzzles.test.mjs`

**Interfaces:**
- Produces: `pickSample(all)` → 15 objects `{puzzle, solution, difficulty, techniques, givens}` (5 each of `easy`, `medium`, `hard` — using the DB tiers whose names the prototype already expects), `fun_score` DESC then `puzzle` ASC.

Note: the `web/` prototype's `Puzzle` type is `easy|medium|hard`, so this samples the DB tiers named `easy`/`medium`/`hard` directly (very_easy is not one of the prototype's tabs).

- [ ] **Step 1: Write the failing test**

Create `sudoku-pipeline/scripts/tests/generate-sample-puzzles.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nitairosenberg/sudoku-pipeline && node --test scripts/tests/generate-sample-puzzles.test.mjs`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the script**

Create `sudoku-pipeline/scripts/generate-sample-puzzles.mjs`:

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/nitairosenberg/sudoku-pipeline && node --test scripts/tests/generate-sample-puzzles.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit (script only; the regenerated puzzles.json lands in Task 5)**

```bash
cd /Users/nitairosenberg/sudoku-pipeline
git add scripts/generate-sample-puzzles.mjs scripts/tests/generate-sample-puzzles.test.mjs
git commit -m "feat(sample): prototype puzzles.json generator from 150k"
```

---

## Task 5: Regenerate all artifacts from the real 150k dataset

Runs the four generators against `sudoku_150000.json` and commits the regenerated outputs in the repo that owns each. Depends on Tasks 1, 2, 4.

**Files:**
- Modify (output): `sudoku_next/supabase/seed.sql`, `sudoku_next/app/lib/cold-start-puzzles.ts`, `sudoku-pipeline/puzzles.json`

- [ ] **Step 1: Regenerate**

```bash
cd /Users/nitairosenberg/sudoku-pipeline
node scripts/generate-seed.mjs
node scripts/generate-cold-start.mjs
node scripts/generate-sample-puzzles.mjs
```

Expected console: `Wrote 365 daily puzzles (37 very_easy + 146 easy + 145 medium + 37 hard) ...`, `Wrote 12 cold-start puzzles ...`, `Wrote 15 sample puzzles ...`.

- [ ] **Step 2: Verify seed.sql composition (365, tier counts, contiguous 1..365)**

```bash
cd /Users/nitairosenberg/sudoku_next
node -e '
const s=require("fs").readFileSync("supabase/seed.sql","utf8");
const rows=[...s.matchAll(/^  \(.*, (\d+)\)[,;]?$/gm)];
const diffs={}; for(const l of s.split("\n")){const m=l.match(/, .(very_easy|easy|medium|hard)., /); if(m)diffs[m[1]]=(diffs[m[1]]||0)+1;}
const pos=rows.map(r=>+r[1]).sort((a,b)=>a-b);
console.log("rows:",rows.length,"diffs:",diffs,"pos 1..N:",pos[0]===1&&pos[pos.length-1]===pos.length&&new Set(pos).size===pos.length);
'
```

Expected: `rows: 365 diffs: { very_easy: 37, easy: 146, medium: 145, hard: 37 } pos 1..N: true`.

- [ ] **Step 3: Typecheck the regenerated cold-start file compiles**

```bash
cd /Users/nitairosenberg/sudoku_next && npx tsc --noEmit app/lib/cold-start-puzzles.ts 2>&1 | head -5 || true
```

Expected: no errors referencing `cold-start-puzzles.ts` (a `Difficulty` import resolution note from isolated invocation is acceptable; the goal is no syntax/shape errors).

- [ ] **Step 4: Commit the app-repo artifacts**

```bash
cd /Users/nitairosenberg/sudoku_next
git add supabase/seed.sql app/lib/cold-start-puzzles.ts
git commit -m "chore(data): regenerate daily-365 seed + cold-start from 150k dataset"
```

- [ ] **Step 5: Commit the pipeline sample output**

```bash
cd /Users/nitairosenberg/sudoku-pipeline
git add puzzles.json
git commit -m "chore(data): regenerate prototype puzzles.json sample from 150k"
```

---

## Task 6: Delete superseded artifacts (both repos)

Depends on Task 5 (so the replacements exist and are committed before removals).

**Files:**
- Delete (pipeline): `scripts/generate-library.mjs`, `upload_to_supabase.py`, `sudoku_10000.json`, `sudoku_lower.json`
- Delete (app): `supabase/puzzles_library.sql`

- [ ] **Step 1: Confirm nothing still references the deletions**

```bash
cd /Users/nitairosenberg/sudoku-pipeline
grep -rn "generate-library\|upload_to_supabase\|sudoku_10000\|sudoku_lower" scripts/ package.json README.md 2>/dev/null || echo "pipeline: no refs"
cd /Users/nitairosenberg/sudoku_next
grep -rn "puzzles_library" supabase/ app/ package.json 2>/dev/null || echo "sudoku_next: no refs"
```

Expected: both print "no refs" (README prose mentions are fine to update in Task 7; code/config must be clean).

- [ ] **Step 2: Delete pipeline files + commit**

```bash
cd /Users/nitairosenberg/sudoku-pipeline
git rm scripts/generate-library.mjs upload_to_supabase.py
git rm --ignore-unmatch sudoku_10000.json sudoku_lower.json   # gitignored → may be untracked
rm -f sudoku_10000.json sudoku_lower.json
git commit -m "chore: remove superseded 10k generators + datasets (150k is the only source)"
```

- [ ] **Step 3: Delete app library SQL + commit**

```bash
cd /Users/nitairosenberg/sudoku_next
git rm supabase/puzzles_library.sql
git commit -m "chore(supabase): drop 10k puzzles_library.sql (pool now loads via streaming loader)"
```

---

## Task 7: Docs, runbook, and memory

Depends on Tasks 1–6.

**Files:**
- Modify (pipeline): `docs/CHANGELOG.md`, `docs/STATUS.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/API.md`, `docs/BUGS.md` (as relevant); `README.md` if it references removed files.
- Create (app): `sudoku_next/docs/RELOAD-RUNBOOK.md` (the operator steps); update its `docs/*` state files if present.
- Modify: memory file `sudoku-kaggle-150k-dataset.md` + `MEMORY.md` pointer.

- [ ] **Step 1: Write the reload runbook**

Create `sudoku_next/docs/RELOAD-RUNBOOK.md` documenting the one-time live reload:

```markdown
# Reload runbook — replace all online puzzles with the 150k dataset

Prereqs: `sudoku-pipeline/sudoku_150000.json` present; the Supabase **service-role** key.

1. Regenerate artifacts (pipeline repo):
   `node scripts/generate-seed.mjs && node scripts/generate-cold-start.mjs && node scripts/generate-sample-puzzles.mjs`
2. Purge online (Supabase SQL editor) — **destructive, wipes solves via cascade**:
   `truncate public.puzzles restart identity cascade;`
3. Bulk load 148,206 (pipeline repo):
   `SUPABASE_URL=<project-url> SUPABASE_SERVICE_KEY=<service-role-key> node scripts/load-supabase.mjs`
4. Stamp daily positions: run `sudoku_next/supabase/seed.sql` in the SQL editor.
5. Verify:
   `select count(*) from puzzles;`            -- 148206
   `select get_daily_count();`                -- 365
   `select difficulty, count(*) from puzzles group by 1;`  -- 30000/45000/45000/28206
   `select difficulty from puzzles where position between 1 and 12 order by position;` -- mixed

Note: migration `0010_interleave_daily.sql` is superseded by seed.sql's interleaved
positions; do NOT re-run it against the loaded table.
```

- [ ] **Step 2: Update pipeline docs**

Per the project protocol, update `docs/CHANGELOG.md` (date 2026-07-04, what/why/files), `docs/STATUS.md` (150k is now the online source; daily = 365; legacy 10k removed), `docs/ARCHITECTURE.md` (generators now source 150k; loader replaces library.sql/upload_to_supabase.py), `docs/DECISIONS.md` (all-148k online, hard-reset purge, daily distribution, gentlest-hard pick), and note in `docs/BUGS.md` only if anything broke.

- [ ] **Step 3: Update memory**

Edit `/Users/nitairosenberg/.claude/projects/-Users-nitairosenberg-sudoku-pipeline/memory/sudoku-kaggle-150k-dataset.md` to record: 150k is now the sole online source; daily = 365 (37/146/145/37, interleaved); loader = PostgREST streaming; legacy 10k artifacts deleted. Keep the `MEMORY.md` pointer line current.

- [ ] **Step 4: Full test sweep + commits**

```bash
cd /Users/nitairosenberg/sudoku-pipeline && npm test
```
Expected: all suites pass (engine + dataset-pipeline + the 4 new scripts/tests).

```bash
cd /Users/nitairosenberg/sudoku-pipeline
git add docs README.md && git commit -m "docs: 150k is the sole puzzle source; daily-365; reload runbook"
cd /Users/nitairosenberg/sudoku_next
git add docs && git commit -m "docs: add reload runbook for the 150k online migration"
```

---

## Operator step (NOT agent-run): execute the live reload

The live truncate + 148k load + seed requires the service-role key and mutates the
production DB. It is intentionally out of the automated scope — run
`sudoku_next/docs/RELOAD-RUNBOOK.md` steps 2–5 by hand (or hand the agent the key
and explicitly authorize it). Until this is run, the online DB still holds the old
puzzles; all committed artifacts and tooling are ready.

---

## Self-Review

**Spec coverage:**
- All 148k online → Task 3 (loader) + operator step. ✓
- Daily 365 (37/146/145/37, interleaved, tier-aware pick incl. gentlest-hard) → Task 1. ✓
- Regenerate seed.sql + cold-start → Tasks 1/2/5. ✓
- Hard-reset purge → Task 7 runbook + operator step. ✓
- Delete legacy (both repos) → Task 6. ✓
- Root puzzles.json sample so web/ still builds → Tasks 4/5. ✓
- Leave 0010 in place, superseded → Task 7 runbook note. ✓
- No app/schema changes → nothing in the plan edits app source or migrations. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command shows expected output.

**Type consistency:** Export names (`pickTier`, `interleave`, `selectDaily`, `toSeedSql`, `pickColdStart`, `toColdStartTs`, `toRow`, `batches`, `buildRequest`, `loadAll`, `pickSample`) are used identically in their tasks' tests. seed.sql column list matches migration `0001` (`puzzle, solution, difficulty, techniques, givens, fun_score, er_rating, position`). cold-start file shape matches the existing `ColdStartPuzzle` type and helper exports.
```
