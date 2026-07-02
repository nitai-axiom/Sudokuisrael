# Kaggle-sourced 150k Dataset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generated puzzle source with a difficulty-recalibrated 150,000-puzzle dataset sourced (in-sandbox) from the Kaggle "3M sudoku with ratings" set, validated and re-rated by the existing trusted graders, each record carrying a sequential `id`.

**Architecture:** Reuse the existing two-zone pipeline (`qqwing` + Rust grader + `serate`, all via Docker). New code adds: a sandboxed Kaggle fetch+filter stage that keeps the raw 536 MB CSV off the host, per-tier accept gates without the symmetry requirement, a fair-hard serate band, sequential-id assembly, and a calibration entry point. Pure logic (schema, CSV parse, pre-filter, accept gates, id assignment) is TDD'd with `node --test`; Docker stages are characterized in-container before wiring.

**Tech Stack:** Node 22 (ESM, native `.ts` via `node --test`), TypeScript, Docker (Colima), existing `qqwing-trusted` / `sudoku-jars` images + a new `sudoku-kaggle` image, Rust grader binary.

## Global Constraints

- **Sandbox-only for untrusted data.** The raw `sudoku-3m.csv` MUST NOT be written to the host filesystem. Fetch + unzip live in a Docker **named volume** `kaggle-csv`; filtering runs in a `--network none` container; only the small candidate JSONL and final JSON cross to the host. See spec §4 and memory `untrusted-tools-sandbox-only`.
- **Kaggle token** is passed to the fetch container as runtime env (`KAGGLE_USERNAME`, `KAGGLE_KEY`) — never baked into an image, never committed.
- **Do not modify** `sudoku_10000.json`, existing `TARGETS`, `ER_MIN`/`ER_MAX`, `buildTier`, `buildHardTier`, or `assembleAll`. Add new symbols alongside; the old 10k path must keep working (its 71 tests stay green).
- **Tests:** `node --test` style with `node:test` + `node:assert/strict`, importing `../src/*.ts` with explicit `.ts` extensions. Run all with `npm test`; run one file with `node --test dataset-pipeline/tests/<file>.test.ts`.
- **Output schema** is additive: new fields `id` (number) and `source_id` (number). All existing fields keep their names/types.
- **No symmetry gate** on any Kaggle tier (Kaggle puzzles are asymmetric). Clue floor uses the asymmetric floor (17).
- **Fair-hard band** replaces ER 3.4–5.0 with `HARD_ER_MIN_FAIR`/`HARD_ER_MAX_FAIR` (start 2.8/3.8; final values set by the calibration step, Task 8).
- **Targets:** very_easy 30000, easy 45000, medium 45000, hard 30000 (total 150000).
- Commit after every task. Branch: `feat/kaggle-150k-dataset` (created before Task 1).

---

## File Structure

| File | Responsibility |
|---|---|
| `dataset-pipeline/src/config.ts` (modify) | Add `KAGGLE_TARGETS`, `KAGGLE_PREFILTER`, `HARD_ER_MIN_FAIR/MAX`, `OUTPUT_150K`, `CALIBRATION_N`, Kaggle image/dataset/volume constants. |
| `dataset-pipeline/src/record.ts` (modify) | Add `id`, `source_id` to `PuzzleRecord`; thread `sourceId` through `buildRecord`. |
| `dataset-pipeline/src/kaggle-filter.ts` (create) | Pure: parse one CSV line → `KaggleRow`; `prefilterTier(clues, difficulty)` → tier or null. |
| `dataset-pipeline/src/kaggle-filter-cli.ts` (create) | In-container CLI: stream CSV → apply pre-filter + per-tier oversample quotas → write candidate JSONL. |
| `dataset-pipeline/src/kaggle-source.ts` (create) | Host orchestration: fetch into `kaggle-csv` volume, structural + sha verify, run filter container, load candidate JSONL grouped by tier. |
| `dataset-pipeline/src/kaggle-pipeline.ts` (create) | `acceptKaggleLower`, `acceptKaggleHard` (pure gates), `buildKaggleTier` (finite-candidate build loop with cursor). |
| `dataset-pipeline/src/checkpoint.ts` (modify) | Add `loadCursor`/`saveCursor` (finite-candidate resume). |
| `dataset-pipeline/src/assemble.ts` (modify) | Add `assignIds`, `assembleKaggle`. |
| `dataset-pipeline/bin/run-kaggle.ts` (create) | Entry: `--calibrate`, `--count N`, full run. |
| `dataset-pipeline/sandbox/kaggle.Dockerfile` (create) | Minimal `node:22-alpine` + curl/unzip/coreutils fetch+filter image. |
| `dataset-pipeline/sandbox/build-kaggle.sh` (create) | Build the `sudoku-kaggle` image. |
| `dataset-pipeline/sandbox/kaggle.lock` (create, runtime) | Trust-on-first-use SHA-256 pin of the CSV. |

**Dependency order:** Tasks 1–5 are independent pure units (can be built in parallel). Task 6 needs 1,2,5. Task 7 needs 1,2,3. Task 8 needs 4,6,7. Task 9 (docs) last.

---

### Task 1: Schema — add `id` and `source_id` to the record

**Files:**
- Modify: `dataset-pipeline/src/record.ts`
- Test: `dataset-pipeline/tests/record.test.ts` (extend)

**Interfaces:**
- Produces: `PuzzleRecord` now has `id: number` and `source_id: number | null`. `buildRecord` accepts optional `sourceId?: number | null` (defaults null) and sets `id: 0` (placeholder; final id assigned by `assignIds` in Task 4).

- [ ] **Step 1: Write the failing test** — append to `dataset-pipeline/tests/record.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecord } from '../src/record.ts';

test('buildRecord carries source_id and defaults id to 0', () => {
  const solution = '1'.repeat(81).replace(/./g, (_, i) => String((i % 9) + 1));
  const puzzle = '0'.repeat(56) + solution.slice(56); // 25 givens, asymmetric
  const r = buildRecord({
    puzzle, solution, tier: 'very_easy',
    grade: { techniques: ['naked_single'] }, funScore: 3, now: '2026-07-02T00:00:00Z',
    sourceId: 284123,
  });
  assert.equal(r.source_id, 284123);
  assert.equal(r.id, 0);
  assert.equal(r.difficulty, 'very_easy');
});

test('buildRecord defaults source_id to null when omitted', () => {
  const solution = Array.from({ length: 81 }, (_, i) => String((i % 9) + 1)).join('');
  const puzzle = '0'.repeat(56) + solution.slice(56);
  const r = buildRecord({ puzzle, solution, tier: 'easy', grade: { techniques: ['naked_single'] }, funScore: 2, now: 'x' });
  assert.equal(r.source_id, null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test dataset-pipeline/tests/record.test.ts`
Expected: FAIL (`source_id`/`id` undefined; `buildRecord` has no `sourceId` param).

- [ ] **Step 3: Modify `record.ts`** — update the type and builder:

