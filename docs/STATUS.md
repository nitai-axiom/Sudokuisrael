# STATUS

**Last updated:** 2026-06-28
**Phase:** Phase 3 (v1) done — Next.js board playing on the real engine. Phases 1 (cleanup) + 2 (engine fixes + tests) done.

## One-line state
There is now ONE game: a Next.js app in `web/` that plays through the tested engine. The duplicate logic in `index.html` is superseded (kept only as a visual reference until parity is signed off).

## What's working
| Component | State | Notes |
|---|---|---|
| Next.js app (`web/`) | ✅ v1 playable | Real engine, RTL/Hebrew, mobile + desktop. Difficulty loads real puzzles. Verified by browser smoke test. |
| Game engine (`lib/sudoku-engine.ts`) | ✅ Works, tested | Now the single source of game logic. 5 tests (`npm test`). ENG-4 (hint/notes) still open. |
| Rust puzzle generator (`sudoku-generator/`) | ✅ Works | Unchanged. Generates graded puzzles. |
| `index.html` prototype | ⚠️ Superseded | Kept as visual reference only. Delete once owner confirms parity (RS/UI bugs in it no longer matter). |
| Python uploader (`upload_to_supabase.py`) | ⚠️ Works once, by hand | Unchanged. See BUGS.md (PY-1/2/3). |
| OCR scanner (`lib/scanner/`) | 🟥 WIP ~30% | Parked. |

## In progress
- Nothing actively in progress. Phase 3 v1 just completed.

## Blocked / decisions needed
- **Delete `index.html`?** v1 has reached parity. Awaiting owner OK to delete it (recoverable from git). This is the final step that makes "one implementation" literal.

## Next steps
| # | Step | Phase |
|---|------|-------|
| 1 | ~~Wire UI to `SudokuEngine`, load real puzzles per difficulty~~ ✅ done (web/) | 3 |
| 2 | Confirm parity → delete `index.html` | 3 (needs OK) |
| 3 | Resolve ENG-4 (decide if hints mutate notes) → richer hints | 2/3 |
| 4 | Supabase: fetch puzzles from DB instead of bundled `puzzles.json` | 4 |
| 5 | Harden Python uploader (retries, idempotent upsert) | 4 |
| 6 | Deploy to Vercel; login/accounts; ads | later |
| 7 | Resume OCR scanner (grid detection + digit recognition) | later |
