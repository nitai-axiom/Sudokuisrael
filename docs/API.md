# API

No HTTP API / endpoints exist yet (no backend service is deployed).

## External services
| Service | Used by | Auth |
|---|---|---|
| Supabase (PostgREST) | `scripts/load-supabase.mjs` | `SUPABASE_SERVICE_KEY` (service role) via env at runtime |

**Supabase `puzzles` table — columns inserted by the loader:** `puzzle`, `solution`, `difficulty`, `techniques`, `givens`, `fun_score`, `er_rating` (`position`/`publish_date`/`is_active` set by `sudoku_next/supabase/seed.sql` for the 365 daily rows; `id`/`created_at` auto). The loader streams all 148,206 rows in batches of 500 with `on_conflict=puzzle` + `resolution=ignore-duplicates`. Operator procedure: `sudoku_next/docs/RELOAD-RUNBOOK.md`.

## SudokuEngine (TS class API)
The main "interface" today is the engine class in `lib/sudoku-engine.ts`. Key methods:
`enterDigit(row,col,digit)`, `eraseCell(row,col)`, `toggleNote(row,col,digit)`, `getHint()`, `undo()`, `resetPuzzle()`, `getCandidates(row,col)`, `getState()`, `startTimer()`/`pauseTimer()`, `getElapsed()`.
See README for the full table.

## Environment variables
| Var | Used by | Notes |
|---|---|---|
| `SUPABASE_URL` | uploader | |
| `SUPABASE_SERVICE_KEY` | uploader | Service role — bypasses RLS. Keep in `.env` only (git-ignored). |
