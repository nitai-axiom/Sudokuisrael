# ARCHITECTURE

## What this is
A Hebrew (RTL) Sudoku platform. Today it's a multi-language prototype, not a deployed app.

## Tech stack (actual, not aspirational)
| Layer | Today | Target |
|---|---|---|
| Game logic | `lib/sudoku-engine.ts` (pure TS, zero deps) | same |
| UI | Next.js 16 + React 19 + Tailwind v4 app in `web/` (imports the engine) | same + Supabase/auth/ads |
| Puzzle data | bundled `puzzles.json` (imported by `web/`) | Supabase |
| Puzzle generation | Rust CLI (`sudoku-generator/`) | same |
| Storage | Supabase (via `upload_to_supabase.py`) | same |
| Hosting | none yet | Vercel |

> `index.html` (the old static prototype) is superseded by `web/` and kept only as a visual reference until parity is signed off, then deleted.

## Project tree
```
sudoku-pipeline/
├── web/                    # ← Next.js front-end (the app). Imports the engine + puzzles from the root.
│   ├── app/
│   │   ├── layout.tsx      # RTL/Hebrew root
│   │   ├── page.tsx        # orchestrator: difficulty, keyboard, modal, share
│   │   ├── globals.css     # ported iOS/RTL design system
│   │   ├── hooks/useSudoku.ts   # the React↔engine bridge (no game logic here)
│   │   ├── lib/puzzles.ts       # loads puzzles.json by difficulty
│   │   └── components/     # Header, DifficultyTabs, GameInfo, Board, InputPanel, CompletionModal, Footer
│   ├── next.config.ts      # Turbopack root = repo root (so web/ can import ../lib + ../puzzles.json)
│   └── tsconfig.json       # @engine / @puzzles path aliases
├── index.html              # OLD prototype — superseded by web/, kept as visual reference (to be deleted).
├── lib/
│   ├── sudoku-engine.ts    # The real game engine (logic, hints, undo, timer) — now the ONLY game logic.
│   └── scanner/            # OCR scanner — WIP ~30%, parked. Image helpers only.
│       ├── types.ts
│       ├── image-preprocessing.ts
│       └── perspective-transform.ts
├── sudoku-generator/       # Rust CLI: generates + grades puzzles
├── puzzles.json            # 15 sample puzzles (5 easy / 5 medium / 5 hard) — imported by web/
├── upload_to_supabase.py   # Bulk-insert puzzles into Supabase
├── tsconfig.json           # TS build config (engine)
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

## The big architectural issue — RESOLVED (Phase 3 v1)
The game used to be implemented **twice**: properly in `lib/sudoku-engine.ts`, and again (worse) as inline JS in `index.html`. As of Phase 3 v1, the new `web/` app plays exclusively through the engine — there is now one implementation. `index.html`'s inline logic is dead; the file remains only as a visual reference until parity is confirmed, then it gets deleted.
