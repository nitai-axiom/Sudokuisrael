# BUGS

Status legend: 🔴 open · 🟡 in progress · ✅ fixed

Found during the 2026-06-28 audit. Engine bugs ENG-1/2/3/5 fixed in Phase 2 (test-driven); UI/Python/Rust bugs still open.

## Engine (`lib/sudoku-engine.ts`)
| ID | Sev | Status | Bug | Root cause / fix |
|----|-----|--------|-----|------------------|
| ENG-1 | High | ✅ | Undo could revive a game-over state but leave the timer frozen | Fixed: snapshots `timerRunning`; `undo()` resumes the clock when the game returns to live. Test: "undo after game-over resumes the timer". |
| ENG-2 | High | ✅ | Bad input (non-digit chars) silently became `NaN` and poisoned all comparisons | Fixed: `parseGrid` now validates each char (`.`/`0`-`9`) and throws otherwise. Test: "constructor rejects a grid with non-digit characters". |
| ENG-3 | Med | ✅ | Mistake limit hardcoded as `3` in 3 places + a fake `maxMistakes:3` in `getState()` backed by no field | Fixed: added `private readonly maxMistakes = 3`, referenced everywhere. |
| ENG-4 | Med | 🔴 | "Eliminate" hints (locked candidates, pairs, X-Wing, Y-Wing, Swordfish) describe eliminations but never mutate notes; assume perfect pencilmarks | Open. Either wire hints to note state or document them as advisory only. Deferred — tied to the hint/notes design. |
| ENG-5 | Low | ✅ | No tests at all despite the class being pure and trivially testable | Fixed: `tests/engine.test.ts` added (5 tests). Run with `npm test`. More coverage to follow. |

## UI
The new `web/` Next.js app (Phase 3 v1) resolves all four. These bugs still physically exist in the old `index.html`, but it's superseded and slated for deletion, so they no longer matter.
| ID | Sev | Status | Bug | Root cause / fix |
|----|-----|--------|-----|------------------|
| UI-1 | High | ✅ | UI used its own duplicate game logic, not the engine; "hint" needed a hardcoded answer key | Fixed in `web/`: `useSudoku` drives a real `SudokuEngine`; hint uses `engine.getHint()`. |
| UI-2 | High | ✅ | Wrong digit was placed but never reverted, and there was no game-over → unwinnable board, no feedback | Fixed in `web/`: engine `enterDigit` refuses wrong digits (counts a mistake + flash); game-over modal at 3 mistakes. |
| UI-3 | Med | ✅ | Difficulty tabs reloaded the same hardcoded puzzle; difficulty was non-functional | Fixed in `web/`: tabs load a real puzzle of that difficulty from `puzzles.json`. |
| UI-4 | Med | ✅ | `navigator.share?.(…) ?? clipboard` had broken precedence; fragile cross-browser share | Fixed in `web/`: explicit `if (navigator.share)` else clipboard. |

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
