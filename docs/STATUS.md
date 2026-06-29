# STATUS

**Last updated:** 2026-06-29
**Phase:** Phase 3 (v1) done. Dataset pipeline Plans 1 + 2 complete — **full 10,000-puzzle four-tier dataset produced and validated.**

## One-line state
There is now ONE game: a Next.js app in `web/` that plays through the tested engine. The duplicate logic in `index.html` is superseded (kept only as a visual reference until parity is signed off). The dataset pipeline has produced the complete **10,000-puzzle** dataset (`sudoku_10000.json`: very_easy 2,000 · easy 3,000 · medium 3,000 · hard 2,000; **0 duplicates, 0 malformed, all unique + validated**). The hard tier comes from sandboxed HoDoKu + serate ER rating (band 3.4–5.0), re-validated for uniqueness by the trusted qqwing container.

## What's working
| Component | State | Notes |
|---|---|---|
| Dataset pipeline (`dataset-pipeline/`) | ✅ Plans 1 + 2 done; **10,000 produced** | Full four-tier dataset → `sudoku_10000.json` (0 dup, 0 malformed). Lower tiers: trusted qqwing + Rust grader, rotate180-symmetric. Hard tier: sandboxed HoDoKu (technique-targeted) + serate ER rating (3.4–5.0), trusted-qqwing uniqueness re-validation, symmetry dropped (HoDoKu yields 0/200 symmetric — owner decision). DP-2 container-leak fix carried over via shared `src/docker.ts` (0 leaked containers across the full ~17-min run). 71 tests green. |
| Next.js app (`web/`) | ✅ v1 playable | Real engine, RTL/Hebrew, mobile + desktop. Difficulty loads real puzzles. Verified by browser smoke test. |
| Game engine (`lib/sudoku-engine.ts`) | ✅ Works, tested | Now the single source of game logic. 5 tests (`npm test`). ENG-4 (hint/notes) still open. |
| Rust puzzle generator (`sudoku-generator/`) | ✅ Works, extended | Base generates graded puzzles; new `--grade` mode added for dataset pipeline. |
| `index.html` prototype | ⚠️ Superseded | Kept as visual reference only. Delete once owner confirms parity (RS/UI bugs in it no longer matter). |
| Python uploader (`upload_to_supabase.py`) | ⚠️ Works once, by hand | Unchanged. See BUGS.md (PY-1/2/3). |
| OCR scanner (`lib/scanner/`) | 🟥 WIP ~30% | Parked. |

## In progress
- Nothing actively in progress. Phase 3 v1 complete; Dataset pipeline Plans 1 + 2 complete; full 10,000 dataset generated on branch `feat/dataset-pipeline-plan2` (awaiting merge).

## Machine/ops note (2026-06-29)
- The DP-2 **container-leak fix is now applied to ALL pipeline tools** (qqwing + the Plan 2 HoDoKu/serate runs), via a shared named-container + `docker stop -t 0` force-reaper (`dataset-pipeline/src/docker.ts`). Under Colima, `--rm` alone orphans containers when the client is killed; the named force-stop is what reaps them. Verified **0 leaked containers** across the full 10k run. If you ever see strays, clean with `docker ps -aq --filter name=hodoku- --filter name=qqwing- --filter name=sandbox- | xargs docker stop -t 0`.
- serate is the hard-tier bottleneck (~155 ms/puzzle on the 2-CPU/2GB VM; only ~30% of HoDoKu candidates land in the ER band), so the hard tier over-generates ~3×. Its container timeout scales per-puzzle and a slow batch is retried, not fatal. Full 10k build ≈ 17 min on this VM.

## Blocked / decisions needed
- **Delete `index.html`?** v1 has reached parity. Awaiting owner OK to delete it (recoverable from git). This is the final step that makes "one implementation" literal.

## Next steps
| # | Step | Phase |
|---|------|-------|
| 1 | ~~Wire UI to `SudokuEngine`, load real puzzles per difficulty~~ ✅ done (web/) | 3 |
| 2 | Confirm parity → delete `index.html` | 3 (needs OK) |
| 3 | ~~Dataset Plan 2: hard tier + serate ER rating (untrusted sandbox)~~ ✅ done — full 10k dataset | Pipeline |
| 4 | Resolve ENG-4 (decide if hints mutate notes) → richer hints | 2/3 |
| 5 | Supabase: fetch puzzles from DB instead of bundled `puzzles.json` | 4 |
| 6 | Harden Python uploader (retries, idempotent upsert) | 4 |
| 7 | Deploy to Vercel; login/accounts; ads | later |
| 8 | Resume OCR scanner (grid detection + digit recognition) | later |
