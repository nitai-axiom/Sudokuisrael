# DECISIONS

## 2026-06-29 — serate built with `javac`, not Maven (Plan 2 Task 1)
**Context:** The hard-tier sandbox image must build serate FROM SOURCE at a pinned commit (security rule: no opaque binary). The plan/brief assumed SukakuExplainer is a Maven project and used `mvn package`. At the pinned commit `362854e` the repo has NO `pom.xml` and NO `build.xml` — it's an Eclipse project (raw `.java` under `diuf/`, plus `.classpath`/`.project`). `mvn package` fails ("no POM").
**Options considered:** (A) compile from source directly with the JDK 17 already in the base image (`javac` + `jar`); (B) download a prebuilt release JAR and pin its SHA-256 like HoDoKu.
**Decision:** A. Option B was rejected — it violates the non-negotiable "build from source, don't trust an opaque binary" rule. Option A honors that rule; the commit-SHA integrity pin and commit-drift build gate are unchanged. It's also lighter on the 2 GB Colima box (no Maven dependency resolution; no OOM).
**Impact:** Build-mechanism change only; security posture identical. serate's runnable artifact is a hand-built `serate.jar` with Main-Class `diuf.sudoku.test.serate` (run via `-cp /opt/serate.jar diuf.sudoku.test.serate`). Tasks 2–3 wrappers use the entrypoints/usage captured in `.superpowers/sdd/task-1-report.md`.

## 2026-06-28 — Phase 1 scope: cleanup before code surgery
**Context:** Full audit found duplication, no docs, no build, a secret-leak risk, and engine bugs.
**Options considered:** (A) Phase 1 cleanup only; (B) cleanup + engine fixes; (C) everything incl. UI rewire.
**Decision:** A — do the safe, reversible foundation work first; check in before touching engine/UI.
**Impact:** This phase changes no app behavior. Engine/UI work is gated behind explicit approval.

## 2026-06-28 — Delete game.html
**Context:** `game.html` was an ~85% duplicate of `index.html`, already drifting.
**Decision:** Deleted. `index.html` is the single UI prototype.
**Impact:** Removes ~1,370 lines of drift-bait. Recoverable from git history if ever needed.

## 2026-06-28 — Keep the OCR scanner, finish later
**Context:** Scanner is ~30% done (image helpers only; no grid detection, no digit recognition) and wired to nothing. The ponytail audit flagged it for deletion as dead code.
**Decision:** Keep it. Owner chose to finish it later, not cut it. **(Owner decision overrides the tooling recommendation.)**
**Impact:** Stays in `lib/scanner/`, documented honestly as parked WIP. Not on the critical path to shipping the core game.

## 2026-06-28 — Engine as single source of truth (APPROVED, built in Phase 3 v1)
**Context:** The game is implemented twice — properly in `lib/sudoku-engine.ts`, and again as weaker inline JS in `index.html`.
**Options:** (A) make the engine canonical and delete the inline duplicate; (B) keep both; (C) delete the engine, keep inline.
**Decision:** A — approved by owner ("lets roll"). Built in Phase 3 v1: the new `web/` Next.js app plays through the engine; no game logic in the UI.
**Impact:** One implementation going forward. `index.html`'s inline logic is now superseded; the file is deleted once owner confirms visual parity.

## 2026-06-28 — Phase 3: where the Next.js app lives
**Context:** Needed a home for the new front-end without tangling Next's config into the working Rust/Python/test setup.
**Options:** (A) new `web/` folder, engine stays at repo root and is imported; (B) turn the repo root into the Next app.
**Decision:** A — `web/` folder. Engine, Rust generator, Python uploader, `puzzles.json`, and tests stay untouched at the root; only the front-end is new. Turbopack's workspace root is pointed at the repo root so `web/` imports the root engine/puzzles directly (no copy).
**Impact:** Small blast radius. The one engine is imported, never duplicated.

## 2026-06-28 — Phase 3: styling approach (port the prototype CSS, not a full utility rewrite)
**Context:** The plan said "rebuilt in Tailwind." The prototype has ~800 lines of finely-tuned, responsive, RTL, iOS-styled CSS.
**Options:** (A) port the proven design-token CSS into `globals.css` and reference it from components; (B) rewrite every rule as Tailwind utility classes.
**Decision:** A — Tailwind v4 is set up and used, but the design system itself is the ported CSS. A full utility rewrite would be churn with real regression risk and no visual gain ("lean by design" was an explicit v1 principle).
**Impact:** Pixel parity achieved fast and safely. Tailwind utilities are available for future components.

## 2026-06-28 — Phase 3: difficulty tabs = 3 levels (dropped "expert")
**Context:** The prototype had 4 tabs (קל/בינוני/קשה/מומחה) but `puzzles.json` only has easy/medium/hard.
**Decision:** Ship 3 real tabs so difficulty actually loads a matching puzzle. "Expert" returns when the dataset has expert puzzles.
**Impact:** Difficulty is now functional instead of fake. One fewer (empty) tab than the prototype.

## 2026-06-28 — Phase 3: hint behaviour in v1 (reveal a cell)
**Context:** `engine.getHint()` returns the smartest next step, but "eliminate" hints describe note removals the engine can't apply yet (ENG-4 is open).
**Decision:** For v1, the hint button asks the engine which cell to act on, then reveals that cell's correct value (undoable, counts as a hint). Simple and always useful.
**Impact:** Hint always advances the board. Richer technique-explaining hints wait on ENG-4 (the hint/notes design).

## 2026-06-29 — Plan 2: drop 180° symmetry gate for the HARD tier (reverses earlier locked decision)
**Context:** The 2026-06-29 locked decision said "180° symmetry enforced for hard; if HoDoKu can't generate symmetric, the gate post-filters and we accept the lower yield." Task 2 then confirmed HoDoKu cannot generate symmetric puzzles (bytecode: `generateSudoku(false)` hardcoded). An empirical run measured **0/200 (0.0%)** HoDoKu puzzles as 180°-symmetric — so the gate would reject 100% of candidates and the hard tier could never be built (buildHardTier would hit its 100k-round guard and throw).
**Options:** (A) Drop the symmetry gate for hard only — build from HoDoKu + serate ER 3.4–5.0; (B) Keep symmetry but switch hard generation to qqwing's hardest symmetric puzzles filtered to the ER band (unknown/likely-low yield, abandons HoDoKu technique-targeting); (C) Keep gate, accept ~0 hard puzzles (no hard tier).
**Decision:** A — owner chose to drop `isSymmetric180` from `acceptHard` for the hard tier. Lower tiers stay rotate180-symmetric (qqwing); hard is asymmetric.
**Impact:** Hard tier is now buildable. Difficulty still comes from the serate ER band, uniqueness from qqwing `count-solutions`, clue-floor still enforced. Aesthetic only: hard puzzles lack the mirror symmetry of the easier tiers. The "never relax the gate" instruction is explicitly superseded by this owner decision for the hard tier.
