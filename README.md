# Sudokuisrael — Game Engine

`lib/sudoku-engine.ts` — pure TypeScript, zero dependencies.
Powers the live Sudoku game client-side in the Next.js app.

---

## Instantiation

```ts
import { SudokuEngine } from './lib/sudoku-engine';

const engine = new SudokuEngine(puzzleStr, solutionStr);
// puzzleStr / solutionStr: 81-char strings, '0' or '.' = empty
```

---

## Public API

| Method | Returns | Description |
|--------|---------|-------------|
| `getState()` | `GameState` | Full snapshot of current game state |
| `isGiven(row, col)` | `boolean` | `true` if cell is a pre-filled given |
| `enterDigit(row, col, digit)` | `MoveResult` | Place a digit; validates against solution |
| `eraseCell(row, col)` | `void` | Clear a user-entered digit and its notes |
| `toggleNote(row, col, digit)` | `void` | Toggle a pencil-mark candidate |
| `getCandidates(row, col)` | `Set<number>` | Valid digits for an empty cell |
| `getHint()` | `Hint` | Next logical move with Hebrew explanation |

---

## Types

### `GameState`
```ts
interface GameState {
  puzzle:         Grid;         // original givens (0 = empty)
  solution:       Grid;         // full solution
  userGrid:       Grid;         // current player state
  notes:          Notes;        // pencil marks per cell
  mistakes:       number;       // 0–3
  hintsUsed:      number;
  isGameOver:     boolean;      // true when mistakes === 3
  isComplete:     boolean;      // true when puzzle fully solved
  completedUnits: Set<string>;  // e.g. 'row-3', 'col-7', 'box-4'
}
```

### `MoveResult`
```ts
interface MoveResult {
  correct:        boolean;
  mistake:        boolean;   // wrong digit entered
  gameOver:       boolean;   // 3 mistakes reached
  isComplete:     boolean;   // puzzle fully solved
  completedUnits: string[];  // units completed by this move
}
```

### `Hint`
```ts
interface Hint {
  type:           'naked_single' | 'hidden_single' | 'locked_candidates' | 'naked_pair' | 'fallback';
  targetCell:     [row, col];
  digit:          number;
  explanation:    string;        // Hebrew explanation for the player
  highlightCells: [row, col][];  // cells to highlight in the UI
}
```

---

## Hint Strategies

Applied in priority order until one fires:

| Priority | Strategy | Logic |
|----------|----------|-------|
| 1 | **Naked Single** | Only one digit fits in the cell |
| 2 | **Hidden Single** | A digit has only one valid cell in a row/col/box |
| 3 | **Locked Candidates** | A digit in a box is confined to one row/col — eliminates it from the rest of that line |
| 4 | **Naked Pair** | Two cells in a unit share the same two candidates — eliminates those from the rest of the unit |
| 5 | **Fallback** | Reveals the empty cell with the fewest candidates |

All hints include a Hebrew `explanation` string and a `highlightCells` list ready for UI rendering.

---

## Key Behaviours

- **3-strike system** — `mistakes >= 3` sets `isGameOver = true`
- **Auto-cleanup notes** — placing a digit removes it from all peer cells' pencil marks automatically
- **Unit completion tracking** — `completedUnits` reports which rows/cols/boxes were completed by each move (use for animations)
- **Input format** — accepts both `'0'` and `'.'` as empty-cell markers in puzzle strings

---

## Usage in Next.js

```ts
// Keep engine in a ref so it survives re-renders
const engineRef = useRef<SudokuEngine | null>(null);

useEffect(() => {
  engineRef.current = new SudokuEngine(puzzle.puzzle, puzzle.solution);
  setState(engineRef.current.getState());
}, [puzzle]);

function handleDigit(row: number, col: number, digit: number) {
  const result = engineRef.current!.enterDigit(row, col, digit);
  setState(engineRef.current!.getState());
  if (result.gameOver) showGameOver();
  if (result.isComplete) showWin();
}
```

---

## Architecture

Puzzles are sourced from a public dataset and stored in Supabase.
The engine is the only logic layer — it receives a `puzzle`/`solution` string pair and handles everything from there.

```
Supabase (puzzles table)
    ↓ fetch by difficulty / daily / id
Next.js page
    ↓ new SudokuEngine(puzzle, solution)
SudokuEngine  ←→  React UI
```
