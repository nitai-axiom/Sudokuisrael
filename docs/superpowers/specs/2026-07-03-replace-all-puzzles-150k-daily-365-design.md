# Design — Replace all puzzles with the 150k dataset; rebuild Daily (365) + online + seeded

**Date:** 2026-07-03
**Status:** Approved (design) — pending spec review → implementation plan
**Repos touched:** `sudoku-pipeline` (generators, source dataset, legacy cleanup) and `sudoku_next` (Supabase content, seeded artifacts)

## Goal

Make `sudoku_150000.json` (148,206 puzzles, four tiers) the single source of every puzzle the product serves. Concretely:

1. **Online play-pool:** load **all 148,206** puzzles into the live Supabase `puzzles` table.
2. **Daily:** curate **365** puzzles (10% very_easy / 40% easy / 40% medium / 10% hard), mixed so difficulty varies day to day.
3. **Seeded-in-app artifacts:** regenerate the committed `seed.sql` (daily) and `cold-start-puzzles.ts` (offline bundle) from the new data.
4. **No old puzzles left:** hard-reset Supabase before reload, and delete the superseded dataset/artifact files in both repos.

No application code changes are required — only data, generators, and a one-time load runbook.

## Background (current state)

- **Two repos.** `sudoku-pipeline` is the dataset/generator source of truth. The real app is a separate repo, `sudoku_next` (`/Users/nitairosenberg/sudoku_next`), Supabase-backed. The `web/` folder inside `sudoku-pipeline` is a superseded prototype.
- **Puzzle store (sudoku_next Supabase `public.puzzles`).** Columns: `id uuid`, `puzzle text unique (81)`, `solution text (81)`, `difficulty text check in (very_easy,easy,medium,hard)`, `techniques text[]`, `givens int`, `fun_score int`, `er_rating numeric`, `publish_date date`, `position int`, `is_active bool`, `created_at`.
- **Daily model (already built).** A puzzle is part of the daily rotation when it has a `position` (1..N) and `is_active`. The app resolves day *n* → `position = (dayIndex mod N) + 1` (`app/lib/dailyPuzzle.ts` + RPC `get_daily_puzzle`; `get_daily_count()` returns N). Today N=100 (50 DB-easy + 50 DB-medium, interleaved by migration `0010`).
- **Free-play (already built).** Per-tab "new puzzle" pulls from the same table via RPC `get_random_puzzles(difficulty, exclude[], count)` (migration `0008`). Reads all rows of a DB difficulty; no `position` needed.
- **App↔DB difficulty remap** (`sudoku_next/app/lib/puzzles.ts`, unchanged by this work):

  | App tab | DB `difficulty` |
  |---|---|
  | קל / easy | `very_easy` |
  | בינוני / medium | `easy` |
  | קשה / hard | `medium` |
  | אקסטרים / extreme | `hard` |

  The owner's request is stated in **DB/dataset** terms (very_easy, the two mid tiers = easy+medium, hard) — exactly the vocabulary the generators use. In-app the daily therefore spans tabs קל→אקסטרים, weighted to the middle.
- **Generators (in `sudoku-pipeline/scripts/`)** currently read the **old** `sudoku_10000.json` and write into `sudoku_next/supabase/`:
  - `generate-seed.mjs` → `supabase/seed.sql` (100 curated daily, positioned).
  - `generate-library.mjs` → `supabase/puzzles_library.sql` (full 10k pool, `ON CONFLICT DO NOTHING`).
  - `upload_to_supabase.py` — legacy bulk-insert (old schema, unused).
- **Dataset field coverage (verified in `sudoku_150000.json`):**

  | Tier | count | `fun_score` | `er_rating` |
  |---|---|---|---|
  | very_easy | 30,000 | 1–2 | null |
  | easy | 45,000 | 1–2 | null |
  | medium | 45,000 | 2–5 | null |
  | hard | 28,206 | **null (all)** | present (band 3.4–4.5) |
  | **total** | **148,206** | | |

## Owner decisions (approved)

