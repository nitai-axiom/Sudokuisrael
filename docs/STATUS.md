# STATUS

**Last updated:** 2026-06-28
**Phase:** Prototype → stabilization. Phase 1 (foundation cleanup) done.

## One-line state
Good game engine + working Rust generator, wrapped in duplicated/half-built scaffolding. Core works; not production-ready.

## What's working
| Component | State | Notes |
|---|---|---|
| Rust puzzle generator (`sudoku-generator/`) | ✅ Works | Strongest piece. Compiles, generates graded puzzles. |
| Game engine (`lib/sudoku-engine.ts`) | ⚠️ Works, has bugs | Real logic + hints. Known bugs in BUGS.md. No tests yet. |
| UI prototype (`index.html`) | ⚠️ Works, but not wired to engine | Good look (RTL/Hebrew/mobile). Contains its own duplicate game logic. |
| Python uploader (`upload_to_supabase.py`) | ⚠️ Works once, by hand | No retries/idempotency. See BUGS.md. |
| OCR scanner (`lib/scanner/`) | 🟥 WIP ~30% | Image helpers only. No grid detection, no digit recognition. Parked. |

## In progress
- Nothing actively in progress. Phase 1 just completed.

## Blocked / decisions needed
- **Phase 3 (architectural):** wire UI to the engine and delete the duplicate game logic in `index.html`. Needs sign-off before starting.

## Next steps
| # | Step | Phase |
|---|------|-------|
| 1 | Fix engine bugs + add a test suite | 2 |
| 2 | Wire `index.html` UI to `SudokuEngine`, delete duplicate logic | 3 (needs approval) |
| 3 | Load puzzles from `puzzles.json`/Supabase instead of hardcoded board | 3 |
| 4 | Harden Python uploader (retries, idempotent upsert) | 4 |
| 5 | Resume OCR scanner (grid detection + digit recognition) | later |
