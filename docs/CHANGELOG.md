# CHANGELOG

## 2026-06-28 — Dataset pipeline Task 5: trusted qqwing container + generate/solve-count wrappers
**What:** Built the trusted qqwing Docker image (`debian:bookworm-slim` + apt qqwing 1.3.4) and the TypeScript wrappers `generate()` and `solveAndCount()`. Characterised the real qqwing output format — it uses English sentence-form status lines (`The solution to the puzzle is unique.` / `There are N solutions to the puzzle.` / `Puzzle is not possible.`), not bare counts as the brief assumed. Parser adapted to match reality. Added an early-resolve pattern to `dockerRun` to handle macOS Docker Desktop's slow container teardown on stdin-piped operations.
**Why:** Task 5 of the dataset pipeline plan — provides the puzzle source (qqwing generator) and uniqueness gate (solve+count) for the pipeline.
**Files touched:**
- `dataset-pipeline/sandbox/qqwing.Dockerfile` — trusted image definition
- `dataset-pipeline/sandbox/build-qqwing.sh` — build + verify script
- `dataset-pipeline/src/qqwing.ts` — `generate()`, `parseSolveOutput()`, `solveAndCount()`
- `dataset-pipeline/tests/qqwing.test.ts` — 4 tests (all parser paths: unique, multiple, impossible, mixed batch)
- `dataset-pipeline/tests/fixtures/qqwing-solve.txt` — real captured qqwing output
**Verified:** 20/20 tests pass (`npm test`). Integration smoke: `generate("easy", 3)` → 3 puzzles len 81; `solveAndCount` → counts `[1,1,1]`, sol0len 81.

## 2026-06-28 — Phase 3 (v1): Next.js rebuild — playable board on the real engine
**What:** Built a new Next.js front-end in `web/` that plays puzzles through the tested `lib/sudoku-engine.ts`. The new UI has full feature parity with the `index.html` prototype (RTL/Hebrew, iOS look, mobile no-scroll + desktop side panel) but contains **zero game logic** — every action goes to the engine. Difficulty tabs now load real puzzles from `puzzles.json` (the old prototype's tabs were fake).
**Why:** Phase 3 goal — make the engine the single source of truth and kill the duplicate game logic that lived in `index.html`.
**Files touched (all new, under `web/`):**
- Scaffold: `create-next-app` → Next 16 + React 19 + Tailwind v4 + TypeScript, App Router.
- `web/next.config.ts`: set Turbopack/tracing root to the repo root so `web/` can import the root `lib/` engine and `puzzles.json` directly (one engine, not a copy).
- `web/tsconfig.json`: added `@engine` → `../lib/sudoku-engine.ts` and `@puzzles` → `../puzzles.json` path aliases.
- `web/app/globals.css`: ported the prototype's iOS/RTL design tokens + component styles (dropped the ad sidebars — out of scope for v1).
- `web/app/layout.tsx`: RTL root (`lang="he" dir="rtl"`), Hebrew title, viewport/theme-color.
- `web/app/lib/puzzles.ts`: loads `puzzles.json`, picks puzzles by difficulty.
- `web/app/hooks/useSudoku.ts`: the React↔engine bridge — holds one `SudokuEngine`, forwards place/erase/note/undo/hint, runs the timer.
- `web/app/components/`: Header, DifficultyTabs, GameInfo, Board, InputPanel, CompletionModal, Footer.
- `web/app/page.tsx`: orchestrator — difficulty state, keyboard input, share, win/game-over modal.
**Verified:** Playwright smoke test (desktop + mobile) — places correct/wrong digits, notes, hint, undo, difficulty switch, and a full solve that triggers the win modal; zero console errors. `tsc --noEmit` clean. Root engine tests still 5/5 green (unchanged).
**Not in v1 (later phases):** Supabase, login, ads, OCR scanner, Vercel deploy. `index.html` kept as the visual reference until owner confirms parity, then deleted (recoverable from git).

## 2026-06-28 — Phase 2: engine bug fixes (test-driven)
**What:** Fixed 3 engine bugs and added the project's first test suite. All changes written test-first (red → green → refactor).
**Why:** The engine is the core asset; it had real correctness bugs and zero tests.
**Files touched:**
- `lib/sudoku-engine.ts`:
  - ENG-2: `parseGrid` now validates each character and throws on bad input (was silently producing `NaN`).
  - ENG-1: undo now resumes the timer when it un-does the game-ending mistake (was leaving the clock frozen).
  - ENG-3: replaced three hardcoded `3`s with a `maxMistakes` field.
- `tests/engine.test.ts`: new — 5 tests (3 behavior guards + 1 per bug fix).
- `package.json`: `test` script now runs `node --test` (zero new dependencies); set `"type": "module"` to match the engine's ESM source.
- `tsconfig.json`: emit ESM (`module: ESNext`, `moduleResolution: bundler`).
- Updated `docs/BUGS.md` (ENG-1/2/3/5 → fixed).

## 2026-06-28 — Phase 1: foundation cleanup
**What:** Stabilized repo hygiene and added project docs. No app behavior changed.
**Why:** Project had no docs, no build setup, a secret-leak risk, and dead/duplicate files.
**Files touched:**
- Added `.env` + `.env.local` to `.gitignore`; added `.env.example` (closes secret-leak risk — service key could have been committed).
- Deleted `game.html` (~1,370-line near-duplicate of `index.html`, drift-bait).
- Deleted orphaned `dist/` (contained `sudoku-generator.js` built from a source file deleted in `85d983a`).
- Added `tsconfig.json` (first reproducible TS config) and `build`/`typecheck` npm scripts.
- Fixed `package.json` metadata (`description`, `main`, `keywords`).
- Created `docs/` set: STATUS, CHANGELOG, ARCHITECTURE, API, BUGS, DECISIONS.
- Rewrote `README.md` to match reality (name, removed references to nonexistent files, marked scanner as WIP, clarified stack is aspirational).
