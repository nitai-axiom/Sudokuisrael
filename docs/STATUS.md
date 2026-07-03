# STATUS

**Last updated:** 2026-07-03
**Phase:** Difficulty recalibrated. **New shipping dataset: `sudoku_150000.json` (148,206 puzzles, Kaggle-sourced, re-rated).** Old 10k dataset superseded.

## One-line state
There is now ONE game: a Next.js app in `web/` that plays through the tested engine. **The shipping dataset is now `sudoku_150000.json`** — 148,206 puzzles sourced from Kaggle's 3M rated set and re-validated/re-rated in the sandbox (very_easy 30,000 · easy 45,000 · medium 45,000 · hard 28,206; **0 duplicates, 0 malformed, ids 1…148,206, every record carries its Kaggle `source_id`**). Difficulty was **recalibrated for fun** (owner: old games too hard/not fun): gentle entry (very_easy = 25–26 clues, pure singles) and a fair-but-challenging hard tier at serate **ER 3.4–4.5** (median 4.2, pure logic — no guessing/coloring/chains). The older `sudoku_10000.json` (HoDoKu hard tier, ER 3.4–5.0) is retained but superseded.

## What's working
| Component | State | Notes |
|---|---|---|
| Dataset pipeline (`dataset-pipeline/`) | ✅ **Kaggle recalibration done; 148,206 produced** | Shipping dataset `sudoku_150000.json` (gitignored, 68 MB). Kaggle 3M source, fetched+filtered **in-sandbox** (raw CSV only in a Docker volume). Lower tiers: qqwing uniqueness + Rust grader. Hard tier: serate ER **3.4–4.5** (median 4.2). `bin/run-kaggle.ts` (`--calibrate`/`--count N`/full), checkpoint+cursor resumable. 98 tests green. *(Old path — `bin/run-all.ts` → `sudoku_10000.json` with HoDoKu/serate hard tier — still present but superseded.)* |
| Next.js app (`web/`) | ✅ v1 playable | Real engine, RTL/Hebrew, mobile + desktop. Difficulty loads real puzzles. Verified by browser smoke test. |
| Game engine (`lib/sudoku-engine.ts`) | ✅ Works, tested | Now the single source of game logic. 5 tests (`npm test`). ENG-4 (hint/notes) still open. |
| Rust puzzle generator (`sudoku-generator/`) | ✅ Works, extended | Base generates graded puzzles; new `--grade` mode added for dataset pipeline. |
| `index.html` prototype | ⚠️ Superseded | Kept as visual reference only. Delete once owner confirms parity (RS/UI bugs in it no longer matter). |
| Python uploader (`upload_to_supabase.py`) | ⚠️ Works once, by hand | Unchanged. See BUGS.md (PY-1/2/3). |
| OCR scanner (`lib/scanner/`) | 🟥 WIP ~30% | Parked. |

## In progress
- **Site rebuild moved to a new repo.** Game development now continues in **`nitai-axiom/sudoku_next`** (private, https://github.com/nitai-axiom/sudoku_next), seeded with a self-contained copy of `web/` (engine + `puzzles.json` pulled in, aliases rewired, `next build` verified). Target: Supabase-backed, deployed from scratch. THIS pipeline repo stays the dataset/pipeline source. See DECISIONS (2026-06-29, Supabase) + CHANGELOG.
- Phase 3 v1 complete; Dataset pipeline Plans 1 + 2 complete; full 10,000 dataset generated on branch `feat/dataset-pipeline-plan2` (awaiting merge).

## Next steps for the new `sudoku_next` repo
1. Stand up Supabase project + `puzzles` table; load **`sudoku_150000.json`** into it (schema now includes `id` + `source_id`; reference loader: `upload_to_supabase.py` here — regenerate the file with `node dataset-pipeline/bin/run-kaggle.ts` since it's gitignored).
2. Switch the app from bundled `puzzles.json` to fetching puzzles from Supabase.
3. Accounts / saved progress; then deploy (Vercel).

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
| 6 | Harden Python uploader (retries, idempotent upsert) | 4 |
| 7 | Deploy to Vercel; login/accounts; ads | later |
| 8 | Resume OCR scanner (grid detection + digit recognition) | later |
