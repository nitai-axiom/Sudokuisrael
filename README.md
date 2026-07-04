# Sudokuisrael

A Hebrew Sudoku platform for Israeli users. **Status: prototype.** The game engine and Rust generator work; the UI is a static HTML prototype. Production target (**Next.js 14 + Supabase + Vercel**) is aspirational and not yet built. See [docs/STATUS.md](docs/STATUS.md) for the honest current state.

---

## Repo Structure

```
sudoku-pipeline/
├── index.html                  # Responsive game UI prototype (mobile + desktop)
│
├── lib/
│   ├── sudoku-engine.ts        # Game engine — core logic, hints, undo, timer
│   └── scanner/                # OCR puzzle scanner (WIP ~30%, parked)
│       ├── types.ts            # Shared types (Point, CellResult, ScanResult)
│       ├── image-preprocessing.ts
│       └── perspective-transform.ts
│
├── sudoku-generator/           # Rust CLI — generates puzzles + difficulty grading
│   ├── Cargo.toml
│   └── src/main.rs
│
├── scripts/                     # Puzzle-source generators — ALL read sudoku_150000.json (the sole puzzle source)
│   ├── generate-seed.mjs        # → sudoku_next/supabase/seed.sql (365 daily puzzles, interleaved)
│   ├── generate-cold-start.mjs  # → sudoku_next/app/lib/cold-start-puzzles.ts (12 offline puzzles)
│   ├── generate-sample-puzzles.mjs # → puzzles.json (15 sample puzzles, prototype only)
│   ├── load-supabase.mjs        # streams all 148,206 puzzles into Supabase (service-role key at runtime)
│   └── tests/                   # node --test coverage for the above
│
├── puzzles.json                # Sample generated puzzles (5 easy, 5 medium, 5 hard)
├── sudoku_150000.json          # Shipping dataset: 148,206 puzzles (git-ignored, 68 MB)
├── tsconfig.json               # TypeScript build config
├── docs/                       # Project docs (STATUS, BUGS, DECISIONS, …)
└── .gitignore
```

> **Note:** `index.html` currently runs its own inline game logic and does **not** use `lib/sudoku-engine.ts`. Unifying them is planned — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Build

```bash
npm install
npm run build      # compile lib/*.ts → dist/
npm run typecheck  # type-check only
```

---

## Components

### 1. Game Engine — `lib/sudoku-engine.ts`

Zero-dependency TypeScript class. Drop into any project — works in browser and Node.

```ts
import { SudokuEngine } from './lib/sudoku-engine';

const engine = new SudokuEngine(puzzleStr, solutionStr);
// puzzleStr / solutionStr: 81-char strings, '0' or '.' for empty cells
```

**Key API:**

