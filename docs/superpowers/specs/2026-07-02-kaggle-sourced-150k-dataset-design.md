# Design — Kaggle-sourced, difficulty-recalibrated 150k dataset

**Date:** 2026-07-02
**Status:** Approved (design). Next: implementation plan.
**Owner decision driver:** "The games are too difficult and not so fun." Specifically: **entry feels too hard, hard feels not fun.**

## 1. Problem

The current `sudoku_10000.json` is *generated* (qqwing lower tiers, HoDoKu+serate hard tier). Two calibration failures make it unfun:

1. **Entry too hard.** Lower tiers can drop to minimal clue counts (17–18), which feel sparse and mean for beginners.
2. **Hard not fun.** The hard tier is defined at **serate ER 3.4–5.0**. The top of that band (≈4.2+) is exactly where puzzles *require* forcing chains, coloring, and XY-wings — the "guess-y," obscure techniques most players dislike. The tier was defined to include the frustrating zone.

## 2. Decision (what we're building)

Replace the *puzzle source* with the Kaggle dataset **"3 million Sudoku puzzles with ratings"** (radcliffe), and re-calibrate difficulty, while **reusing the existing validation/grading pipeline almost entirely**.

- **Method:** Hybrid (owner-approved). Cheap pre-filter of the 3M by Kaggle's own `clues` + `difficulty` columns → narrow candidate pools → **re-validate and re-rate the finalists with our own trusted graders** (Rust grader + serate + qqwing).
- **Size:** **150,000** puzzles (owner-approved), 4 tiers.
- **Fun-hard:** cap the challenge — hard means real technique, **never guessing**.
- **IDs:** every record gets a sequential integer `id` (1…150000) plus a `source_id` for traceability.
- **Sandbox rule (hard constraint):** the raw 536 MB CSV is **never downloaded to the host**. Fetch + checksum + schema-verify + filter all happen inside Docker; only the small, selected candidate puzzles and the final validated JSON cross to the host. See [[untrusted-tools-sandbox-only]].

## 3. The data source (verified from the Kaggle dataset page, 2026-07-02)

`sudoku-3m.csv`, 535.89 MB, CC0 public domain. Columns:

| Column | Meaning |
|---|---|
| `id` | Kaggle's unique row id (up to 3,000,000) |
| `puzzle` | 81-char string, `.` = blank |
| `solution` | 81-char solved grid, digits 1–9 |
| `clues` | number of givens (this is the "hints" the owner referred to) |
| `difficulty` | 0.0–8.5, computed by an automated solver from **average search-tree depth over 10 attempts** (a guess/backtrack proxy, **not** a technique rating) |

Key distribution facts that make this viable:
- **Clues:** min 19, max 31, most **23–26**. (No 17-clue minimal puzzles — good; those are the mean ones.)
- **Difficulty:** **43% are difficulty 0** (pure scanning). ~1.29M in the 0.00–0.17 band. Plenty of gentle material.
- **Fair-hard supply:** ~**280,000** puzzles sit in Kaggle difficulty **3.0–5.5**, far more than the 30k hard target needs after re-rating rejections.

> Important: Kaggle `difficulty` is a **different scale** from our serate ER. We use it only as a coarse, free pre-filter; our own graders set the final tier labels.

## 4. Trust model / sandbox boundary

| Zone | Runs | Trust |
|---|---|---|
| **Fetch** | Docker container/build, network **on only here**. Downloads CSV into a **named Docker volume** `kaggle-csv` (NOT a host bind-mount). Verifies SHA-256 + header (5 columns) + row count (~3M). | Untrusted data, quarantined in the volume. |
| **Filter** | Docker container, `--network none`, mounts `kaggle-csv` volume. Streams the CSV, buckets rows into per-tier candidate pools (oversampled), emits small candidate JSONL. | Runs in sandbox; emits only selected 81-char puzzle strings + metadata. |
| **Validate / rate** | Existing pipeline: **qqwing** (trusted container, uniqueness + trusted solution), **Rust grader** (trusted host binary, technique + no-guessing), **serate** (sandbox container, hard ER). | Established two-zone model, unchanged. |
| **Assemble** | Host TS. Sort, assign `id`, write `sudoku_150000.json`. | Trusted. |

The 536 MB raw CSV lives only in the `kaggle-csv` Docker volume and is deleted after the build. The Kaggle API token is passed to the fetch container as a **runtime secret** (env/secret mount), never baked into an image or committed.