1. **Online pool = all 148,206** — loaded via a streaming script, not a committed SQL file.
2. **Purge = hard reset** — `truncate ... restart identity cascade` then reload. Cascade also clears `solves` (acceptable; pre-launch, no real users).
3. **Daily split = 37 / 146 / 145 / 37** (very_easy / easy / medium / hard) = 365.
4. **Purge legacy pipeline files too** — the 150k becomes the only source anywhere.
5. **Load mechanism = Option A** — streaming Node loader using `@supabase/supabase-js` + a service-role key supplied at load time (the app's `.env.local` has only the anon key).
6. **Sub-decisions:** (a) regenerate root `puzzles.json` as a small fresh sample so the `web/` prototype still builds — do **not** delete `web/`. (b) Leave migration `0010` in place (history intact); it is superseded and simply not re-run.

## Design

### 1. Daily set — 365 puzzles → `sudoku_next/supabase/seed.sql`

Rewrite `sudoku-pipeline/scripts/generate-seed.mjs`:

- **Source:** `../sudoku_150000.json`.
- **Counts:** very_easy 37, easy 146, medium 145, hard 37 (= 365).
- **Selection rule (tier-aware, deterministic):**
  - very_easy / easy / medium: order by `fun_score` **DESC**, tie-break `puzzle` **ASC**; take the top N.
  - hard: `fun_score` is null, so order by `er_rating` **ASC** (gentlest first, nearest 3.4 — the most approachable "extreme"), tie-break `puzzle` ASC; take 37. *(Product nuance flagged to owner; change direction here if a spread or a harder pick is wanted.)*
- **Ordering ("mix them up"):** assign `position` 1..365 by evenly interleaving the four tier lists so each tier is spread across the whole year with no long same-difficulty runs. Deterministic (no RNG) via a largest-remainder/Bresenham weave: for each slot *i* in 1..365, emit the next puzzle from the tier whose ideal cumulative share `(count_tier/365)·i` most exceeds how many it has already been assigned. Re-runs are byte-identical.
- **Output:** `insert ... (puzzle, solution, difficulty, techniques, givens, fun_score, er_rating, position) ... on conflict (puzzle) do update set ... position = excluded.position` (keeps existing behaviour; `publish_date`/`is_active` untouched).
- **Guard:** fail loudly if any tier can't supply its quota, on bad length (≠81), or on a disallowed difficulty.

Acceptance for this module: exactly 365 rows; per-tier counts 37/146/145/37; positions a contiguous permutation of 1..365; every tier appears at least once in every ~30-slot window (even spread); deterministic re-run.

### 2. Full library — 148,206 puzzles → live Supabase (`scripts/load-supabase.mjs`, new)

New streaming loader in `sudoku-pipeline/scripts/`:

- **Source:** `../sudoku_150000.json`. **Target:** `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` from env (service-role bypasses RLS for the insert).
- **Behaviour:** batched upsert (batch ≈ 500) of `{puzzle, solution, difficulty, techniques, givens, fun_score, er_rating}` with `on conflict (puzzle) do nothing`. `position`/`publish_date`/`is_active` are left to their column defaults / to `seed.sql`. Passes `er_rating`/`fun_score` through as-is (nulls where absent).
- **Progress + resumability:** log `uploaded/total`; on a mid-run failure the operator can re-run — `do nothing` makes it idempotent.
- **Replaces:** `generate-library.mjs` and `upload_to_supabase.py` (both deleted); the committed `puzzles_library.sql` is deleted (obsolete — the pool now loads directly, not from a 50 MB checked-in SQL).

Acceptance: after a run, `select count(*) from puzzles` = 148,206; per-tier counts 30,000 / 45,000 / 45,000 / 28,206.

### 3. Cold-start bundle → `sudoku_next/app/lib/cold-start-puzzles.ts`

New small generator (`sudoku-pipeline/scripts/generate-cold-start.mjs`) that picks **3 per DB tier** (12 total) from `sudoku_150000.json` deterministically (very_easy/easy/medium by `fun_score` DESC then `puzzle` ASC; hard by `er_rating` ASC then `puzzle` ASC) and rewrites the `COLD_START` array, preserving the file's existing shape and app-difficulty labels (DB tier → app label via the remap: very_easy→easy, easy→medium, medium→hard, hard→extreme).

Acceptance: 12 entries, 3 per app tier, all present in the loaded DB, deterministic re-run.

### 4. Purge — "no old puzzles left" online

A single SQL step run against the hosted DB **before** the loader:

```sql
truncate public.puzzles restart identity cascade;
```

Cascade clears `solves` (FK `solves.puzzle_id → puzzles(id)`), which is intended and acceptable pre-launch. Delivered as a copy-paste snippet in the runbook (Supabase SQL editor / psql); not a migration.

### 5. Legacy deletions

- **`sudoku-pipeline`:** delete `sudoku_10000.json`, `sudoku_lower.json`, `scripts/generate-library.mjs`, `upload_to_supabase.py`.
- **`sudoku_next`:** delete `supabase/puzzles_library.sql`.
- **Root `puzzles.json`:** regenerate as a fresh ~15-puzzle sample drawn from `sudoku_150000.json` (mapped to the prototype's easy/medium/hard keys) so the superseded `web/` app still builds. `web/` itself is **not** deleted.

### 6. Migration `0010_interleave_daily.sql`

Left in place (migration history intact). It is superseded — `seed.sql` now owns fully-interleaved positions across four tiers. It is a no-op on a freshly reset (empty) table and must not be re-run manually against the loaded DB. No new migration is required.

### 7. What deliberately does NOT change

- App code (components, hooks, `puzzles.ts` remap, `dailyPuzzle.ts`, RPCs `get_random_puzzles` / `get_daily_puzzle` / `get_daily_count`).
- Supabase schema / migrations `0001`–`0010`.
- `launchDate` / `numberOffset` in `daily-config.ts` (owner tunes the displayed counter at go-live). The daily cycle length becomes 365, so the rotation now repeats yearly.

## Load runbook (one-time, operator-run)

Scripts are written by this work; the operator runs them.

1. **Regenerate artifacts** (in `sudoku-pipeline`, after `sudoku_150000.json` exists locally):
   - `node scripts/generate-seed.mjs` → updates `sudoku_next/supabase/seed.sql`
   - `node scripts/generate-cold-start.mjs` → updates `sudoku_next/app/lib/cold-start-puzzles.ts`
2. **Purge online:** run the `truncate ... cascade` snippet in the Supabase SQL editor.
3. **Bulk load:** `SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node scripts/load-supabase.mjs` → inserts 148,206.
4. **Stamp daily positions:** apply `sudoku_next/supabase/seed.sql` (SQL editor / `supabase db execute`). The 365 rows already exist from step 3, so `do update` sets their `position`.
5. **Verify:** `select count(*) from puzzles` = 148,206; `select get_daily_count()` = 365; per-tier counts match; spot-check `get_daily_puzzle(1)` and a few positions.

## Files touched

**Create:** `sudoku-pipeline/scripts/load-supabase.mjs`, `sudoku-pipeline/scripts/generate-cold-start.mjs`.
**Modify:** `sudoku-pipeline/scripts/generate-seed.mjs` (source + distribution + interleave), `sudoku_next/supabase/seed.sql` (regenerated, 365), `sudoku_next/app/lib/cold-start-puzzles.ts` (regenerated, 12), root `puzzles.json` (fresh sample), docs in both repos.
**Delete:** `sudoku-pipeline/sudoku_10000.json`, `sudoku-pipeline/sudoku_lower.json`, `sudoku-pipeline/scripts/generate-library.mjs`, `sudoku-pipeline/upload_to_supabase.py`, `sudoku_next/supabase/puzzles_library.sql`.

## Acceptance criteria (end-to-end)

- Supabase `puzzles`: 148,206 rows, tiers 30,000/45,000/45,000/28,206, zero rows predating the reload.
- Exactly 365 rows carry `position` (contiguous 1..365); tier composition 37/146/145/37; `get_daily_count()` = 365; consecutive positions vary in difficulty (even spread).
- `seed.sql` and `cold-start-puzzles.ts` regenerated from the 150k and deterministic on re-run.
- Legacy files listed in §5 removed; `web/` still builds against the regenerated `puzzles.json`.
- No app source or schema changes.

## Risks & mitigations

- **Service-role key handling.** Needed only at load time; never committed. Runbook passes it as an env var for a single command.
- **`order by random()` over 148k** in `get_random_puzzles` (per-tier ~30–45k rows) is heavier than at 10k. Acceptable for launch; a `tablesample`/keyset optimization is a possible follow-up, out of scope here.
- **Cascade wipes `solves`.** Intended; confirm no real progress data matters before running (pre-launch = yes).
- **Cross-repo drift.** Generators live in `sudoku-pipeline` but write into `sudoku_next`; both repos get a doc/commit noting the regeneration so the artifacts' provenance stays clear.

## Out of scope

- App/UI changes, new difficulty tabs, `launchDate` go-live tuning.
- Free-play random-selection performance tuning.
- Re-generating `sudoku_150000.json` itself (already produced; gitignored — see STATUS regeneration note).