| Method | Returns | Description |
|--------|---------|-------------|
| `enterDigit(row, col, digit)` | `MoveResult` | Place a digit. Validates against solution. |
| `eraseCell(row, col)` | `void` | Clear a user cell (won't erase givens or correctly solved cells). |
| `toggleNote(row, col, digit)` | `void` | Toggle a pencil mark. |
| `getHint()` | `Hint \| null` | Get a hint using 8 strategies + fallback. Returns `null` if game is over/complete. |
| `undo()` | `boolean` | Undo last action (digit, erase, or note). Returns `false` if nothing to undo. |
| `resetPuzzle()` | `void` | Reset the board to its initial state. |
| `getCandidates(row, col)` | `Set<number>` | Get valid candidates for a cell. |
| `getState()` | `GameState` | Full snapshot (grids, notes, mistakes, timer, etc). |
| `isGiven(row, col)` | `boolean` | Is this a pre-filled cell? |
| `isSolved(row, col)` | `boolean` | Has this cell been correctly filled by the user? |
| `startTimer()` / `pauseTimer()` | `void` | Control the built-in game timer. |
| `getElapsed()` | `number` | Get elapsed time in seconds. |

**Game rules:**
- 3-strike mistake system → `isGameOver`
- Correctly placed digits cannot be erased
- Auto-cleanup: placing a digit removes that number from peer notes
- Completed rows/columns/boxes are detected and reported in `MoveResult.completedUnits`
- Timer auto-pauses on game over or completion

**Hint strategies (in order):**
1. **Naked Single** — only one candidate left in a cell
2. **Hidden Single** — a digit can only go in one place within a unit
3. **Locked Candidates** — candidates confined to a row/col within a box (pointing pairs/triples + box-line reduction)
4. **Naked Pair** — two cells in a unit share the same two candidates
5. **Hidden Pair** — two digits appear in only two cells within a unit
6. **X-Wing** — a digit appears in exactly two positions in two rows/cols forming a rectangle
7. **Y-Wing** — pivot + two wings eliminate a common candidate
8. **Swordfish** — three rows/cols constrain a digit to three columns/rows
9. **Fallback** — reveals the cell with fewest candidates

All hints include Hebrew explanations. The `Hint` type includes:
- `action` — `'place'` or `'eliminate'` (tells UI what the hint is about)
- `targetCell` — where to place/look
- `digit` / `digits` — the relevant number(s)
- `highlightCells` — cells that explain the logic
- `eliminationCells` — cells where candidates can be removed

---

### 2. Puzzle Generator — `sudoku-generator/`

Rust CLI that generates valid Sudoku puzzles with difficulty grading.

```bash
cd sudoku-generator
cargo build --release
./target/release/sudoku-generator --count 100 --output puzzles.json
```

Output format per puzzle:
```json
{
  "puzzle": "290000730...",
  "solution": "296185734...",
  "difficulty": "easy",
  "techniques": ["naked_singles", "hidden_singles"],
  "givens": 23,
  "generated_at": "2026-03-03T16:16:23.602260+00:00"
}
```

Difficulty is graded by which solving techniques are required:
- **easy** — naked singles + hidden singles only
- **medium** — adds locked candidates and/or naked pairs
- **hard** — adds X-Wing, Swordfish, Jellyfish

---

### 3. Puzzle-source generators — `scripts/*.mjs`

`sudoku_150000.json` (148,206 puzzles — very_easy 30,000 / easy 45,000 / medium 45,000 / hard 28,206) is the **sole puzzle source**, everywhere. Four deterministic, unit-tested (`node --test`) scripts all read it directly and regenerate one downstream artifact each:

| Script | Produces | Notes |
|---|---|---|
| `generate-seed.mjs` | `sudoku_next/supabase/seed.sql` | The 365 **daily** puzzles (37 very_easy + 146 easy + 145 medium + 37 hard = 10/40/40/10). Lower tiers picked by `fun_score` DESC then `puzzle` ASC; hard by `er_rating` ASC (gentlest, since hard has no `fun_score`). `position` 1..365 assigned by a deterministic even interleave across tiers. |
| `generate-cold-start.mjs` | `sudoku_next/app/lib/cold-start-puzzles.ts` | The 12-puzzle offline bundle (3 per DB tier, remapped to app labels: very_easy→easy, easy→medium, medium→hard, hard→extreme). |
| `generate-sample-puzzles.mjs` | `puzzles.json` | 15 sample puzzles (5 each easy/medium/hard) — only used by the superseded `web/` prototype so it still builds. |
| `load-supabase.mjs` | live Supabase `puzzles` table | Streams **all 148,206** puzzles via PostgREST (`on_conflict=puzzle`, `resolution=ignore-duplicates`, batches of 500). Takes a service-role key at runtime — never committed. |

Run any of them with plain Node from the repo root, e.g.:

```bash
node scripts/generate-seed.mjs
node scripts/generate-cold-start.mjs
node scripts/generate-sample-puzzles.mjs

SUPABASE_URL='https://<project>.supabase.co' \
SUPABASE_SERVICE_KEY='<service-role-key>' \
node scripts/load-supabase.mjs
```

Loading (or reloading) the **live** Supabase database is a manual operator procedure — see `sudoku_next/docs/RELOAD-RUNBOOK.md` (purge, load, re-stamp daily positions, verify). `scripts/generate-library.mjs` and `upload_to_supabase.py` (the old 10k-era generator + hand-run Python uploader) have been deleted; `load-supabase.mjs` replaces both.

---

### 4. UI Prototype — `index.html`

Single-file responsive HTML/CSS/JS prototype of the game board.

- **Mobile:** `100dvh` no-scroll layout, 1×9 numpad, safe area insets
- **Desktop (≥900px):** 540px board + 290px input panel side-by-side
- **Ad slots:** right sidebar at ≥1100px, left at ≥1320px
- iOS segmented difficulty tabs (mobile) / underline tabs (desktop)
- Full game logic: select, place, highlight, conflict detection, pencil notes, undo, timer, win modal

Design: white background (#F2F2F7), iOS blue accent (#007AFF), RTL throughout.

---

### 5. OCR Scanner — `lib/scanner/` (WIP ~30%, parked)

Intended as a camera-based scanner for importing physical Sudoku puzzles. **Currently only image-processing primitives exist** — there is no grid detection and no digit recognition yet, and nothing imports it. Not on the critical path; parked until the core game ships.

What exists today:
- `types.ts` — shared interfaces (`Point`, `CellResult`, `ScanResult`)
- `image-preprocessing.ts` — grayscale, threshold, noise removal
- `perspective-transform.ts` — warp a grid quad to a square (needs corner detection to feed it)

Still missing: corner/grid detection, cell segmentation, the digit-recognition (OCR) model, and an end-to-end orchestrator + UI entry point.

---

## How It All Connects

```
┌─────────────────┐  sudoku_150000.json  ┌──────────────────┐
│  Dataset         │ ──────────────────► │  scripts/         │
│  pipeline        │                     │  load-supabase.mjs│
└─────────────────┘                     └────────┬─────────┘
                                                 │
                                                 ▼
                                        ┌────────────────┐
                                        │   Supabase DB   │
                                        │  (puzzles table) │
                                        └────────┬────────┘
                                                 │ fetch puzzle
                                                 ▼
┌─────────────────┐                     ┌────────────────────┐
│  OCR Scanner     │ ── scan puzzle ──► │   Next.js App       │
│  (lib/scanner)   │                    │   (index.html now,  │
└─────────────────┘                     │    Next.js later)   │
                                        │                     │
                                        │  ┌───────────────┐  │
                                        │  │ SudokuEngine   │  │
                                        │  │ (client-side)  │  │
                                        │  └───────────────┘  │
                                        └─────────────────────┘
```

1. **Generate/source** puzzles → `sudoku_150000.json` (dataset pipeline), `puzzles.json` (`scripts/generate-sample-puzzles.mjs`, prototype only)
2. **Load** to Supabase with `scripts/load-supabase.mjs`
3. **Serve** a puzzle to the client (Next.js fetches from Supabase)
4. **Play** using `SudokuEngine` — all game logic runs client-side
5. **Scan** (future) — import a physical puzzle via camera

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind CSS |
| Backend | Supabase (PostgreSQL) |
| Hosting | Vercel |
| Puzzle Gen | Rust CLI |
| Game Logic | `SudokuEngine` (pure TS, zero deps) |

---

## Environment Variables

Create a `.env` file (never commit):

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
```
