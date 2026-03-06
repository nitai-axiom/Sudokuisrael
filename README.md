# Sudokuisrael

A full-stack Hebrew Sudoku platform for Israeli users. Currently an HTML/CSS/TS prototype — targeting production on **Next.js 14 + Supabase + Vercel**.

---

## Repo Structure

```
Site_1/
├── index.html                  # Main responsive game UI prototype (mobile + desktop)
├── game.html                   # Original reference version (superseded by index.html)
├── scanner-test.html           # Test harness for the OCR scanner
│
├── lib/
│   ├── sudoku-engine.ts        # Game engine — core logic, hints, undo, timer
│   └── scanner/                # OCR puzzle scanner (WIP)
│       ├── types.ts            # Shared types (Point, CellResult, ScanResult)
│       ├── image-preprocessing.ts
│       ├── grid-detection.ts
│       └── perspective-transform.ts
│
├── sudoku-generator/           # Rust CLI — generates puzzles + difficulty grading
│   ├── Cargo.toml
│   └── src/main.rs
│
├── puzzles.json                # Sample generated puzzles (5 easy, 5 medium, 5 hard)
├── upload_to_supabase.py       # Bulk-insert puzzles into Supabase
└── .gitignore
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

### 3. Supabase Upload — `upload_to_supabase.py`

Bulk-inserts puzzles from JSON into Supabase.

```bash
# Setup
pip install supabase python-dotenv

# Create .env (NOT committed)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key

# Run
python upload_to_supabase.py puzzles.json
```

Inserts into a `puzzles` table in batches of 50. Expected columns: `puzzle`, `solution`, `difficulty`, `techniques`, `givens`, `created_at` (auto).

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

### 5. OCR Scanner — `lib/scanner/` (WIP)

Camera-based puzzle scanner for importing physical Sudoku puzzles.

- `types.ts` — shared interfaces (`Point`, `CellResult`, `ScanResult`)
- `image-preprocessing.ts` — grayscale, threshold, noise removal
- `grid-detection.ts` — find grid contours in image
- `perspective-transform.ts` — warp grid to square
- `scanner-test.html` — browser test harness

---

## How It All Connects

```
┌─────────────────┐     puzzles.json     ┌──────────────────┐
│  Rust Generator  │ ──────────────────► │  upload_to_       │
│  (sudoku-gen)    │                     │  supabase.py      │
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

1. **Generate** puzzles with the Rust CLI → `puzzles.json`
2. **Upload** to Supabase with the Python script
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
