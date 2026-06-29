# STATUS

**Last updated:** 2026-06-29
**Phase:** Phase 3 (v1) done. Dataset pipeline Plan 1 complete — **first full 8,000-puzzle lower-tier dataset produced and validated.**

## One-line state
There is now ONE game: a Next.js app in `web/` that plays through the tested engine. The duplicate logic in `index.html` is superseded (kept only as a visual reference until parity is signed off). The dataset pipeline has produced a full **8,000-puzzle** lower-tier dataset (`sudoku_lower.json`: very_easy 2,000 · easy 3,000 · medium 3,000; all unique + validated), with the medium tier fun-score-upgraded.

## What's working
| Component | State | Notes |
|---|---|---|
| Dataset pipeline (`dataset-pipeline/`) | ✅ Plan 1 done; 8,000 produced | Generated the full lower-tier dataset. Two-zone architecture (trusted qqwing + Rust grader). Resumable checkpoints. Batch-scaled timeouts + fault-tolerant retry. Container leak fixed (named + force-reaped — no more CPU pinning under Colima). Medium fun-score upgraded (mean 3.62). 48 tests all green. Output → `sudoku_lower.json`. |
| Next.js app (`web/`) | ✅ v1 playable | Real engine, RTL/Hebrew, mobile + desktop. Difficulty loads real puzzles. Verified by browser smoke test. |
| Game engine (`lib/sudoku-engine.ts`) | ✅ Works, tested | Now the single source of game logic. 5 tests (`npm test`). ENG-4 (hint/notes) still open. |
| Rust puzzle generator (`sudoku-generator/`) | ✅ Works, extended | Base generates graded puzzles; new `--grade` mode added for dataset pipeline. |
| `index.html` prototype | ⚠️ Superseded | Kept as visual reference only. Delete once owner confirms parity (RS/UI bugs in it no longer matter). |
| Python uploader (`upload_to_supabase.py`) | ⚠️ Works once, by hand | Unchanged. See BUGS.md (PY-1/2/3). |
| OCR scanner (`lib/scanner/`) | 🟥 WIP ~30% | Parked. |

## In progress
- **Plan 2 (hard tier) — Task 1 DONE.** Built the untrusted-tool image `sudoku-jars` (HoDoKu 2.2.0 + serate/SukakuExplainer), acquired + hash/commit-verified entirely in-Docker, runs offline (`--network none`). Both JARs load and run; both security gates verified (wrong hash / bad commit fail the build). serate entrypoint is `diuf.sudoku.test.serate` (run via `-cp`); built from source with javac — repo has no pom.xml at the pinned commit (see DECISIONS). Next: Task 2 (HoDoKu generation wrapper) + Task 3 (serate ER-rating wrapper) using the tool help/entrypoints captured in `.superpowers/sdd/task-1-report.md`.
- Phase 3 v1 complete; Dataset pipeline Plan 1 complete; full 8,000 dataset generated.

## Machine/ops note (2026-06-29)
- A qqwing **container leak** under Colima was pinning the CPU during long runs (34 orphaned containers, ~6% CPU each, unbounded) — now fixed (DP-2): containers are named and force-reaped on settle. If you ever see stray `qqwing-*` containers, clean them with `docker ps -aq --filter ancestor=qqwing-trusted | xargs docker stop -t 0`. Healthy runs hold at ~1 concurrent container.

## Blocked / decisions needed
- **Delete `index.html`?** v1 has reached parity. Awaiting owner OK to delete it (recoverable from git). This is the final step that makes "one implementation" literal.

## Next steps
| # | Step | Phase |
|---|------|-------|
| 1 | ~~Wire UI to `SudokuEngine`, load real puzzles per difficulty~~ ✅ done (web/) | 3 |
| 2 | Confirm parity → delete `index.html` | 3 (needs OK) |
| 3 | Dataset Plan 2: hard tier + serate ER rating (untrusted sandbox) | Pipeline |
| 4 | Resolve ENG-4 (decide if hints mutate notes) → richer hints | 2/3 |
| 5 | Supabase: fetch puzzles from DB instead of bundled `puzzles.json` | 4 |
| 6 | Harden Python uploader (retries, idempotent upsert) | 4 |
| 7 | Deploy to Vercel; login/accounts; ads | later |
| 8 | Resume OCR scanner (grid detection + digit recognition) | later |
