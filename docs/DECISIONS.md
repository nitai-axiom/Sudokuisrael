# DECISIONS

## 2026-07-04 — Replace ALL puzzle sources with `sudoku_150000.json`; daily-365; streaming Supabase load
**Context:** With the recalibrated 148,206-puzzle dataset validated (2026-07-03), every other puzzle surface still ran on older/smaller data: the online Supabase pool was unloaded, the Daily was a 2-tier design (migration `0010_interleave_daily.sql`), the offline cold-start bundle and the `web/` prototype sample predated the recalibration, and the reference Supabase loader was a hand-run Python script with no idempotency (PY-1/2/3 in BUGS.md). Needed to decide: how much of the 148,206 goes online, how to purge the stale online data, the daily tier split, the load mechanism, and whether to keep the superseded 10k-era files.
**Options considered (online pool size):** (A) load all 148,206; (B) load a curated subset to save storage/cost.
**Decision:** **A — load all 148,206.** Owner: no reason to hold puzzles back pre-launch; storage cost is negligible.
**Options considered (purge mechanism):** (A) hard reset — `truncate public.puzzles restart identity cascade` (also clears `public.solves` via FK); (B) soft migration that preserves existing rows/ids and upserts on top.
**Decision:** **A — hard reset.** Pre-launch, no real user progress to protect; simplest and gives clean sequential ids for the new load. Documented as destructive in `sudoku_next/docs/RELOAD-RUNBOOK.md` with an explicit "confirm no real user progress" checkpoint.
**Options considered (load mechanism):** (A) a streaming script that POSTs batches to Supabase's PostgREST endpoint at runtime with a service-role key; (B) generate and commit a single large SQL file (as the old `puzzles_library.sql` did for the 10k set) and run it via psql/SQL editor.
**Decision:** **A — streaming loader (`scripts/load-supabase.mjs`).** A committed SQL file for 148,206 rows would be a ~50MB+ commit (the old 10k version was already large) and would need regenerating and re-committing on every dataset change; a script that reads `sudoku_150000.json` (already gitignored, already the source of truth) and streams it in batches of 500 with `on_conflict=puzzle` + `resolution=ignore-duplicates` is idempotent, re-runnable, and keeps no large data in git. Deleted `sudoku_next/supabase/puzzles_library.sql` and this repo's `generate-library.mjs`/`upload_to_supabase.py` accordingly.
**Options considered (daily tier split):** (A) keep the existing 2-tier daily design; (B) 10/40/40/10 across all four tiers (very_easy/easy/medium/hard), matching the online pool's overall shape more closely while still weighting toward the middle; (C) even 25/25/25/25.
**Decision:** **B — 37/146/145/37 across 365 days** (10/40/40/10, rounded to whole days). Weighted toward easy/medium so the daily stays broadly approachable, with very_easy and hard as the minority "light" and "challenge" days. Positions 1..365 are assigned by a deterministic even (Bresenham-style) interleave across tiers, not a block ordering, so difficulty varies day-to-day.
**Options considered (which hard puzzle each day gets, since hard has no `fun_score`):** (A) gentlest — lowest serate `er_rating` first; (B) hardest — highest `er_rating` first; (C) random within tier.
**Decision:** **A — gentlest.** Consistent with the 2026-07-03 recalibration's whole point (owner: hard tier should be "fair but fun," not obscure) — the daily hard pick should lean toward the approachable end of the already-tuned 3.4–4.5 ER band, not the hardest end of it.
**Options considered (legacy files):** (A) leave the superseded 10k dataset/generators/loader in place alongside the new ones; (B) delete them now that nothing depends on them.
**Decision:** **B — delete.** Removed `scripts/generate-library.mjs`, `upload_to_supabase.py`, `sudoku_10000.json`, `sudoku_lower.json` (this repo) and `sudoku_next/supabase/puzzles_library.sql` (sibling repo). Owner: purge the legacy pipeline files too, not just add the new ones — avoids a repo with two competing "how do puzzles get online" stories.
**Impact:** `sudoku_150000.json` is now the sole puzzle source for the Daily (365, interleaved), the offline cold-start bundle (12), the `web/` prototype sample (15), and the online Supabase pool (all 148,206) — all four generated/loaded by deterministic, unit-tested scripts in `scripts/`. The actual live Supabase reload remains a **manual operator step** (needs the service-role key, which is intentionally not in the app's `.env.local`); procedure documented in `sudoku_next/docs/RELOAD-RUNBOOK.md`. Migration `0010_interleave_daily.sql` is superseded — `seed.sql` now owns the interleaved positions — and must not be re-run against a loaded table. App code and Supabase schema/migrations were not touched. Full design + plan: `docs/superpowers/specs/2026-07-03-replace-all-puzzles-150k-daily-365-design.md`, `docs/superpowers/plans/2026-07-04-replace-all-puzzles-150k-daily-365.md`.

## 2026-07-03 — Recalibrate difficulty from the Kaggle 3M dataset (fun over generated)
**Context:** Owner: "the games are too difficult and not so fun — entry feels too hard, hard feels not fun." The generated hard tier (HoDoKu technique-targeted, serate ER 3.4–5.0) reached into the obscure-technique zone; lower tiers could drop to minimal clues.
**Options considered:** (A) trust Kaggle's own ratings and re-bucket; (B) re-rate all 3M with our serate engine (~5 days — infeasible); (C) hybrid — cheap pre-filter of the 3M by Kaggle clues+difficulty, then re-validate/re-rate only the finalists with our trusted graders.
**Decision:** **C (hybrid).** Source from Kaggle "3-million-sudoku-puzzles-with-ratings" (radcliffe), fetched + filtered **entirely in the sandbox** (raw 536 MB CSV lives only in a Docker volume, never on host; Bearer/KGAT token passed in at runtime). Re-validate with qqwing (uniqueness), Rust grader (lower tiers), serate (hard ER). 150,000 target, 4 tiers, sequential `id` + `source_id` per record.
**Calibration finding (the pivotal one):** the dataset is **bimodal** — puzzles are either straightforward (serate ER < 2.8) or jump to obscure (ER ≥ 4.5, often ≥ 7). "Fair-hard" (ER ~2.8–3.8) is scarce (~5–11%) regardless of clue count or Kaggle-difficulty band. Kaggle's own "hard" (diff 3+) maps to serate ER ~7 — exactly the un-fun kind, which validated the owner's complaint.
**Owner sub-decisions:** hard = **"slightly harder for volume"** → serate ER band **[3.4, 4.5]** (wings/fish, pure logic, no guessing; excludes ER>4.5 coloring/deep-chains). Kept final **148,206** (hard 28,206 after cross-tier dedup) rather than topping up to exactly 30k.
**Design consequences:** medium & hard **share** a pre-filter band and are split by the graders (Rust-medium vs serate 3.4–4.5); very_easy/easy bands made **disjoint by clue count** to stop cross-tier dedup from cannibalizing `easy`; the Rust solvable-gate is dropped for hard (a serate ER in-band already proves logical solvability — Rust returns null past its medium repertoire).
**Impact:** New `sudoku_150000.json` (148,206 records, 0 dup / 0 malformed, hard ER 3.4–4.5 median 4.2) is the shipping dataset for the game. Entry is now genuinely gentle (very_easy = 25–26 clues, pure singles). The old `sudoku_10000.json` + HoDoKu hard tier remain in the repo but are superseded. Spec + plan under `docs/superpowers/`.

## 2026-06-29 — Serve puzzles via Supabase; rebuild the site in a fresh repo
**Context:** Asked how the 10,000-puzzle dataset gets pulled and where it lives. Today it's a flat 4.1 MB file (`sudoku_10000.json`) used by nothing — the game still bundles the old 6 KB `puzzles.json`. Needed to decide the storage/serving model before wiring anything.
**Options considered:** (A) bundle the JSON in the app — zero infra, but no per-user memory; (B) host the file and fetch on demand — marginal gain over A; (C) Supabase DB — real infra, but enables accounts/progress/leaderboards/ads.
**Decision:** **C (Supabase).** Owner wants accounts/progress-class features and chose to rebuild + deploy the whole site from scratch rather than retrofit the current app. First concrete step taken: created the new private repo **`sudoku_next`** seeded with a self-contained copy of `web/` (see CHANGELOG). My standing recommendation had been A-for-now, but owner opted for the DB path deliberately.
**Impact:** Future game work happens in `nitai-axiom/sudoku_next`, not this pipeline repo. This repo remains the dataset/pipeline source; the new repo will fetch puzzles from Supabase (dataset to be loaded there). `upload_to_supabase.py` here is the reference loader.

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
