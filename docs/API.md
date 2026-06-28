# API

No HTTP API / endpoints exist yet (no backend service is deployed).

## External services
| Service | Used by | Auth |
|---|---|---|
| Supabase (PostgreSQL) | `upload_to_supabase.py` | `SUPABASE_SERVICE_KEY` (service role) via `.env` |

**Supabase `puzzles` table — expected columns:** `puzzle`, `solution`, `difficulty`, `techniques`, `givens`, `created_at` (auto).

## SudokuEngine (TS class API)
The main "interface" today is the engine class in `lib/sudoku-engine.ts`. Key methods:
`enterDigit(row,col,digit)`, `eraseCell(row,col)`, `toggleNote(row,col,digit)`, `getHint()`, `undo()`, `resetPuzzle()`, `getCandidates(row,col)`, `getState()`, `startTimer()`/`pauseTimer()`, `getElapsed()`.
See README for the full table.

## Environment variables
| Var | Used by | Notes |
|---|---|---|
| `SUPABASE_URL` | uploader | |
| `SUPABASE_SERVICE_KEY` | uploader | Service role — bypasses RLS. Keep in `.env` only (git-ignored). |
