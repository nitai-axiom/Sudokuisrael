# STATUS

**Last updated:** 2026-07-04
**Phase:** `sudoku_150000.json` is now the **SOLE puzzle source everywhere** — daily, cold-start bundle, prototype sample, and the online Supabase pool. Legacy 10k dataset + its generator/loader scripts are deleted.

## One-line state
There is now ONE game: a Next.js app in `web/` that plays through the tested engine. **`sudoku_150000.json` (148,206 puzzles, very_easy 30,000 · easy 45,000 · medium 45,000 · hard 28,206) is the only puzzle source everywhere**: the 365-puzzle Daily, the 12-puzzle offline cold-start bundle, the 15-puzzle prototype sample, and the full online Supabase pool are all generated/loaded from it by deterministic, unit-tested scripts in `scripts/`. Daily is now **365** puzzles (**135 very_easy + 146 easy + 73 medium + 11 hard** = app tabs easy 37% / medium 40% / hard 20% / extreme 3%; interleaved by position). **Clue counts were topped up (2026-07-04, `scripts/add-clues.mjs`)** so the game is genuinely gentler: very_easy now **36–40 clues**, easy 30–34, medium +1–3, hard +1 — by revealing more of each puzzle's own solution (uniqueness preserved). The online pool loads via **`scripts/load-supabase.mjs`**, a streaming PostgREST loader; **the live DB (`zlfsdckigumiheoaakie`) was purged + reloaded with the topped-up data + new daily on 2026-07-04** (procedure in `sudoku_next/docs/RELOAD-RUNBOOK.md`). The old `sudoku_10000.json`/`sudoku_lower.json` datasets and their loaders (`generate-library.mjs`, `upload_to_supabase.py`, the committed `puzzles_library.sql`) are deleted — see CHANGELOG 2026-07-04.

## What's working
| Component | State | Notes |
|---|---|---|
| Dataset pipeline (`dataset-pipeline/`) | ✅ **Kaggle recalibration done; 148,206 produced** | Shipping dataset `sudoku_150000.json` (gitignored, 68 MB). Kaggle 3M source, fetched+filtered **in-sandbox** (raw CSV only in a Docker volume). Lower tiers: qqwing uniqueness + Rust grader. Hard tier: serate ER **3.4–4.5** (median 4.2). `bin/run-kaggle.ts` (`--calibrate`/`--count N`/full), checkpoint+cursor resumable. 98 tests green. *(Old path — `bin/run-all.ts` produced the now-deleted `sudoku_10000.json`; the file/entry point remain in the repo but are superseded and unmaintained.)* |
| Puzzle generators (`scripts/`) | ✅ **Rewritten — all source `sudoku_150000.json`, the sole puzzle source everywhere** | `generate-seed.mjs` → daily-365 (`sudoku_next/supabase/seed.sql`); `generate-cold-start.mjs` → 12-puzzle offline bundle (`sudoku_next/app/lib/cold-start-puzzles.ts`); `generate-sample-puzzles.mjs` → root `puzzles.json` (15, prototype only); `load-supabase.mjs` → streams all 148,206 into the live Supabase `puzzles` table (idempotent upsert, batches of 500). All deterministic, unit-tested (`node --test`, `scripts/tests/`). |
| Next.js app (`web/`) | ✅ v1 playable | Real engine, RTL/Hebrew, mobile + desktop. Difficulty loads real puzzles. Verified by browser smoke test. |
| Game engine (`lib/sudoku-engine.ts`) | ✅ Works, tested | Now the single source of game logic. 5 tests (`npm test`). ENG-4 (hint/notes) still open. |
| Rust puzzle generator (`sudoku-generator/`) | ✅ Works, extended | Base generates graded puzzles; new `--grade` mode added for dataset pipeline. |
| `index.html` prototype | ⚠️ Superseded | Kept as visual reference only. Delete once owner confirms parity (RS/UI bugs in it no longer matter). |
| OCR scanner (`lib/scanner/`) | 🟥 WIP ~30% | Parked. |

