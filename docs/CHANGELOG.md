# CHANGELOG

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