## 5. Tier definitions

Same 4-tier shape the app already consumes, scaled to 150k:

| Tier | Count | Kaggle pre-filter (coarse, free) | Our-engine acceptance (final label) | Feel |
|---|---|---|---|---|
| **very_easy** | 30,000 | `difficulty == 0`, `clues` 25–26 | Rust grade == `easy` (singles only), solvable by pure logic | Pure scanning, gentle on-ramp |
| **easy** | 45,000 | `difficulty` 0–1, `clues` 24–26 | Rust grade == `easy` | Scanning + a small nudge |
| **medium** | 45,000 | `difficulty` 1–3, `clues` 23–25 | Rust grade == `medium` | Pairs, pointing, box-line |
| **hard** | 30,000 | `difficulty` 3–5.5, `clues` 22–25 | serate ER within **fair band** + Rust grader solvable (no guessing) | Real technique, fair, no guessing |

- **very_easy vs easy** are both graded `easy` by the Rust grader (both singles-only); they are split by the Kaggle pre-filter (difficulty 0 & 25–26 clues = very_easy), exactly mirroring how the current pipeline splits them by qqwing `simple` vs `easy`.
- **Fair-hard band:** replace the old `ER 3.4–5.0`. Target roughly **ER 2.8–3.8** — needs naked/hidden pairs, pointing, box-line, basic X-Wing; **excludes** the ≈4.2+ chains/coloring zone. **Exact min/max are set by the calibration step (§8), not guessed here.**
- Exact pre-filter numeric bands are **starting points**, confirmed/tuned by calibration before the full run.

The proportions (30/45/45/30) are the default; owner may reweight toward easy. Data supply supports any reasonable reweighting.

## 6. Output schema

Extend the existing `PuzzleRecord` with two fields (`id`, `source_id`); everything else is unchanged so the app and `upload_to_supabase.py` need no rework:

```
{
  "id": 1,                     // NEW: sequential integer 1…150000, assigned at assembly
  "source_id": 284123,         // NEW: original Kaggle row id, for traceability
  "puzzle": "0038...",         // 81 digits, 0 = blank (normalized from Kaggle's '.')
  "solution": "6538...",       // 81 digits, from trusted qqwing solve (NOT Kaggle's, re-derived)
  "difficulty": "very_easy",   // tier label
  "techniques": ["naked_single", ...],  // from Rust grader
  "givens": 25,                // clueCount(puzzle)
  "er_rating": null,           // hard tier: serate ER; lower tiers: null
  "fun_score": 4.2,            // funScore(grade); may be null for hard
  "generated_at": "2026-07-02T..."
}
```

- `id` is **positional** (assigned after `sortRecords`): if the dataset is ever regenerated, numbers reshuffle. Acceptable now. If permanent stable ids are needed later (saved user progress), freeze the dataset or switch to a content-hash id. Out of scope today.
- `solution` is taken from the **trusted qqwing solve**, not copied from Kaggle — this both re-validates uniqueness and gives a solution we trust.
- Output file: **`sudoku_150000.json`**. The existing `sudoku_10000.json` is left untouched until the owner signs off on the replacement.

## 7. Acceptance gates (reused pure functions, adapted)

Analogous to the existing `acceptPuzzle` / `acceptHard`, minus symmetry:

**Lower tiers** (`acceptKaggleLower`, adapted from `acceptPuzzle`):
1. `qqwing` uniqueness: `solutionCount === 1` and a solution present.
2. Clue floor (asymmetric floor = 17).
3. Pure-logic solvable → `funScore(grade)` not null (this is the **no-guessing** gate).
4. `grade.difficulty === EXPECTED_GRADE[tier]` (easy/easy/medium).
5. Build + `validateRecord`.
6. **Symmetry gate removed** (Kaggle puzzles are asymmetric — see §9).

**Hard** (`acceptKaggleHard`, adapted from `acceptHard`):
1. `qqwing` uniqueness.
2. serate ER within the **fair band** `[HARD_ER_MIN_FAIR, HARD_ER_MAX_FAIR]`.
3. **No-guessing:** Rust grader reports solvable by pure logic.
4. Clue floor (17).
5. Build + `validateRecord`.

Dedup across the whole selection via `dedupeByPuzzle` (`canonicalKey`). Per-tier checkpoints via existing `checkpoint.ts` (resumable).

## 8. Pipeline stages & module map

