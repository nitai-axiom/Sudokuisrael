# Sudokuisrael — Pipeline

A full-stack Hebrew Sudoku platform built for Israeli users, targeting production on Next.js + Supabase.
This repository contains the **puzzle generation pipeline** and the **client-side game engine** — everything the Next.js app needs.

---

## Repository Structure

```
sudoku-pipeline/
├── lib/
│   ├── sudoku-generator.ts   # Pure TS puzzle generator (generate + grade puzzles)
│   └── sudoku-engine.ts      # Pure TS game engine (used client-side in Next.js)
├── upload_to_supabase.py     # Python script: bulk-insert puzzles.json → Supabase
├── puzzles.json              # Generated puzzle cache (output of generator)
├── dist/                     # Compiled JS output (git-ignored in production)
└── package.json
```

---

## 1. Puzzle Generator — `lib/sudoku-generator.ts`

Pure TypeScript, zero dependencies. Generates valid, graded Sudoku puzzles.
Can run inside a Next.js API route, a Vercel cron job, or Node.js directly.

### Public API

```ts
import { generatePuzzle, generateBatch } from './lib/sudoku-generator';

// Generate one puzzle (optionally target a difficulty)
const puzzle = generatePuzzle('easy');
// → { puzzle, solution, difficulty, techniques, givens, generated_at }

// Generate a batch
const batch = generateBatch(10, 'medium');
```

### `PuzzleRecord` shape

```ts
interface PuzzleRecord {
  puzzle:       string;    // 81-char string, '0' = empty cell
  solution:     string;    // 81-char string, fully filled
  difficulty:   'easy' | 'medium' | 'hard';
  techniques:   string[];  // e.g. ['naked_singles', 'hidden_singles']
  givens:       number;    // count of pre-filled cells (typically 22–35)
  generated_at: string;    // ISO 8601 timestamp
}
```

### How it works

| Step | Function | Description |
|------|----------|-------------|
| 1 | `fillGrid()` | Randomised backtracking fills a complete valid 9×9 grid |
| 2 | `countSolutions()` | Fast deterministic solver, stops at `max` — used to verify uniqueness |
| 3 | `digHoles()` | Shuffles all 81 positions, removes digits that preserve a unique solution |
| 4 | `gradeDifficulty()` | Simulates human solving with candidate sets; identifies techniques needed |
| 5 | `generatePuzzle()` | Loops steps 1–4 with rejection sampling until difficulty matches |
| 6 | `generateBatch()` | Calls `generatePuzzle()` N times |

### Difficulty grading

| Techniques needed to solve | Difficulty |
|---|---|
| Naked singles (± hidden singles) | `easy` |
| Locked candidates or naked pairs | `medium` |
| Solver gets stuck (requires guessing) | `hard` |

Approximate distribution from random generation: easy ~40%, medium ~45%, hard ~15%.

### Running locally

```bash
cd ~/sudoku-pipeline

# Type-check only (no output files)
./node_modules/.bin/tsc --strict --noEmit --target ES2020 --module commonjs --moduleResolution node lib/sudoku-generator.ts

# Compile + smoke test
./node_modules/.bin/tsc --target ES2020 --module commonjs --moduleResolution node --outDir dist lib/sudoku-generator.ts

node -e "
const { generatePuzzle, generateBatch } = require('./dist/sudoku-generator');
const p = generatePuzzle('easy');
console.log(p.difficulty, p.techniques, 'givens:', p.givens);
const batch = generateBatch(3, 'medium');
console.log('batch:', batch.map(x => x.difficulty));
"
```

### Using from a Next.js API route

```ts
// app/api/generate/route.ts
import { generateBatch } from '@/lib/sudoku-generator';

export async function GET() {
  const puzzles = generateBatch(20, 'easy');
  return Response.json(puzzles);
}
```

---

## 2. Game Engine — `lib/sudoku-engine.ts`

Pure TypeScript class that powers the live game in the browser.
Drop it directly into any Next.js project — no install required.

### Instantiation

```ts
import { SudokuEngine } from './lib/sudoku-engine';

const engine = new SudokuEngine(puzzleRecord.puzzle, puzzleRecord.solution);
```

### Public API

| Method | Description |
|--------|-------------|
| `getState()` | Returns full `GameState` snapshot (safe to pass to React state) |
| `isGiven(row, col)` | `true` if this cell is a pre-filled given |
| `enterDigit(row, col, digit)` | Place a digit; returns `MoveResult` (correct/mistake/gameOver/complete) |
| `eraseCell(row, col)` | Clear a user-entered digit and its notes |
| `toggleNote(row, col, digit)` | Toggle a pencil-mark candidate |
| `getCandidates(row, col)` | Returns `Set<number>` of valid digits for the cell |
| `getHint()` | Returns a `Hint` with Hebrew explanation and cells to highlight |

### `MoveResult`

```ts
interface MoveResult {
  correct:        boolean;
  mistake:        boolean;   // true = wrong digit entered
  gameOver:       boolean;   // true = 3 mistakes reached
  isComplete:     boolean;   // true = puzzle fully solved
  completedUnits: string[];  // e.g. ['row-3', 'col-7', 'box-4']
}
```

### Hint strategies (in priority order)

1. **Naked Single** — only one digit fits in the cell
2. **Hidden Single** — digit can only go in one cell within a unit
3. **Locked Candidates** — digit in a box is confined to one row/col, eliminates it from the rest
4. **Naked Pair** — two cells in a unit share the same two candidates
5. **Fallback** — reveals the cell with the fewest candidates

All hints include a Hebrew `explanation` string and a `highlightCells` list for UI rendering.

### Key behaviours

- **3-strike system**: `mistakes >= 3` sets `isGameOver = true`
- **Auto-cleanup notes**: placing a digit removes it from all peer cells' pencil marks
- **Unit completion**: `completedUnits` tracks which rows/cols/boxes are done (for animations)
- Accepts both `'0'` and `'.'` as empty-cell markers in puzzle strings

---

## 3. Upload to Supabase — `upload_to_supabase.py`

Bulk-inserts a `puzzles.json` file into the Supabase `puzzles` table.

### Setup

```bash
pip install supabase python-dotenv
```

Create a `.env` file:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
```

### Usage

```bash
# Generate puzzles first (or use existing puzzles.json)
python upload_to_supabase.py puzzles.json
```

Inserts in batches of 50. Prints progress and a final count.

### Expected table schema

```sql
create table puzzles (
  id           uuid primary key default gen_random_uuid(),
  puzzle       text not null,
  solution     text not null,
  difficulty   text not null check (difficulty in ('easy', 'medium', 'hard')),
  techniques   text[] not null,
  givens       int not null,
  generated_at timestamptz not null
);
```

---

## 4. Full Pipeline (end-to-end)

```
generateBatch() → puzzles.json → upload_to_supabase.py → Supabase → Next.js app
```

Or inline from a Next.js API route / Vercel cron:

```
generateBatch() → insert directly via Supabase JS client
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Generator | Pure TypeScript (no deps) |
| Game engine | Pure TypeScript (no deps) |
| Backend | Supabase (PostgreSQL) |
| Upload script | Python 3 + `supabase-py` |
| Frontend | Next.js 14 App Router + TypeScript + Tailwind CSS |
| Hosting | Vercel |

---

## Design Notes

- All text is **Hebrew-first, RTL** (`dir="rtl"`, `lang="he"`)
- Hint explanations are in Hebrew
- Touch targets minimum 40px (senior-friendly)
- Target audience: Israeli users
