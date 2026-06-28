# CHANGELOG

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
