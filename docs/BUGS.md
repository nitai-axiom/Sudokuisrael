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

## Dataset pipeline (`dataset-pipeline/`)
Found during the first full 8,000-puzzle run (2026-06-29). Both fixed test-driven + reviewed.
| ID | Sev | Status | Bug | Root cause / fix |
|----|-----|--------|-----|------------------|
| DP-1 | High | ✅ | Full run aborted on first batch with `qqwing docker timeout` | Single fixed 30s timeout applied to every docker call, but `generate` at batch 200 takes 70–103s (qqwing rejection-samples difficulty; `simple` is slowest). Fix (commit 77c4bb4): batch-scaled timeouts (`genTimeoutMs`/`solveTimeoutMs`) + fault-tolerant `buildTier` (try/catch retry, abort only after `MAX_CONSECUTIVE_BATCH_FAILURES=5`). |
| DP-2 | High | ✅ | qqwing containers leaked under Colima — ~6% CPU each, 34 orphaned, unbounded; starved the VM and caused DP-1 timeouts | Early-resolve SIGKILLed the docker *client*, but under Colima that orphans the *container* (`--rm` is client-driven, never fires). Fix (commit e1ed538): name each run `qqwing-<uuid>` + `docker stop -t 0 <name>` teardown on settle. Verified: peak 1 concurrent container, 0 leftover. **Plan 2:** same fix extracted to shared `src/docker.ts` and applied to the HoDoKu/serate runs (commit 4355a1e); 0 leaked containers across the full 10k run. |
| DP-3 | Med | ✅ | Plan 2 risk: `buildHardTier` (the longest, most timeout-prone tier) lacked the fault-tolerance the lower tiers had — one slow serate batch would abort the multi-hour run | Caught by the final whole-branch review before the full build. Fix (commit 493496c): try/catch + `MAX_CONSECUTIVE_BATCH_FAILURES` retry + wrapper-length guard (mirrors `buildTier`); serate timeout now scales per-puzzle (`SERATE_TIMEOUT_PER_PUZZLE_MS`). |

### Plan 2 — HoDoKu / serate tool quirks (characterization, not bugs)
- **HoDoKu cannot generate 180°-symmetric puzzles.** Bytecode shows `generateSudoku(false)` hardcoded; empirically 0/200 generated puzzles were symmetric. → symmetry gate dropped for the hard tier (owner decision; see DECISIONS). Lower tiers (qqwing) are still symmetric.
- **serate is not a Maven project at the pinned commit** (no pom.xml — Eclipse-layout raw .java). Built from source with `javac`+`jar` instead of `mvn package`; commit-SHA integrity pin + drift guard intact (see DECISIONS). Entrypoint is `diuf.sudoku.test.serate` via `-cp`, not `-jar`.
- **HoDoKu needs `docker run -i`** (stdin kept open) or it generates 0 puzzles; it streams indefinitely, so the wrapper early-resolves once enough puzzles are collected and has an absolute kill-timeout backstop.
- **Hard ER distribution skews low within the band:** observed hard ER 3.4–4.6 (band allows up to 5.0) and only ~30% of HoDoKu `bf2,bf3,xy` candidates land in 3.4–5.0 (range seen 3.2–8.5). The hard tier over-generates ~3× as a result — expected, not a fault. serate `0.0` (processing error) / `20.0` (unsolvable) sentinels are naturally rejected by the band filter.
