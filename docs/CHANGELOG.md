# CHANGELOG

## 2026-06-29 — First full 8,000-puzzle dataset + two production fixes (incl. CPU/container leak) + medium fun-score upgrade
**What:** Ran the pipeline for the first full production build and produced `sudoku_lower.json` with **8,000 validated puzzles** (very_easy 2,000 · easy 3,000 · medium 3,000; all unique, 0 invalid). Two real failures surfaced during the run and were fixed test-driven + reviewed, then the medium tier's difficulty mix was upgraded.

**Fix 1 — DP-1, generation timeout (commit 77c4bb4):** The first full run aborted on its first batch with `qqwing docker timeout`. Root cause: a single fixed 30s timeout was applied to every Docker call, but `generate` at batch 200 takes 70–103s (qqwing rejection-samples to hit an exact difficulty; `simple` is slowest). Fix: batch-scaled timeouts (`genTimeoutMs`/`solveTimeoutMs`) + a fault-tolerant `buildTier` that retries a failed batch and only aborts after 5 consecutive failures.

**Fix 2 — DP-2, MACHINE / CPU container leak (commit e1ed538):** *This is the machine fix run for the CPU usage.* While the build ran, qqwing containers were **leaking and pinning the CPU** — 34 orphaned containers, each burning ~6% CPU, unbounded, which starved the local Colima VM and was itself causing the DP-1 timeouts. Root cause: the macOS/Colima speed workaround SIGKILLed the Docker **client** process, but under Colima that orphans the **container** running in the VM (`--rm` cleanup is client-driven, so it never fires) — the `qqwing --solve` process then spins forever on a stale stdin pipe. Fix: give every container a unique `--name qqwing-<uuid>` and force-tear-it-down (`docker stop -t 0 <name>`) when the run settles, so the in-VM process always dies. We also cleaned up the 34 already-leaked containers, reclaiming the CPU. Verified: peak **1** concurrent container across the full run, **0** leftover afterward. Net effect: the clean run finished in **~8 minutes** instead of stalling for hours (the earlier slowness was the leak starving the VM, not the work itself).

**Medium fun-score upgrade (commit on top):** Rebalanced the medium tier to favour higher-variety puzzles — dropped 800 `fun_score=3` puzzles and generated 800 fresh `fun_score≥4` mediums (676 fours + 124 fives). Medium mean fun-score 3.31 → 3.62; new tool `dataset-pipeline/bin/upgrade-medium.ts` (+ tested `dropByFunScore` helper) makes this rerunnable.

**Files touched:**
- `dataset-pipeline/src/config.ts` — batch-scaled timeout constants + `MAX_CONSECUTIVE_BATCH_FAILURES`
- `dataset-pipeline/src/qqwing.ts` — parameterised timeouts; named containers + force-teardown on settle (the CPU-leak fix)
- `dataset-pipeline/src/pipeline.ts` — fault-tolerant retry loop with injectable IO deps
- `dataset-pipeline/src/rebalance.ts`, `dataset-pipeline/bin/upgrade-medium.ts` — new; fun-score rebalancing tool
- `dataset-pipeline/tests/` — pipeline retry tests, timeout-helper tests, rebalance tests (48 tests, all green)
- `docs/BUGS.md` — DP-1, DP-2 logged as fixed
**Verified:** 48/48 unit tests; full build wrote 8,000 records (0 dupes, 0 invalid); 0 leaked containers.

## 2026-06-28 — Dataset pipeline Plan 1: foundation + lower tiers complete
**What:** Built the dataset pipeline foundation + all lower-tier generation (very_easy, easy, medium — 8,000 total target records). Two-zone architecture: (1) trusted qqwing Docker container (immutable, `--network none`) for puzzle generation + uniqueness gate; (2) TypeScript host orchestrator + Rust grader for quality gates + technique identification. Implemented resumable per-tier JSONL checkpoints. Rust grader reused with new `--grade` stdin→stdout mode. Schema: puzzle, solution, difficulty, techniques, givens, er_rating (null for lower tiers), fun_score (0–5), generated_at. Verified: `node dataset-pipeline/bin/run-lower.ts --count 20` produced 60 valid records; full test suite 37/37 green.
**Why:** Plan 1 delivers a working dataset pipeline for the three lower difficulty tiers, proven by end-to-end test and production smoke run.
**Files touched:**
- `dataset-pipeline/README.md` — new; full operator guide (prerequisites, smoke run, full run, checkpoints, architecture)
- `dataset-pipeline/src/` — 11 modules across generation, grading, assembly, checkpointing
- `dataset-pipeline/bin/run-lower.ts` — orchestrator entry point
- `dataset-pipeline/tests/` — 10 test files covering all modules (37 tests, all green)
- `docs/CHANGELOG.md`, `docs/STATUS.md`, `docs/ARCHITECTURE.md` — updated for Plan 1 completion
**Out of scope (Plan 2):** hard tier generation, serate ER rating, untrusted JAR sandbox.

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
