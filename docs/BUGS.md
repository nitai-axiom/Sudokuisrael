# BUGS

Status legend: 🔴 open · 🟡 in progress · ✅ fixed

Found during the 2026-06-28 audit. None fixed yet (Phase 1 was cleanup-only). Fixes scheduled for Phase 2+.

## Engine (`lib/sudoku-engine.ts`)
| ID | Sev | Status | Bug | Root cause / fix |
|----|-----|--------|-----|------------------|
| ENG-1 | High | 🔴 | Undo can revive a game-over state but leaves the timer frozen | `undo()` recomputes `isGameOver` from mistakes but never restarts the timer. Restart timer when game goes back to non-over. |
| ENG-2 | High | 🔴 | Bad input (non-digit chars) silently becomes `NaN` and poisons all comparisons | `parseGrid` uses `parseInt` without validating each char. Validate `.`/`0`-`9`, throw otherwise. |
| ENG-3 | Med | 🔴 | Mistake limit hardcoded as `3` in 3 places + a fake `maxMistakes:3` in `getState()` backed by no field | Add `private maxMistakes = 3` and reference it. |
| ENG-4 | Med | 🔴 | "Eliminate" hints (locked candidates, pairs, X-Wing, Y-Wing, Swordfish) describe eliminations but never mutate notes; assume perfect pencilmarks | Either wire hints to note state or document them as advisory only. |
| ENG-5 | Low | 🔴 | No tests at all despite the class being pure and trivially testable | Add a test suite (Phase 2). |

## UI (`index.html`)
| ID | Sev | Status | Bug | Root cause / fix |
|----|-----|--------|-----|------------------|
| UI-1 | High | 🔴 | UI uses its own duplicate game logic, not the engine; "hint" needs a hardcoded answer key | Wire UI to `SudokuEngine` (Phase 3, needs approval). |
| UI-2 | High | 🔴 | Wrong digit is placed but never reverted, and there's no game-over → board can reach unwinnable state with no feedback | Use engine's `enterDigit`/`MoveResult`. |
| UI-3 | Med | 🔴 | Difficulty tabs reload the same hardcoded puzzle; difficulty is non-functional | Load a puzzle per difficulty from dataset/DB. |
| UI-4 | Med | 🔴 | `navigator.share?.(…) ?? clipboard` has broken precedence; fragile cross-browser share | Use explicit `if (navigator.share)` else clipboard. |

## Python uploader (`upload_to_supabase.py`)
| ID | Sev | Status | Bug | Root cause / fix |
|----|-----|--------|-----|------------------|
| PY-1 | High | 🔴 | No idempotency — re-running duplicates every puzzle | Add UNIQUE on `puzzle` + `.upsert(on_conflict="puzzle")`. |
| PY-2 | High | 🔴 | No error handling/retries — a blip aborts mid-run, non-resumable | try/except + retry/backoff; track offset. |
| PY-3 | Med | 🔴 | No per-record validation — malformed record → `KeyError` mid-batch | Validate keys + 81-char length before upload. |

## Rust generator (`sudoku-generator/`)
| ID | Sev | Status | Bug | Root cause / fix |
|----|-----|--------|-----|------------------|
| RS-1 | Med | 🔴 | "Hard" generation uses generate-then-reject (~1,749 attempts per 3 hard puzzles); `--count 100 --difficulty hard` is very slow | Generate once, grade once, bucket into all tiers in one pass. |
