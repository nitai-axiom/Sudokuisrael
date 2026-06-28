# DECISIONS

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

## 2026-06-28 — Engine as single source of truth (PENDING)
**Context:** The game is implemented twice — properly in `lib/sudoku-engine.ts`, and again as weaker inline JS in `index.html`.
**Options:** (A) make the engine canonical and delete the inline duplicate; (B) keep both; (C) delete the engine, keep inline.
**Recommendation:** A. The engine is the better implementation and the intended one.
**Status:** NOT YET APPROVED. This is the Phase 3 architectural decision — needs owner sign-off before work starts.