```ts
export type PuzzleRecord = {
  id: number;
  source_id: number | null;
  puzzle: string;
  solution: string;
  difficulty: Tier;
  techniques: string[];
  givens: number;
  er_rating: number | null;
  fun_score: number | null;
  generated_at: string;
};

export function buildRecord(args: {
  puzzle: string; solution: string; tier: Tier; grade: { techniques: string[] };
  funScore: number | null; erRating?: number | null; now: string; sourceId?: number | null;
}): PuzzleRecord {
  const puzzle = normalizeBlanks(args.puzzle);
  const solution = normalizeBlanks(args.solution);
  return {
    id: 0,
    source_id: args.sourceId ?? null,
    puzzle,
    solution,
    difficulty: args.tier,
    techniques: args.grade.techniques,
    givens: clueCount(puzzle),
    er_rating: args.erRating ?? null,
    fun_score: args.funScore,
    generated_at: args.now,
  };
}
```

Leave `validateRecord` unchanged (it must still accept `id === 0` pre-assembly; id contiguity is checked in Task 4).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test dataset-pipeline/tests/record.test.ts`
Expected: PASS. Then `npm test` — the existing 71 tests must stay green (new fields are additive).

- [ ] **Step 5: Commit**

```bash
git add dataset-pipeline/src/record.ts dataset-pipeline/tests/record.test.ts
git commit -m "feat(dataset): add id + source_id to PuzzleRecord"
```

---

### Task 2: Config — Kaggle targets, pre-filter bands, fair-hard ER, paths

**Files:**
- Modify: `dataset-pipeline/src/config.ts`
- Test: `dataset-pipeline/tests/config.test.ts` (extend)

**Interfaces:**
- Produces: `KAGGLE_TARGETS: Record<Tier, number>`, `KAGGLE_PREFILTER: Record<Tier, PrefilterBand>` where `PrefilterBand = { cluesMin, cluesMax, kdMin, kdMax }`, `HARD_ER_MIN_FAIR`, `HARD_ER_MAX_FAIR`, `OUTPUT_150K`, `CALIBRATION_N`, `KAGGLE_IMAGE`, `KAGGLE_DATASET`, `KAGGLE_CSV_NAME`, `KAGGLE_VOLUME`.

- [ ] **Step 1: Write the failing test** — append to `dataset-pipeline/tests/config.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KAGGLE_TARGETS, KAGGLE_PREFILTER, HARD_ER_MIN_FAIR, HARD_ER_MAX_FAIR } from '../src/config.ts';

test('Kaggle targets sum to 150000', () => {
  const sum = Object.values(KAGGLE_TARGETS).reduce((a, b) => a + b, 0);
  assert.equal(sum, 150000);
});

test('fair-hard band excludes the obscure-technique zone', () => {
  assert.ok(HARD_ER_MIN_FAIR < HARD_ER_MAX_FAIR);
  assert.ok(HARD_ER_MAX_FAIR <= 4.0); // stays below the chains/coloring zone
});

