# STATUS

**Last updated:** 2026-06-28
**Phase:** Phase 3 (v1) done. Dataset pipeline Plan 1 complete — lower-tier dataset generation ready.

## One-line state
There is now ONE game: a Next.js app in `web/` that plays through the tested engine. The duplicate logic in `index.html` is superseded (kept only as a visual reference until parity is signed off). The dataset pipeline can now generate 8,000 lower-tier puzzles (very_easy, easy, medium) with resumable checkpoints.

## What's working
| Component | State | Notes |
|---|---|---|
| Dataset pipeline (`dataset-pipeline/`) | ✅ Plan 1 ready | Generates lower-tier puzzles (very_easy/easy/medium). Two-zone architecture (trusted qqwing + Rust grader). Resumable checkpoints. 37 tests all green. Output → `sudoku_lower.json`. |
| Next.js app (`web/`) | ✅ v1 playable | Real engine, RTL/Hebrew, mobile + desktop. Difficulty loads real puzzles. Verified by browser smoke test. |
| Game engine (`lib/sudoku-engine.ts`) | ✅ Works, tested | Now the single source of game logic. 5 tests (`npm test`). ENG-4 (hint/notes) still open. |
| Rust puzzle generator (`sudoku-generator/`) | ✅ Works, extended | Base generates graded puzzles; new `--grade` mode added for dataset pipeline. |
| `index.html` prototype | ⚠️ Superseded | Kept as visual reference only. Delete once owner confirms parity (RS/UI bugs in it no longer matter). |
| Python uploader (`upload_to_supabase.py`) | ⚠️ Works once, by hand | Unchanged. See BUGS.md (PY-1/2/3). |
| OCR scanner (`lib/scanner/`) | 🟥 WIP ~30% | Parked. |

## In progress
- Nothing actively in progress. Phase 3 v1 complete; Dataset pipeline Plan 1 complete.

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
