# ARCHITECTURE

## What this is
A Hebrew (RTL) Sudoku platform. Today it's a multi-language prototype, not a deployed app.

## Tech stack (actual, not aspirational)
| Layer | Today | Target |
|---|---|---|
| Game logic | `lib/sudoku-engine.ts` (pure TS, zero deps) | same |
| UI | Static `index.html` (inline HTML/CSS/JS) | Next.js 14 + Tailwind (not built yet) |
| Puzzle generation | Rust CLI (`sudoku-generator/`) | same |
| Storage | Supabase (via `upload_to_supabase.py`) | same |
| Hosting | none yet | Vercel |

## Project tree
```
sudoku-pipeline/
├── index.html              # UI prototype (RTL, mobile + desktop). Has its OWN game logic — not wired to the engine.
├── lib/
│   ├── sudoku-engine.ts    # The real game engine (logic, hints, undo, timer)
│   └── scanner/            # OCR scanner — WIP ~30%, parked. Image helpers only.
│       ├── types.ts
│       ├── image-preprocessing.ts
│       └── perspective-transform.ts
├── sudoku-generator/       # Rust CLI: generates + grades puzzles
├── puzzles.json            # 15 sample puzzles (5 easy / 5 medium / 5 hard)
├── upload_to_supabase.py   # Bulk-insert puzzles into Supabase
├── tsconfig.json           # TS build config
└── docs/                   # This documentation set
```

## Intended data flow
```
Rust generator → puzzles.json → upload_to_supabase.py → Supabase
                                                            │
                                          (future) Next.js app fetches a puzzle
                                                            │
                                              SudokuEngine plays it client-side
```

## Known architectural issue (the big one)
The game is implemented **twice**: properly in `lib/sudoku-engine.ts`, and again (worse) as inline JS inside `index.html`. The UI currently uses its own copy and ignores the engine. Resolving this — making the engine the single source of truth — is Phase 3 and needs sign-off (see DECISIONS.md).