## In progress
- **Site rebuild moved to a new repo.** Game development now continues in **`nitai-axiom/sudoku_next`** (private, https://github.com/nitai-axiom/sudoku_next), seeded with a self-contained copy of `web/` (engine + `puzzles.json` pulled in, aliases rewired, `next build` verified). Target: Supabase-backed, deployed from scratch. THIS pipeline repo stays the dataset/pipeline source. See DECISIONS (2026-06-29, Supabase) + CHANGELOG.
- Phase 3 v1 complete; Dataset pipeline Plans 1 + 2 complete. The 150k-is-sole-source + daily-365 work (2026-07-04) is code-complete and unit-tested on both repos; the live Supabase reload itself is still a **manual operator step** (see below).

## Next steps for the new `sudoku_next` repo
1. **Manual operator step (not yet run against prod):** purge + reload the live Supabase `puzzles` table with all 148,206 records via `node scripts/load-supabase.mjs` (streaming PostgREST, service-role key supplied at runtime — not in `.env.local`), then re-stamp the 365 daily positions from `seed.sql`. Full procedure: `sudoku_next/docs/RELOAD-RUNBOOK.md`.
2. Accounts / saved progress; then deploy (Vercel).

## Regenerating `sudoku_150000.json` (2026-07-03)
It's gitignored (68 MB). To rebuild from scratch: (1) `bash dataset-pipeline/sandbox/build-kaggle.sh`; (2) `export KAGGLE_API_TOKEN=$(cat ~/.kaggle/access_token)` then `node -e "import('./dataset-pipeline/src/kaggle-source.ts').then(m=>m.fetchKaggleCsv())"` (downloads the 536 MB CSV into the `kaggle-csv` Docker volume — stays off the host); (3) `node -e "…m.runFilter(4)"`; (4) `node dataset-pipeline/bin/run-kaggle.ts` (~1–1.5 h; hard tier serate-dominated; checkpoint-resumable). Preview difficulty first with `--calibrate`; smoke with `--count 50`. **After changing any pre-filter band / ER band / oversample, add `--fresh`** (clears the namespaced `kaggle-<tier>` checkpoints; a stale cursor would otherwise resume against a different candidate list). Kaggle checkpoints are namespaced `kaggle-<tier>` so they never collide with the 10k `run-all.ts` pipeline.

## Machine/ops note (2026-06-29)
- The DP-2 **container-leak fix is now applied to ALL pipeline tools** (qqwing + the Plan 2 HoDoKu/serate runs), via a shared named-container + `docker stop -t 0` force-reaper (`dataset-pipeline/src/docker.ts`). Under Colima, `--rm` alone orphans containers when the client is killed; the named force-stop is what reaps them. Verified **0 leaked containers** across the full 10k run. If you ever see strays, clean with `docker ps -aq --filter name=hodoku- --filter name=qqwing- --filter name=sandbox- | xargs docker stop -t 0`.
- serate is the hard-tier bottleneck (~155 ms/puzzle on the 2-CPU/2GB VM; only ~30% of HoDoKu candidates land in the ER band), so the hard tier over-generates ~3×. Its container timeout scales per-puzzle and a slow batch is retried, not fatal. Full 10k build ≈ 17 min on this VM.

## Blocked / decisions needed
- **Delete `index.html`?** v1 has reached parity. Awaiting owner OK to delete it (recoverable from git). This is the final step that makes "one implementation" literal.

## Next steps
| # | Step | Phase |
|---|------|-------|
| 1 | ~~Wire UI to `SudokuEngine`, load real puzzles per difficulty~~ ✅ done (web/) | 3 |
| 2 | Confirm parity → delete `index.html` | 3 (needs OK) |
| 3 | ~~Dataset Plan 2: hard tier + serate ER rating (untrusted sandbox)~~ ✅ done — full 10k dataset | Pipeline |
| 4 | Resolve ENG-4 (decide if hints mutate notes) → richer hints | 2/3 |
| 5 | Supabase: fetch puzzles from DB instead of bundled `puzzles.json` | 4 |
| 6 | ~~Harden puzzle uploader (retries, idempotent upsert)~~ ✅ done — `upload_to_supabase.py` deleted; replaced by `scripts/load-supabase.mjs` (idempotent `on_conflict=puzzle` + `resolution=ignore-duplicates`, batched) | 4 |
| 7 | Deploy to Vercel; login/accounts; ads | later |
| 8 | Resume OCR scanner (grid detection + digit recognition) | later |