**Reused as-is:** `docker.ts`, `qqwing.ts` (`solveAndCount`), `serate.ts` (`rate`), `grader.ts` (`gradeBatch`), `record.ts`, `dedupe.ts`, `checkpoint.ts`, `funscore.ts`, `grid.ts`, `assemble.ts` (`sortRecords`).

**New:**
- `sandbox/kaggle.Dockerfile` + `sandbox/build-kaggle.sh` — fetch image (Kaggle CLI or curl + token), downloads to `kaggle-csv` volume, verifies checksum/schema.
- `src/kaggle-source.ts` — filter stage wrapper: run the filter container, parse candidate JSONL into `{ puzzle, source_id, clues, kaggleDifficulty }[]` per tier.
- `src/kaggle-pipeline.ts` — per-tier build loop (analog of `pipeline.ts`/`hard-pipeline.ts`): pull candidates → grade/rate → accept → checkpoint → until target.
- `src/config.ts` additions — `KAGGLE_PREFILTER` bands, `TARGETS` = 150k set, `HARD_ER_MIN_FAIR`/`HARD_ER_MAX_FAIR`, `OUTPUT_150K` path.
- `src/assemble.ts` addition — `assignIds()` after sort; carry `source_id`.
- `bin/run-kaggle.ts` — entry point (supports `--calibrate` and full run).

**Stages:**
1. **Fetch** → `kaggle-csv` volume, verified.
2. **Filter** (container) → candidate pools (oversampled ~1.3× lower, ~2–3× hard) as JSONL.
3. **Build per tier** (host orchestrator) → qqwing + Rust grader (+ serate for hard) → accept → checkpoint.
4. **Assemble** → sort, `assignIds`, write `sudoku_150000.json`.

## 9. Calibration step (gate before the full run)

`bin/run-kaggle.ts --calibrate` runs ~500 candidates per tier through the full accept path and reports:
- serate ER distribution vs the fair band (hard) — used to **set `HARD_ER_MIN_FAIR/MAX`**.
- Rust-grade hit rate per pre-filter band (how many survive) — used to tune oversample factors and pre-filter bands.
- Dumps **5–10 sample puzzles per tier** for an owner "feel" gut-check.

**Owner reviews calibration output and approves before the full 150k run.** This is a hard checkpoint.

## 10. Runtime & feasibility

- **Lower tiers (120k):** Rust grader is fast (host, ms/puzzle); qqwing solves are batched + early-resolve. Minutes to low tens of minutes.
- **Hard tier (30k):** serate ≈155 ms/puzzle; with oversampling this is the dominant cost — a **multi-hour, unattended run** (roughly 2–4 h on the 2-CPU Colima VM, less if pre-filter is tightened by calibration). Checkpoint-resumable, so interruption is safe.
- **Storage:** ~25–30 MB JSON. Too big to bundle in-app — consistent with the existing Supabase serving decision (2026-06-29).

## 11. Decisions locked in this design

- **Symmetry dropped for all tiers.** Kaggle puzzles are asymmetric (Dachev generator). Purely cosmetic; hard already dropped it (2026-06-29). Uniform pipeline > mirror symmetry.
- **Hybrid method** (pre-filter + re-rate finalists), not trust-Kaggle-only, not re-rate-all.
- **150,000** total, default split 30/45/45/30.
- **Sequential integer `id`** + `source_id`.
- **serate `solution` ignored;** trusted qqwing solution used instead.
- **Fair-hard replaces the ER 3.4–5.0 band;** exact numbers from calibration.

## 12. Out of scope (not now)

- Permanent/stable ids across regenerations.
- App/UI changes (schema is additive; app reads by `difficulty` as today).
- Supabase load of the 150k (reference loader `upload_to_supabase.py` exists; loading is a separate step in the `sudoku_next` repo).
- Reweighting the tier split (easy to change if owner wants).

## 13. Testing

- Unit: `assignIds` (sequential, contiguous, tier-sorted), `source_id` carried through, `validateRecord` still passes with new fields, pre-filter band bucketing (given `clues`/`difficulty` → correct tier or reject), CSV row parser (handles `.` blanks, malformed lines).
- Reused accept-gate tests adapted (symmetry removed, fair-hard band).
- Calibration output sanity (bands non-overlapping; targets reachable).
- Full-run acceptance: 0 duplicates, 0 malformed, all unique (qqwing), all pass `validateRecord`, exact tier counts, ids 1…150000 contiguous.
```