test('every tier has a pre-filter band with sane bounds', () => {
  for (const band of Object.values(KAGGLE_PREFILTER)) {
    assert.ok(band.cluesMin <= band.cluesMax);
    assert.ok(band.kdMin <= band.kdMax);
    assert.ok(band.cluesMin >= 19 && band.cluesMax <= 31); // dataset clue range
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test dataset-pipeline/tests/config.test.ts`
Expected: FAIL (exports missing).

- [ ] **Step 3: Add to `config.ts`** (after the existing exports; do NOT touch `TARGETS`, `ER_MIN`, `ER_MAX`):

```ts
// ── Kaggle-sourced 150k dataset ─────────────────────────────────────────────
export const KAGGLE_TARGETS: Record<Tier, number> = {
  very_easy: 30000,
  easy: 45000,
  medium: 45000,
  hard: 30000,
};

export type PrefilterBand = { cluesMin: number; cluesMax: number; kdMin: number; kdMax: number };

// Coarse pre-filter on Kaggle's own columns. Priority order = TIERS order:
// prefilterTier() returns the FIRST matching tier, so overlapping bands are fine.
// Starting points — confirmed/tuned by the calibration step (bin/run-kaggle.ts --calibrate).
export const KAGGLE_PREFILTER: Record<Tier, PrefilterBand> = {
  very_easy: { cluesMin: 25, cluesMax: 26, kdMin: 0,   kdMax: 0   },
  easy:      { cluesMin: 24, cluesMax: 26, kdMin: 0,   kdMax: 1.0 },
  medium:    { cluesMin: 23, cluesMax: 25, kdMin: 1.0, kdMax: 3.0 },
  hard:      { cluesMin: 22, cluesMax: 25, kdMin: 3.0, kdMax: 5.5 },
};

// Fair-hard serate ER band (replaces ER_MIN/ER_MAX for the Kaggle hard tier).
// Excludes the ~4.2+ chains/coloring zone. Final values set by calibration.
export const HARD_ER_MIN_FAIR = 2.8;
export const HARD_ER_MAX_FAIR = 3.8;

export const OUTPUT_150K = path.join(REPO_ROOT, 'sudoku_150000.json');
export const CALIBRATION_N = 500; // candidates per tier sampled by --calibrate

// Kaggle fetch (in-sandbox)
export const KAGGLE_IMAGE = 'sudoku-kaggle';
export const KAGGLE_DATASET = 'radcliffe/3-million-sudoku-puzzles-with-ratings';
export const KAGGLE_CSV_NAME = 'sudoku-3m.csv';
export const KAGGLE_VOLUME = 'kaggle-csv';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test dataset-pipeline/tests/config.test.ts` → PASS. Then `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add dataset-pipeline/src/config.ts dataset-pipeline/tests/config.test.ts
git commit -m "feat(dataset): Kaggle 150k targets, pre-filter bands, fair-hard ER"
```

---

### Task 3: CSV parse + pre-filter bucketing (pure)

**Files:**
- Create: `dataset-pipeline/src/kaggle-filter.ts`
- Test: `dataset-pipeline/tests/kaggle-filter.test.ts`

**Interfaces:**
- Consumes: `KAGGLE_PREFILTER`, `TIERS`, `type Tier` from config; `normalizeBlanks` from grid.
- Produces:
  - `type KaggleRow = { sourceId: number; puzzle: string; clues: number; difficulty: number }`
  - `parseKaggleLine(line: string): KaggleRow | null` — returns null for the header row and malformed lines.
  - `prefilterTier(clues: number, difficulty: number): Tier | null` — first matching tier in `TIERS` order, else null.

- [ ] **Step 1: Write the failing test** — `dataset-pipeline/tests/kaggle-filter.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKaggleLine, prefilterTier } from '../src/kaggle-filter.ts';

const HEADER = 'id,puzzle,solution,clues,difficulty';
// 25-clue-ish puzzle: 56 dots then 25 digits; solution is a valid-length 81-digit filler.
const PUZ = '.'.repeat(56) + '1234567891234567891234567';
const SOL = Array.from({ length: 81 }, (_, i) => String((i % 9) + 1)).join('');

test('parseKaggleLine skips the header', () => {
  assert.equal(parseKaggleLine(HEADER), null);
});

test('parseKaggleLine parses a data row and normalizes blanks to 0', () => {
  const row = parseKaggleLine(`284123,${PUZ},${SOL},25,0.0`);
  assert.ok(row);
  assert.equal(row!.sourceId, 284123);
  assert.equal(row!.clues, 25);
  assert.equal(row!.difficulty, 0.0);
  assert.match(row!.puzzle, /^[0-9]{81}$/); // dots became zeros
});

test('parseKaggleLine returns null on malformed rows', () => {
  assert.equal(parseKaggleLine('not,enough'), null);
  assert.equal(parseKaggleLine(`1,${PUZ},${SOL},notanumber,0.0`), null);
});

test('prefilterTier assigns very_easy for diff 0 with 25-26 clues', () => {
  assert.equal(prefilterTier(25, 0), 'very_easy');
  assert.equal(prefilterTier(26, 0), 'very_easy');
});

test('prefilterTier priority: 24-clue diff-0 falls to easy (not very_easy)', () => {
  assert.equal(prefilterTier(24, 0), 'easy');
});

test('prefilterTier assigns medium and hard by difficulty', () => {
  assert.equal(prefilterTier(24, 2.0), 'medium');
  assert.equal(prefilterTier(23, 4.5), 'hard');
});

test('prefilterTier returns null outside all bands', () => {
  assert.equal(prefilterTier(31, 8.5), null); // too many clues / too hard
  assert.equal(prefilterTier(20, 0.5), null); // clues below every band
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test dataset-pipeline/tests/kaggle-filter.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `dataset-pipeline/src/kaggle-filter.ts`:**

```ts
import { KAGGLE_PREFILTER, TIERS, type Tier } from './config.ts';
import { normalizeBlanks } from './grid.ts';

export type KaggleRow = { sourceId: number; puzzle: string; clues: number; difficulty: number };

// Columns: id,puzzle,solution,clues,difficulty. Puzzle/solution are digits+dots (no commas),
// so a plain split is safe for this dataset.
export function parseKaggleLine(line: string): KaggleRow | null {
  const t = line.trim();
  if (t.length === 0) return null;
  if (t.startsWith('id,')) return null; // header
  const parts = t.split(',');
  if (parts.length !== 5) return null;
  const sourceId = Number(parts[0]);
  const clues = Number(parts[3]);
  const difficulty = Number(parts[4]);
  if (!Number.isFinite(sourceId) || !Number.isFinite(clues) || !Number.isFinite(difficulty)) return null;
  let puzzle: string;
  try {
    puzzle = normalizeBlanks(parts[1]); // '.'→'0', asserts 81 chars
  } catch {
    return null;
  }
  return { sourceId, puzzle, clues, difficulty };
}

export function prefilterTier(clues: number, difficulty: number): Tier | null {
  for (const tier of TIERS) {
    const b = KAGGLE_PREFILTER[tier];
    if (clues >= b.cluesMin && clues <= b.cluesMax && difficulty >= b.kdMin && difficulty <= b.kdMax) {
      return tier;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test dataset-pipeline/tests/kaggle-filter.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add dataset-pipeline/src/kaggle-filter.ts dataset-pipeline/tests/kaggle-filter.test.ts
git commit -m "feat(dataset): Kaggle CSV parser + tier pre-filter"
```

---

### Task 4: `assignIds` + `assembleKaggle` scaffold

**Files:**
- Modify: `dataset-pipeline/src/assemble.ts`
- Test: `dataset-pipeline/tests/assemble.test.ts` (extend)

**Interfaces:**
- Consumes: `sortRecords` (existing), `PuzzleRecord`, `KAGGLE_TARGETS`, `OUTPUT_150K`.
- Produces:
  - `assignIds(rows: PuzzleRecord[]): PuzzleRecord[]` — returns rows sorted (via `sortRecords`) with `id` set to `1..N` contiguously.
  - `assembleKaggle(candidatesByTier, opts?)` — added in Task 8 (declared here as a stub is NOT needed; implement fully in Task 8). This task implements only `assignIds`.

- [ ] **Step 1: Write the failing test** — append to `dataset-pipeline/tests/assemble.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignIds } from '../src/assemble.ts';
import type { PuzzleRecord } from '../src/record.ts';

function rec(difficulty: PuzzleRecord['difficulty'], givens: number): PuzzleRecord {
  return {
    id: 0, source_id: null, puzzle: '0'.repeat(81 - givens) + '1'.repeat(givens),
    solution: Array.from({ length: 81 }, (_, i) => String((i % 9) + 1)).join(''),
    difficulty, techniques: ['naked_single'], givens, er_rating: null, fun_score: 1,
    generated_at: 'x',
  };
}

test('assignIds numbers rows 1..N contiguously in sorted (tier) order', () => {
  const rows = [rec('hard', 22), rec('very_easy', 26), rec('easy', 24)];
  const out = assignIds(rows);
  assert.deepEqual(out.map((r) => r.id), [1, 2, 3]);
  assert.deepEqual(out.map((r) => r.difficulty), ['very_easy', 'easy', 'hard']); // sortRecords order
  assert.equal(out[out.length - 1].id, out.length);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test dataset-pipeline/tests/assemble.test.ts`
Expected: FAIL (`assignIds` not exported).

- [ ] **Step 3: Add `assignIds` to `assemble.ts`** (import `OUTPUT_150K` too for Task 8; add near `sortRecords`):

```ts
export function assignIds(rows: PuzzleRecord[]): PuzzleRecord[] {
  return sortRecords(rows).map((r, i) => ({ ...r, id: i + 1 }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test dataset-pipeline/tests/assemble.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add dataset-pipeline/src/assemble.ts dataset-pipeline/tests/assemble.test.ts
git commit -m "feat(dataset): assignIds — sequential ids at assembly"
```

---

### Task 5: Accept gates — `acceptKaggleLower` + `acceptKaggleHard`

**Files:**
- Create: `dataset-pipeline/src/kaggle-pipeline.ts` (gates only in this task; build loop in Task 6)
- Test: `dataset-pipeline/tests/kaggle-pipeline.test.ts`

**Interfaces:**
- Consumes: `SolveResult` (qqwing), `Grade` (grader), `EXPECTED_GRADE`, `HARD_ER_MIN_FAIR/MAX`, `passesClueFloor`, `funScore`, `buildRecord`, `validateRecord`, `dedupeByPuzzle`.
- Produces:
  - `acceptKaggleLower(args: { tier: LowerTier; solve: SolveResult; grade: Grade; sourceId: number; now: string }): PuzzleRecord | null`
  - `acceptKaggleHard(args: { solve: SolveResult; er: number | null; grade: Grade; sourceId: number; now: string }): PuzzleRecord | null`

- [ ] **Step 1: Write the failing test** — `dataset-pipeline/tests/kaggle-pipeline.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptKaggleLower, acceptKaggleHard } from '../src/kaggle-pipeline.ts';
import type { SolveResult } from '../src/qqwing.ts';
import type { Grade } from '../src/grader.ts';

const SOL = Array.from({ length: 81 }, (_, i) => String((i % 9) + 1)).join('');
const PUZ = '0'.repeat(56) + SOL.slice(56); // 25 givens, asymmetric
const uniqueSolve: SolveResult = { puzzle: PUZ, solution: SOL, solutionCount: 1 };
const easyGrade: Grade = { solvable: true, difficulty: 'easy', techniques: ['naked_single'] };
const mediumGrade: Grade = { solvable: true, difficulty: 'medium', techniques: ['naked_pair'] };

test('lower: accepts a unique, correctly-graded puzzle and carries source_id', () => {
  const r = acceptKaggleLower({ tier: 'very_easy', solve: uniqueSolve, grade: easyGrade, sourceId: 7, now: 'x' });
  assert.ok(r);
  assert.equal(r!.difficulty, 'very_easy');
  assert.equal(r!.source_id, 7);
});

test('lower: rejects non-unique solutions', () => {
  const solve: SolveResult = { puzzle: PUZ, solution: null, solutionCount: 2 };
  assert.equal(acceptKaggleLower({ tier: 'easy', solve, grade: easyGrade, sourceId: 1, now: 'x' }), null);
});

test('lower: rejects grade mismatch (medium graded into easy tier)', () => {
  assert.equal(acceptKaggleLower({ tier: 'easy', solve: uniqueSolve, grade: mediumGrade, sourceId: 1, now: 'x' }), null);
});

test('lower: rejects unsolvable (needs guessing)', () => {
  const g: Grade = { solvable: false, difficulty: null, techniques: [] };
  assert.equal(acceptKaggleLower({ tier: 'easy', solve: uniqueSolve, grade: g, sourceId: 1, now: 'x' }), null);
});

test('hard: accepts inside the fair band with a logic-solvable grade', () => {
  const r = acceptKaggleHard({ solve: uniqueSolve, er: 3.2, grade: { solvable: true, difficulty: 'hard', techniques: ['x_wing'] }, sourceId: 9, now: 'x' });
  assert.ok(r);
  assert.equal(r!.difficulty, 'hard');
  assert.equal(r!.er_rating, 3.2);
  assert.equal(r!.source_id, 9);
});

test('hard: rejects ER above the fair ceiling (obscure-technique zone)', () => {
  assert.equal(acceptKaggleHard({ solve: uniqueSolve, er: 4.6, grade: { solvable: true, difficulty: 'hard', techniques: ['coloring'] }, sourceId: 1, now: 'x' }), null);
});

test('hard: rejects when grader says it needs guessing', () => {
  assert.equal(acceptKaggleHard({ solve: uniqueSolve, er: 3.2, grade: { solvable: false, difficulty: null, techniques: [] }, sourceId: 1, now: 'x' }), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test dataset-pipeline/tests/kaggle-pipeline.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement gates in `dataset-pipeline/src/kaggle-pipeline.ts`:**

```ts
import { EXPECTED_GRADE, HARD_ER_MIN_FAIR, HARD_ER_MAX_FAIR, type LowerTier } from './config.ts';
import { passesClueFloor } from './grid.ts';
import type { SolveResult } from './qqwing.ts';
import type { Grade } from './grader.ts';
import { funScore } from './funscore.ts';
import { buildRecord, validateRecord, type PuzzleRecord } from './record.ts';

/** Lower-tier accept gate (symmetry removed vs the qqwing pipeline). */
export function acceptKaggleLower(args: {
  tier: LowerTier; solve: SolveResult; grade: Grade; sourceId: number; now: string;
}): PuzzleRecord | null {
  const { tier, solve, grade, sourceId, now } = args;
  if (solve.solutionCount !== 1 || !solve.solution) return null;   // trusted uniqueness
  if (!passesClueFloor(solve.puzzle, false)) return null;          // asymmetric floor (17)
  const score = funScore(grade);                                   // null ⇒ needs guessing
  if (score === null) return null;
  if (grade.difficulty !== EXPECTED_GRADE[tier]) return null;      // real difficulty
  const record = buildRecord({ puzzle: solve.puzzle, solution: solve.solution, tier, grade, funScore: score, now, sourceId });
  if (validateRecord(record).length > 0) return null;
  return record;
}

/** Hard accept gate: fair serate band + pure-logic (no guessing). */
export function acceptKaggleHard(args: {
  solve: SolveResult; er: number | null; grade: Grade; sourceId: number; now: string;
}): PuzzleRecord | null {
  const { solve, er, grade, sourceId, now } = args;
  if (solve.solutionCount !== 1 || !solve.solution) return null;
  if (er === null || er < HARD_ER_MIN_FAIR || er > HARD_ER_MAX_FAIR) return null;
  if (!grade.solvable) return null;                                // no guessing
  if (!passesClueFloor(solve.puzzle, false)) return null;
  const tech = grade.techniques.length > 0 ? grade.techniques : ['x_wing'];
  const record = buildRecord({
    puzzle: solve.puzzle, solution: solve.solution, tier: 'hard',
    grade: { techniques: tech }, funScore: null, erRating: er, now, sourceId,
  });
  if (validateRecord(record).length > 0) return null;
  return record;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test dataset-pipeline/tests/kaggle-pipeline.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add dataset-pipeline/src/kaggle-pipeline.ts dataset-pipeline/tests/kaggle-pipeline.test.ts
git commit -m "feat(dataset): Kaggle accept gates (no symmetry, fair-hard band)"
```

---

### Task 6: Build loop `buildKaggleTier` + cursor resume

**Files:**
- Modify: `dataset-pipeline/src/checkpoint.ts` (add cursor)
- Modify: `dataset-pipeline/src/kaggle-pipeline.ts` (add `buildKaggleTier`, `type Candidate`)
- Test: `dataset-pipeline/tests/kaggle-pipeline.test.ts` (extend, with injected fakes — no Docker)

**Interfaces:**
- Consumes: `loadCheckpoint`/`appendCheckpoint` (existing), new `loadCursor`/`saveCursor`, `solveAndCount`/`gradeBatch`/`rate` types, `KAGGLE_TARGETS`, `BATCH_SIZE`, `dedupeByPuzzle`.
- Produces:
  - `type Candidate = { sourceId: number; puzzle: string }`
  - `buildKaggleTier(tier: Tier, candidates: Candidate[], opts?: { target?; now?; solveAndCount?; gradeBatch?; rate? }): Promise<PuzzleRecord[]>`
  - `checkpoint.ts`: `loadCursor(tier: Tier): number`, `saveCursor(tier: Tier, n: number): void`

- [ ] **Step 1: Write cursor test** — append to `dataset-pipeline/tests/checkpoint.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadCursor, saveCursor, cursorPath } from '../src/checkpoint.ts';

test('cursor defaults to 0 when absent, then round-trips', () => {
  fs.rmSync(cursorPath('medium'), { force: true });
  assert.equal(loadCursor('medium'), 0);   // absent → 0
  saveCursor('medium', 512);
  assert.equal(loadCursor('medium'), 512);  // round-trips
  fs.rmSync(cursorPath('medium'), { force: true }); // reset so other tests are unaffected
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test dataset-pipeline/tests/checkpoint.test.ts`
Expected: FAIL (`loadCursor`/`saveCursor` not exported).

- [ ] **Step 3: Add cursor helpers to `checkpoint.ts`:**

```ts
export function cursorPath(tier: Tier): string {
  return path.join(CHECKPOINT_DIR, `${tier}.cursor`);
}

export function loadCursor(tier: Tier): number {
  const p = cursorPath(tier);
  if (!fs.existsSync(p)) return 0;
  const n = Number(fs.readFileSync(p, 'utf8').trim());
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export function saveCursor(tier: Tier, n: number): void {
  fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
  fs.writeFileSync(cursorPath(tier), String(n));
}
```

- [ ] **Step 4: Write the build-loop test** — append to `dataset-pipeline/tests/kaggle-pipeline.test.ts`. These write to the real `CHECKPOINT_DIR` for `medium`, so each test clears the checkpoint + cursor before and after (mirrors `hard-pipeline.test.ts`):

```ts
import fs from 'node:fs';
import { buildKaggleTier, type Candidate } from '../src/kaggle-pipeline.ts';
import { checkpointPath, cursorPath } from '../src/checkpoint.ts';
import type { SolveResult } from '../src/qqwing.ts';
import type { Grade } from '../src/grader.ts';

const SOLc = Array.from({ length: 81 }, (_, i) => String((i % 9) + 1)).join('');
function puz(n: number) { return String(n % 10).repeat(56) + SOLc.slice(56); } // 81 chars, distinct per n (0-9)
function cleanMedium() { fs.rmSync(checkpointPath('medium'), { force: true }); fs.rmSync(cursorPath('medium'), { force: true }); }
const fakeSolve = async (ps: string[]): Promise<SolveResult[]> => ps.map((p) => ({ puzzle: p, solution: SOLc, solutionCount: 1 }));
const fakeGrade = async (ps: string[]): Promise<Grade[]> => ps.map(() => ({ solvable: true, difficulty: 'medium', techniques: ['naked_pair'] }));

test('buildKaggleTier collects target survivors from finite candidates (medium, injected fakes)', async () => {
  cleanMedium();
  const cands: Candidate[] = Array.from({ length: 10 }, (_, i) => ({ sourceId: i, puzzle: puz(i) }));
  const rows = await buildKaggleTier('medium', cands, { target: 3, now: () => 'x', solveAndCount: fakeSolve, gradeBatch: fakeGrade });
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.difficulty === 'medium'));
  cleanMedium();
});

test('buildKaggleTier stops when candidates run out (returns < target, no throw)', async () => {
  cleanMedium();
  const cands: Candidate[] = [{ sourceId: 0, puzzle: puz(0) }];
  const rows = await buildKaggleTier('medium', cands, { target: 100, now: () => 'x', solveAndCount: fakeSolve, gradeBatch: fakeGrade });
  assert.ok(rows.length <= 1);
  cleanMedium();
});
```

- [ ] **Step 5: Implement `buildKaggleTier` in `kaggle-pipeline.ts`:**

```ts
import { KAGGLE_TARGETS, BATCH_SIZE, type Tier } from './config.ts';
import { solveAndCount as realSolve, type SolveResult } from './qqwing.ts';
import { gradeBatch as realGrade, type Grade } from './grader.ts';
import { rate as realRate, type Rating } from './serate.ts';
import { loadCheckpoint, appendCheckpoint, loadCursor, saveCursor } from './checkpoint.ts';
import { dedupeByPuzzle } from './dedupe.ts';

export type Candidate = { sourceId: number; puzzle: string };

export async function buildKaggleTier(tier: Tier, candidates: Candidate[], opts?: {
  target?: number; now?: () => string;
  solveAndCount?: typeof realSolve; gradeBatch?: typeof realGrade; rate?: typeof realRate;
}): Promise<PuzzleRecord[]> {
  const target = opts?.target ?? KAGGLE_TARGETS[tier];
  const now = opts?.now ?? (() => new Date().toISOString());
  const solve = opts?.solveAndCount ?? realSolve;
  const grade = opts?.gradeBatch ?? realGrade;
  const rateF = opts?.rate ?? realRate;

  let survivors = loadCheckpoint(tier);
  let cursor = loadCursor(tier);

  while (survivors.length < target && cursor < candidates.length) {
    const batch = candidates.slice(cursor, cursor + BATCH_SIZE);
    const puzzles = batch.map((c) => c.puzzle);

    const solves = await solve(puzzles);
    const grades = await grade(puzzles);
    const ratings: Rating[] = tier === 'hard' ? await rateF(puzzles) : puzzles.map((p) => ({ puzzle: p, er: null }));
    if (solves.length !== puzzles.length || grades.length !== puzzles.length || ratings.length !== puzzles.length) {
      throw new Error(`wrapper length mismatch in ${tier}`);
    }

    const accepted: PuzzleRecord[] = [];
    for (let i = 0; i < puzzles.length; i++) {
      const r = tier === 'hard'
        ? acceptKaggleHard({ solve: solves[i], er: ratings[i]?.er ?? null, grade: grades[i], sourceId: batch[i].sourceId, now: now() })
        : acceptKaggleLower({ tier: tier as LowerTier, solve: solves[i], grade: grades[i], sourceId: batch[i].sourceId, now: now() });
      if (r) accepted.push(r);
    }

    const fresh = dedupeByPuzzle([...survivors, ...accepted]).slice(survivors.length);
    appendCheckpoint(tier, fresh);
    survivors = survivors.concat(fresh);
    cursor += batch.length;
    saveCursor(tier, cursor);
    process.stderr.write(`\r  ${tier}: ${survivors.length}/${target} (consumed ${cursor}/${candidates.length})`);
  }
  process.stderr.write('\n');
  if (survivors.length < target) {
    process.stderr.write(`  WARN ${tier}: ran out of candidates at ${survivors.length}/${target} — raise oversample factor\n`);
  }
  return survivors.slice(0, target);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test dataset-pipeline/tests/kaggle-pipeline.test.ts dataset-pipeline/tests/checkpoint.test.ts` → PASS. Then `npm test` → all green.

- [ ] **Step 7: Commit**

```bash
git add dataset-pipeline/src/checkpoint.ts dataset-pipeline/src/kaggle-pipeline.ts dataset-pipeline/tests/kaggle-pipeline.test.ts dataset-pipeline/tests/checkpoint.test.ts
git commit -m "feat(dataset): buildKaggleTier finite-candidate loop with cursor resume"
```

---

### Task 7: Sandboxed fetch + filter (Docker)

**Files:**
- Create: `dataset-pipeline/sandbox/kaggle.Dockerfile`
- Create: `dataset-pipeline/sandbox/build-kaggle.sh`
- Create: `dataset-pipeline/src/kaggle-filter-cli.ts` (in-container entry)
- Create: `dataset-pipeline/src/kaggle-source.ts` (host orchestration)
- Test: `dataset-pipeline/tests/kaggle-filter-cli.test.ts` (fixture CSV, no Docker) + manual sandbox steps

**Interfaces:**
- Consumes: `parseKaggleLine`, `prefilterTier` (Task 3); `KAGGLE_*` config; `runContainer` (docker.ts).
- Produces:
  - `kaggle-filter-cli.ts`: reads `--in <csv> --out <jsonl> --oversample <factor>`, emits JSONL lines `{"tier","sourceId","puzzle"}`, capped per tier at `ceil(KAGGLE_TARGETS[tier] * factor)`.
  - `kaggle-source.ts`: `fetchKaggleCsv(): Promise<void>` (into `KAGGLE_VOLUME`, verify), `runFilter(oversample: number): Promise<void>`, `loadCandidates(): Record<Tier, Candidate[]>`.

- [ ] **Step 1 (characterize — do NOT guess):** Confirm the Kaggle download mechanism *inside the container* before wiring, exactly as HoDoKu/serate were characterized. Build a scratch image and probe:

```bash
cd dataset-pipeline
cat > sandbox/kaggle.Dockerfile <<'DOCKER'
FROM node:22-alpine
RUN apk add --no-cache curl unzip coreutils
WORKDIR /work
DOCKER
docker build -f sandbox/kaggle.Dockerfile -t sudoku-kaggle sandbox/
# Probe download (token from your shell env; nothing written to host):
docker run --rm -e KAGGLE_USERNAME -e KAGGLE_KEY -v kaggle-csv:/data sudoku-kaggle sh -c '
  set -e
  curl -L --fail -u "$KAGGLE_USERNAME:$KAGGLE_KEY" \
    -o /data/ds.zip "https://www.kaggle.com/api/v1/datasets/download/radcliffe/3-million-sudoku-puzzles-with-ratings"
  unzip -l /data/ds.zip           # <-- confirm the CSV entry name
'
```

Record the real archive entry name (expected `sudoku-3m.csv`), confirm `curl -u` auth works (else switch to header `-H "Authorization: Bearer ..."` per Kaggle API), and capture the CSV `sha256sum`. Write the sha to `sandbox/kaggle.lock` as `<sha256>  sudoku-3m.csv`. **If auth/URL differs from the above, update the fetch command in Step 4 to match what actually worked.**

- [ ] **Step 2: Write the CLI test** — `dataset-pipeline/tests/kaggle-filter-cli.test.ts` (drives the pure filter over an in-memory fixture; the CLI's file I/O is a thin wrapper around `filterLines`):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterLines } from '../src/kaggle-filter-cli.ts';

const SOL = Array.from({ length: 81 }, (_, i) => String((i % 9) + 1)).join('');
const P25 = '.'.repeat(56) + '1234567891234567891234567';
const rows = [
  'id,puzzle,solution,clues,difficulty',
  `1,${P25},${SOL},25,0.0`,   // very_easy
  `2,${P25},${SOL},25,0.0`,   // very_easy (2nd) — capped test
  `3,${P25},${SOL},24,0.5`,   // easy
];

test('filterLines buckets rows and respects per-tier caps', () => {
  const caps = { very_easy: 1, easy: 10, medium: 10, hard: 10 };
  const out = filterLines(rows, caps);
  const veryEasy = out.filter((o) => o.tier === 'very_easy');
  assert.equal(veryEasy.length, 1);            // capped at 1 despite 2 candidates
  assert.ok(out.some((o) => o.tier === 'easy'));
});
```

- [ ] **Step 3: Implement `dataset-pipeline/src/kaggle-filter-cli.ts`:**

```ts
import fs from 'node:fs';
import readline from 'node:readline';
import { KAGGLE_TARGETS, TIERS, type Tier } from './config.ts';
import { parseKaggleLine, prefilterTier } from './kaggle-filter.ts';

export type CandidateOut = { tier: Tier; sourceId: number; puzzle: string };

/** Pure core: bucket lines into tiers up to per-tier caps. */
export function filterLines(lines: Iterable<string>, caps: Record<Tier, number>): CandidateOut[] {
  const counts: Record<string, number> = { very_easy: 0, easy: 0, medium: 0, hard: 0 };
  const out: CandidateOut[] = [];
  for (const line of lines) {
    const row = parseKaggleLine(line);
    if (!row) continue;
    const tier = prefilterTier(row.clues, row.difficulty);
    if (!tier) continue;
    if (counts[tier] >= caps[tier]) continue;
    counts[tier]++;
    out.push({ tier, sourceId: row.sourceId, puzzle: row.puzzle });
    if (TIERS.every((t) => counts[t] >= caps[t])) break; // all tiers full → stop early
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const inPath = argv[argv.indexOf('--in') + 1];
  const outPath = argv[argv.indexOf('--out') + 1];
  const factor = Number(argv[argv.indexOf('--oversample') + 1]) || 3;
  const caps = Object.fromEntries(TIERS.map((t) => [t, Math.ceil(KAGGLE_TARGETS[t] * factor)])) as Record<Tier, number>;

  const rl = readline.createInterface({ input: fs.createReadStream(inPath), crlfDelay: Infinity });
  const counts: Record<string, number> = { very_easy: 0, easy: 0, medium: 0, hard: 0 };
  const ws = fs.createWriteStream(outPath);
  for await (const line of rl) {
    const [c] = filterLines([line], { very_easy: caps.very_easy - counts.very_easy, easy: caps.easy - counts.easy, medium: caps.medium - counts.medium, hard: caps.hard - counts.hard });
    if (c) { counts[c.tier]++; ws.write(JSON.stringify(c) + '\n'); }
    if (TIERS.every((t) => counts[t] >= caps[t])) break;
  }
  ws.end();
  process.stderr.write(`filter done: ${JSON.stringify(counts)}\n`);
}

if (import.meta.filename === process.argv[1] || process.argv[1]?.endsWith('kaggle-filter-cli.ts')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 4: Implement `dataset-pipeline/src/kaggle-source.ts`** (host orchestration; the raw CSV never leaves the volume):

```ts
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { KAGGLE_IMAGE, KAGGLE_VOLUME, KAGGLE_CSV_NAME, WORK_DIR, type Tier } from './config.ts';
import type { Candidate } from './kaggle-pipeline.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const SRC_DIR = path.join(REPO_ROOT, 'dataset-pipeline', 'src');
const CANDIDATES_PATH = path.join(WORK_DIR, 'kaggle-candidates.jsonl');

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit' });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

/** Download + unzip the CSV into the kaggle-csv volume (network on), then verify structure + sha. */
export async function fetchKaggleCsv(): Promise<void> {
  const user = process.env.KAGGLE_USERNAME, key = process.env.KAGGLE_KEY;
  if (!user || !key) throw new Error('set KAGGLE_USERNAME and KAGGLE_KEY in the environment');
  // Fetch (uses the exact command confirmed in Task 7 Step 1).
  await run('docker', ['run', '--rm', '-e', 'KAGGLE_USERNAME', '-e', 'KAGGLE_KEY',
    '-v', `${KAGGLE_VOLUME}:/data`, KAGGLE_IMAGE, 'sh', '-c',
    `set -e; curl -L --fail -u "$KAGGLE_USERNAME:$KAGGLE_KEY" -o /data/ds.zip ` +
    `"https://www.kaggle.com/api/v1/datasets/download/radcliffe/3-million-sudoku-puzzles-with-ratings"; ` +
    `unzip -o /data/ds.zip -d /data; rm -f /data/ds.zip; ` +
    `sha256sum /data/${KAGGLE_CSV_NAME}; ` +
    `head -1 /data/${KAGGLE_CSV_NAME}; wc -l /data/${KAGGLE_CSV_NAME}`]);
  // Structural verify (network none): header must be the 5 expected columns; ~3M rows.
  await run('docker', ['run', '--rm', '--network', 'none', '-v', `${KAGGLE_VOLUME}:/data:ro`, KAGGLE_IMAGE,
    'sh', '-c', `head -1 /data/${KAGGLE_CSV_NAME} | grep -qx 'id,puzzle,solution,clues,difficulty'`]);
}

/** Run the pure filter inside a --network none container; only candidate JSONL crosses to host. */
export async function runFilter(oversample = 3): Promise<void> {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  await run('docker', ['run', '--rm', '--network', 'none',
    '-v', `${KAGGLE_VOLUME}:/data:ro`, '-v', `${SRC_DIR}:/src:ro`, '-v', `${WORK_DIR}:/out`,
    KAGGLE_IMAGE, 'node', '/src/kaggle-filter-cli.ts',
    '--in', `/data/${KAGGLE_CSV_NAME}`, '--out', '/out/kaggle-candidates.jsonl', '--oversample', String(oversample)]);
}

/** Load the candidate JSONL from the host WORK_DIR, grouped by tier. */
export async function loadCandidates(): Promise<Record<Tier, Candidate[]>> {
  const byTier: Record<Tier, Candidate[]> = { very_easy: [], easy: [], medium: [], hard: [] };
  const rl = readline.createInterface({ input: fs.createReadStream(CANDIDATES_PATH), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const o = JSON.parse(line) as { tier: Tier; sourceId: number; puzzle: string };
    byTier[o.tier].push({ sourceId: o.sourceId, puzzle: o.puzzle });
  }
  return byTier;
}
```

- [ ] **Step 5: Write `sandbox/build-kaggle.sh`** (mirror `build-qqwing.sh` style):

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
docker build -f kaggle.Dockerfile -t sudoku-kaggle .
echo "built sudoku-kaggle"
```

Then `chmod +x sandbox/build-kaggle.sh`.

- [ ] **Step 6: Run the CLI unit test + a real filter smoke test**

```bash
node --test dataset-pipeline/tests/kaggle-filter-cli.test.ts   # PASS (pure)
bash dataset-pipeline/sandbox/build-kaggle.sh
KAGGLE_USERNAME=... KAGGLE_KEY=... node -e "import('./dataset-pipeline/src/kaggle-source.ts').then(m=>m.fetchKaggleCsv())"
node -e "import('./dataset-pipeline/src/kaggle-source.ts').then(m=>m.runFilter(3))"
wc -l dataset-pipeline/.work/kaggle-candidates.jsonl   # expect ~ sum(ceil(target*3)) capped lines
```

Expected: candidate JSONL exists with per-tier counts near the oversample caps; the 536 MB CSV exists only inside the `kaggle-csv` volume (`docker run --rm -v kaggle-csv:/data alpine ls -la /data`), never in the repo.

- [ ] **Step 7: Commit**

```bash
git add dataset-pipeline/sandbox/kaggle.Dockerfile dataset-pipeline/sandbox/build-kaggle.sh dataset-pipeline/sandbox/kaggle.lock \
        dataset-pipeline/src/kaggle-filter-cli.ts dataset-pipeline/src/kaggle-source.ts dataset-pipeline/tests/kaggle-filter-cli.test.ts
git commit -m "feat(dataset): sandboxed Kaggle fetch + filter (CSV stays in volume)"
```

---

### Task 8: Entry point — calibration + full assembly

**Files:**
- Modify: `dataset-pipeline/src/assemble.ts` (add `assembleKaggle`)
- Create: `dataset-pipeline/bin/run-kaggle.ts`
- Test: manual (calibration report) + a small `--count` smoke run

**Interfaces:**
- Consumes: `loadCandidates` (Task 7), `buildKaggleTier` (Task 6), `assignIds` (Task 4), `OUTPUT_150K`, `CALIBRATION_N`, `HARD_ER_MIN_FAIR/MAX`, `rate`, `gradeBatch`, `solveAndCount`.
- Produces: `assembleKaggle(opts?: { target?: number; now?: () => string }): Promise<PuzzleRecord[]>` (writes `OUTPUT_150K`); `bin/run-kaggle.ts` CLI with `--calibrate`, `--count N`.

- [ ] **Step 1: Implement `assembleKaggle` in `assemble.ts`:**

```ts
import { KAGGLE_TARGETS, OUTPUT_150K, TIERS } from './config.ts';
import { buildKaggleTier } from './kaggle-pipeline.ts';
import { loadCandidates } from './kaggle-source.ts';

export async function assembleKaggle(opts?: { target?: number; now?: () => string }): Promise<PuzzleRecord[]> {
  const candidates = await loadCandidates();
  const all: PuzzleRecord[] = [];
  for (const tier of TIERS) {
    const rows = await buildKaggleTier(tier, candidates[tier], { target: opts?.target ?? KAGGLE_TARGETS[tier], now: opts?.now });
    all.push(...rows);
  }
  const withIds = assignIds(all); // sorts + numbers 1..N
  fs.writeFileSync(OUTPUT_150K, JSON.stringify(withIds, null, 2));
  process.stderr.write(`wrote ${withIds.length} records → ${OUTPUT_150K}\n`);
  return withIds;
}
```

- [ ] **Step 2: Implement `bin/run-kaggle.ts`** (calibration report + full run):

```ts
import { CALIBRATION_N, HARD_ER_MIN_FAIR, HARD_ER_MAX_FAIR, TIERS } from '../src/config.ts';
import { loadCandidates } from '../src/kaggle-source.ts';
import { solveAndCount } from '../src/qqwing.ts';
import { gradeBatch } from '../src/grader.ts';
import { rate } from '../src/serate.ts';
import { assembleKaggle } from '../src/assemble.ts';

const argv = process.argv.slice(2);
const calibrate = argv.includes('--calibrate');
const ci = argv.indexOf('--count');
const target = ci >= 0 ? Number(argv[ci + 1]) : undefined;

async function calibrateRun() {
  const cands = await loadCandidates();
  for (const tier of TIERS) {
    const sample = cands[tier].slice(0, CALIBRATION_N).map((c) => c.puzzle);
    if (sample.length === 0) { console.error(`${tier}: NO candidates`); continue; }
    const solves = await solveAndCount(sample);
    const grades = await gradeBatch(sample);
    const unique = solves.filter((s) => s.solutionCount === 1).length;
    const gradeHist: Record<string, number> = {};
    for (const g of grades) gradeHist[String(g.difficulty)] = (gradeHist[String(g.difficulty)] ?? 0) + 1;
    let erLine = '';
    if (tier === 'hard') {
      const ers = (await rate(sample)).map((r) => r.er).filter((e): e is number => e !== null);
      const inBand = ers.filter((e) => e >= HARD_ER_MIN_FAIR && e <= HARD_ER_MAX_FAIR).length;
      const sorted = [...ers].sort((a, b) => a - b);
      erLine = ` | ER median=${sorted[Math.floor(sorted.length / 2)]?.toFixed(2)} inFairBand=${inBand}/${ers.length}`;
    }
    console.error(`${tier}: n=${sample.length} unique=${unique} grades=${JSON.stringify(gradeHist)}${erLine}`);
    // Dump up to 8 sample puzzles for a feel gut-check.
    console.error('  samples: ' + sample.slice(0, 8).join(' '));
  }
}

(calibrate ? calibrateRun() : assembleKaggle({ target }).then((r) => { process.stderr.write(`done: ${r.length}\n`); }))
  .catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Calibration dry-run (the owner gate).** After Task 7 produced candidates:

```bash
node dataset-pipeline/bin/run-kaggle.ts --calibrate
```

Expected: per-tier line with `unique`, grade histogram, and (hard) ER median + `inFairBand` count, plus sample puzzles. **STOP and review with the owner.** Tune `KAGGLE_PREFILTER` / `HARD_ER_MIN_FAIR/MAX` in `config.ts` and re-run until each tier's grade/ER lands where intended and hard `inFairBand` is high enough to reach 30k after oversampling.

- [ ] **Step 4: Small smoke run end-to-end** (proves the full path without the multi-hour cost):

```bash
node dataset-pipeline/bin/run-kaggle.ts --count 25
node -e "const a=require('./sudoku_150000.json'); console.log(a.length, a[0].id, a.at(-1).id, new Set(a.map(r=>r.id)).size)"
```

Expected: 100 records (25 × 4 tiers), ids contiguous `1..100`, unique id count == length, tiers sorted.

- [ ] **Step 5: Commit**

```bash
git add dataset-pipeline/src/assemble.ts dataset-pipeline/bin/run-kaggle.ts
git commit -m "feat(dataset): run-kaggle entry — calibration report + 150k assembly"
```

---

### Task 9: Docs + final full run

**Files:**
- Modify: `docs/DECISIONS.md`, `docs/CHANGELOG.md`, `docs/STATUS.md`, `docs/ARCHITECTURE.md`

- [ ] **Step 1: Log the decision** in `docs/DECISIONS.md` — new dated entry: source swap to Kaggle (in-sandbox), hybrid re-rate, 150k, fair-hard band replacing ER 3.4–5.0, sequential `id` + `source_id`, symmetry dropped on all tiers. Use the Context/Options/Decision/Impact format.

- [ ] **Step 2: Update `docs/CHANGELOG.md`** — dated entry listing new files (kaggle-filter, kaggle-source, kaggle-pipeline, run-kaggle, sandbox/kaggle.*), schema fields, and the calibration gate.

- [ ] **Step 3: Update `docs/STATUS.md`** — new dataset is `sudoku_150000.json`; note the calibration gate outcome and the final per-tier counts; keep `sudoku_10000.json` noted as superseded pending owner sign-off.

- [ ] **Step 4: Update `docs/ARCHITECTURE.md`** — add the `sudoku-kaggle` image + fetch/filter stage to the pipeline section and project tree.

- [ ] **Step 5: Final full run** (only after the owner approves calibration):

```bash
node dataset-pipeline/bin/run-kaggle.ts        # multi-hour, resumable; hard tier dominates
node -e "const a=require('./sudoku_150000.json'); const c={}; a.forEach(r=>c[r.difficulty]=(c[r.difficulty]||0)+1); console.log(a.length, c, new Set(a.map(r=>r.id)).size, new Set(a.map(r=>r.puzzle)).size)"
```

Expected: 150000 records; counts 30000/45000/45000/30000; unique ids == 150000; unique puzzles == 150000 (0 duplicates).

- [ ] **Step 6: Commit**

```bash
git add docs/ sudoku_150000.json
git commit -m "feat(dataset): 150k Kaggle-sourced dataset + docs"
```

---

## Self-Review

**Spec coverage:**
- §2 method (hybrid pre-filter + re-rate) → Tasks 3,5,6,7. ✓
- §3 dataset facts → Task 3 parser + Task 7 verify. ✓
- §4 trust boundary (CSV in volume, only candidates/JSON to host) → Task 7 (`fetchKaggleCsv`/`runFilter` use `KAGGLE_VOLUME`, `--network none`). ✓
- §5 tiers + fair-hard + no-guessing → Tasks 2 (bands), 5 (gates). ✓
- §6 schema (`id`, `source_id`, trusted qqwing solution) → Task 1 + gates use `solve.solution`. ✓
- §8 module map → all reused modules imported, new modules created. ✓
- §9 calibration gate → Task 8 Step 3. ✓
- §11 symmetry dropped, sequential id → Tasks 5 (no `isSymmetric180`), 4. ✓
- §13 testing → each task has TDD tests; full-run acceptance in Task 9 Step 5. ✓

**Placeholder scan:** No TBD/TODO. Task 7 Step 1 is a real characterization step (per the sandbox rule) with a concrete fallback instruction, not a placeholder.

**Type consistency:** `PuzzleRecord.{id,source_id}` (Task 1) used consistently in gates (Task 5) and `assignIds` (Task 4); `Candidate` defined in Task 6, consumed by `kaggle-source`/`assembleKaggle` (Tasks 7,8); `buildKaggleTier` signature identical across Tasks 6 and 8; `filterLines` signature identical across Tasks 7 Steps 2–3. `EXPECTED_GRADE` keyed by `LowerTier` — `acceptKaggleLower` casts `tier as LowerTier` only on the non-hard branch. ✓

**Known residual risk (flagged, not a gap):** the Kaggle download URL/auth is confirmed empirically in Task 7 Step 1 rather than assumed; the fetch command is updated there if reality differs.
