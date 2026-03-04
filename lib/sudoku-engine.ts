// sudoku-engine.ts — standalone client-side Sudoku game engine
// No external dependencies. Pure TypeScript, works in browser and Node.

export type Grid = number[][];
export type Notes = Set<number>[][];

export interface GameState {
  puzzle: Grid;
  solution: Grid;
  userGrid: Grid;
  notes: Notes;
  mistakes: number;
  hintsUsed: number;
  isGameOver: boolean;
  isComplete: boolean;
  completedUnits: Set<string>;
}

export interface Hint {
  type: 'naked_single' | 'hidden_single' | 'locked_candidates' | 'naked_pair' | 'fallback';
  targetCell: [number, number];
  digit: number;
  explanation: string;
  highlightCells: [number, number][];
}

export interface MoveResult {
  correct: boolean;
  mistake: boolean;
  gameOver: boolean;
  isComplete: boolean;
  completedUnits: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseGrid(str: string): Grid {
  const grid: Grid = [];
  for (let r = 0; r < 9; r++) {
    grid.push([]);
    for (let c = 0; c < 9; c++) {
      const ch = str[r * 9 + c];
      grid[r].push(ch === '.' || ch === '0' ? 0 : parseInt(ch, 10));
    }
  }
  return grid;
}

function emptyNotes(): Notes {
  const notes: Notes = [];
  for (let r = 0; r < 9; r++) {
    notes.push([]);
    for (let c = 0; c < 9; c++) {
      notes[r].push(new Set<number>());
    }
  }
  return notes;
}

function cloneGrid(g: Grid): Grid {
  return g.map(row => [...row]);
}

function cloneNotes(n: Notes): Notes {
  return n.map(row => row.map(cell => new Set(cell)));
}

/** Row peers (excluding the cell itself) */
function rowPeers(r: number, c: number): [number, number][] {
  const peers: [number, number][] = [];
  for (let cc = 0; cc < 9; cc++) if (cc !== c) peers.push([r, cc]);
  return peers;
}

/** Column peers */
function colPeers(r: number, c: number): [number, number][] {
  const peers: [number, number][] = [];
  for (let rr = 0; rr < 9; rr++) if (rr !== r) peers.push([rr, c]);
  return peers;
}

/** Box peers */
function boxPeers(r: number, c: number): [number, number][] {
  const peers: [number, number][] = [];
  const br = Math.floor(r / 3) * 3;
  const bc = Math.floor(c / 3) * 3;
  for (let rr = br; rr < br + 3; rr++)
    for (let cc = bc; cc < bc + 3; cc++)
      if (rr !== r || cc !== c) peers.push([rr, cc]);
  return peers;
}

/** All peers of a cell */
function allPeers(r: number, c: number): [number, number][] {
  const seen = new Set<string>();
  const peers: [number, number][] = [];
  for (const [rr, cc] of [...rowPeers(r, c), ...colPeers(r, c), ...boxPeers(r, c)]) {
    const key = `${rr},${cc}`;
    if (!seen.has(key)) {
      seen.add(key);
      peers.push([rr, cc]);
    }
  }
  return peers;
}

/** Box index (0–8) for a cell */
function boxIndex(r: number, c: number): number {
  return Math.floor(r / 3) * 3 + Math.floor(c / 3);
}

/** All cells in a box by box index */
function boxCells(boxIdx: number): [number, number][] {
  const br = Math.floor(boxIdx / 3) * 3;
  const bc = (boxIdx % 3) * 3;
  const cells: [number, number][] = [];
  for (let r = br; r < br + 3; r++)
    for (let c = bc; c < bc + 3; c++)
      cells.push([r, c]);
  return cells;
}

/** Deduplicate cell list */
function uniqueCells(cells: [number, number][]): [number, number][] {
  const seen = new Set<string>();
  return cells.filter(([r, c]) => {
    const k = `${r},${c}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ─── Main Class ───────────────────────────────────────────────────────────────

export class SudokuEngine {
  private puzzle: Grid;
  private solution: Grid;
  private userGrid: Grid;
  private notes: Notes;
  private mistakes: number;
  private hintsUsed: number;
  private isGameOver: boolean;
  private isComplete: boolean;
  private completedUnits: Set<string>;

  constructor(puzzleStr: string, solutionStr: string) {
    this.puzzle = parseGrid(puzzleStr);
    this.solution = parseGrid(solutionStr);
    this.userGrid = cloneGrid(this.puzzle); // givens pre-filled
    this.notes = emptyNotes();
    this.mistakes = 0;
    this.hintsUsed = 0;
    this.isGameOver = false;
    this.isComplete = false;
    this.completedUnits = new Set();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  isGiven(row: number, col: number): boolean {
    return this.puzzle[row][col] !== 0;
  }

  getState(): GameState {
    return {
      puzzle: cloneGrid(this.puzzle),
      solution: cloneGrid(this.solution),
      userGrid: cloneGrid(this.userGrid),
      notes: cloneNotes(this.notes),
      mistakes: this.mistakes,
      hintsUsed: this.hintsUsed,
      isGameOver: this.isGameOver,
      isComplete: this.isComplete,
      completedUnits: new Set(this.completedUnits),
    };
  }

  enterDigit(row: number, col: number, digit: number): MoveResult {
    if (this.isGameOver || this.isComplete) {
      return { correct: false, mistake: false, gameOver: this.isGameOver, isComplete: this.isComplete, completedUnits: [] };
    }
    if (this.isGiven(row, col)) {
      return { correct: false, mistake: false, gameOver: false, isComplete: false, completedUnits: [] };
    }

    const correct = this.solution[row][col] === digit;

    if (!correct) {
      this.mistakes++;
      if (this.mistakes >= 3) this.isGameOver = true;
      return { correct: false, mistake: true, gameOver: this.isGameOver, isComplete: false, completedUnits: [] };
    }

    // Place digit
    this.userGrid[row][col] = digit;

    // Clear notes for this cell
    this.notes[row][col].clear();

    // Remove digit from notes of peers
    for (const [rr, cc] of allPeers(row, col)) {
      this.notes[rr][cc].delete(digit);
    }

    // Detect newly completed units
    const newlyCompleted = this.checkCompletedUnits(row, col);

    // Check overall completion
    this.isComplete = this.checkAllComplete();

    return {
      correct: true,
      mistake: false,
      gameOver: false,
      isComplete: this.isComplete,
      completedUnits: newlyCompleted,
    };
  }

  eraseCell(row: number, col: number): void {
    if (this.isGiven(row, col)) return;
    this.userGrid[row][col] = 0;
    this.notes[row][col].clear();
  }

  toggleNote(row: number, col: number, digit: number): void {
    if (this.isGiven(row, col)) return;
    if (this.userGrid[row][col] !== 0) return; // cell already filled
    const cell = this.notes[row][col];
    if (cell.has(digit)) cell.delete(digit);
    else cell.add(digit);
  }

  getHint(): Hint {
    this.hintsUsed++;

    const hint =
      this.tryNakedSingle() ??
      this.tryHiddenSingle() ??
      this.tryLockedCandidates() ??
      this.tryNakedPair() ??
      this.fallbackHint();

    return hint;
  }

  getCandidates(row: number, col: number): Set<number> {
    const used = new Set<number>();
    // Givens and correct user entries in the same row, col, box
    for (const [rr, cc] of allPeers(row, col)) {
      const val = this.userGrid[rr][cc];
      if (val !== 0) used.add(val);
    }
    // Also exclude the cell's own value (if filled)
    const self = this.userGrid[row][col];
    if (self !== 0) used.add(self);

    const candidates = new Set<number>();
    for (let d = 1; d <= 9; d++) if (!used.has(d)) candidates.add(d);
    return candidates;
  }

  // ── Completion helpers ─────────────────────────────────────────────────────

  private isUnitComplete(cells: [number, number][]): boolean {
    return cells.every(([r, c]) => this.userGrid[r][c] === this.solution[r][c]);
  }

  private checkCompletedUnits(row: number, col: number): string[] {
    const newly: string[] = [];

    const rowKey = `row-${row}`;
    if (!this.completedUnits.has(rowKey)) {
      const cells: [number, number][] = Array.from({ length: 9 }, (_, c) => [row, c]);
      if (this.isUnitComplete(cells)) {
        this.completedUnits.add(rowKey);
        newly.push(rowKey);
      }
    }

    const colKey = `col-${col}`;
    if (!this.completedUnits.has(colKey)) {
      const cells: [number, number][] = Array.from({ length: 9 }, (_, r) => [r, col]);
      if (this.isUnitComplete(cells)) {
        this.completedUnits.add(colKey);
        newly.push(colKey);
      }
    }

    const bi = boxIndex(row, col);
    const boxKey = `box-${bi}`;
    if (!this.completedUnits.has(boxKey)) {
      if (this.isUnitComplete(boxCells(bi))) {
        this.completedUnits.add(boxKey);
        newly.push(boxKey);
      }
    }

    return newly;
  }

  private checkAllComplete(): boolean {
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++)
        if (this.userGrid[r][c] !== this.solution[r][c]) return false;
    return true;
  }

  // ── Hint strategies ────────────────────────────────────────────────────────

  private emptyCells(): [number, number][] {
    const cells: [number, number][] = [];
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++)
        if (this.userGrid[r][c] === 0) cells.push([r, c]);
    return cells;
  }

  /** Strategy 1: Naked Single */
  private tryNakedSingle(): Hint | null {
    for (const [r, c] of this.emptyCells()) {
      const cands = this.getCandidates(r, c);
      if (cands.size === 1) {
        const digit = [...cands][0];
        const peers = allPeers(r, c).filter(([rr, cc]) => {
          const v = this.userGrid[rr][cc];
          return v !== 0;
        });
        return {
          type: 'naked_single',
          targetCell: [r, c],
          digit,
          explanation: `בתא הזה יכולה להיכנס רק הספרה ${digit} – כל שאר הספרות כבר קיימות בשורה, בעמודה או בריבוע שלו`,
          highlightCells: uniqueCells([[r, c], ...peers]),
        };
      }
    }
    return null;
  }

  /** Strategy 2: Hidden Single */
  private tryHiddenSingle(): Hint | null {
    // Build all 27 units
    const units: Array<{ cells: [number, number][]; label: string; labelType: 'row' | 'col' | 'box'; index: number }> = [];

    for (let i = 0; i < 9; i++) {
      units.push({ cells: Array.from({ length: 9 }, (_, c) => [i, c]), label: `שורה ${i + 1}`, labelType: 'row', index: i });
      units.push({ cells: Array.from({ length: 9 }, (_, r) => [r, i]), label: `עמודה ${i + 1}`, labelType: 'col', index: i });
      units.push({ cells: boxCells(i), label: 'הריבוע', labelType: 'box', index: i });
    }

    for (const unit of units) {
      for (let digit = 1; digit <= 9; digit++) {
        const candidates = unit.cells.filter(([r, c]) => {
          if (this.userGrid[r][c] !== 0) return false;
          return this.getCandidates(r, c).has(digit);
        });
        if (candidates.length === 1) {
          const [r, c] = candidates[0];
          let explanation: string;
          if (unit.labelType === 'row') {
            explanation = `ב${unit.label}, הספרה ${digit} יכולה להופיע רק בתא אחד`;
          } else if (unit.labelType === 'col') {
            explanation = `ב${unit.label}, הספרה ${digit} יכולה להופיע רק בתא אחד`;
          } else {
            explanation = `ב${unit.label}, הספרה ${digit} יכולה להופיע רק בתא אחד`;
          }
          return {
            type: 'hidden_single',
            targetCell: [r, c],
            digit,
            explanation,
            highlightCells: uniqueCells([...unit.cells, [r, c]]),
          };
        }
      }
    }
    return null;
  }

  /** Strategy 3: Locked Candidates (Pointing) */
  private tryLockedCandidates(): Hint | null {
    for (let bi = 0; bi < 9; bi++) {
      const cells = boxCells(bi);
      for (let digit = 1; digit <= 9; digit++) {
        const cands = cells.filter(([r, c]) => {
          if (this.userGrid[r][c] !== 0) return false;
          return this.getCandidates(r, c).has(digit);
        });
        if (cands.length < 2) continue;

        // Check if all candidates share the same row
        const rows = new Set(cands.map(([r]) => r));
        if (rows.size === 1) {
          const row = [...rows][0];
          // Find peers in that row outside this box
          const rowCells: [number, number][] = Array.from({ length: 9 }, (_, c) => [row, c]);
          const eliminated = rowCells.filter(([r, c]) => {
            if (boxIndex(r, c) === bi) return false;
            if (this.userGrid[r][c] !== 0) return false;
            return this.getCandidates(r, c).has(digit);
          });
          if (eliminated.length > 0) {
            return {
              type: 'locked_candidates',
              targetCell: cands[0],
              digit,
              explanation: `בריבוע הזה, הספרה ${digit} חייבת להיות בשורה ${row + 1} – אפשר למחוק אותה משאר השורה`,
              highlightCells: uniqueCells([...cands, ...eliminated]),
            };
          }
        }

        // Check if all candidates share the same col
        const cols = new Set(cands.map(([, c]) => c));
        if (cols.size === 1) {
          const col = [...cols][0];
          const colCells: [number, number][] = Array.from({ length: 9 }, (_, r) => [r, col]);
          const eliminated = colCells.filter(([r, c]) => {
            if (boxIndex(r, c) === bi) return false;
            if (this.userGrid[r][c] !== 0) return false;
            return this.getCandidates(r, c).has(digit);
          });
          if (eliminated.length > 0) {
            return {
              type: 'locked_candidates',
              targetCell: cands[0],
              digit,
              explanation: `בריבוע הזה, הספרה ${digit} חייבת להיות בעמודה ${col + 1} – אפשר למחוק אותה משאר העמודה`,
              highlightCells: uniqueCells([...cands, ...eliminated]),
            };
          }
        }
      }
    }
    return null;
  }

  /** Strategy 4: Naked Pair */
  private tryNakedPair(): Hint | null {
    // Build all 27 units
    const units: Array<{ cells: [number, number][]; label: string }> = [];
    for (let i = 0; i < 9; i++) {
      units.push({ cells: Array.from({ length: 9 }, (_, c) => [i, c]), label: `שורה ${i + 1}` });
      units.push({ cells: Array.from({ length: 9 }, (_, r) => [r, i]), label: `עמודה ${i + 1}` });
      units.push({ cells: boxCells(i), label: 'הריבוע' });
    }

    for (const unit of units) {
      // Find cells with exactly 2 candidates
      const twoCandCells = unit.cells
        .filter(([r, c]) => this.userGrid[r][c] === 0)
        .map(([r, c]) => ({ r, c, cands: this.getCandidates(r, c) }))
        .filter(x => x.cands.size === 2);

      for (let i = 0; i < twoCandCells.length; i++) {
        for (let j = i + 1; j < twoCandCells.length; j++) {
          const a = twoCandCells[i];
          const b = twoCandCells[j];
          const aArr = [...a.cands].sort();
          const bArr = [...b.cands].sort();
          if (aArr[0] !== bArr[0] || aArr[1] !== bArr[1]) continue;

          const [d1, d2] = aArr;
          // Find other cells in the unit affected
          const affected = unit.cells.filter(([r, c]) => {
            if ((r === a.r && c === a.c) || (r === b.r && c === b.c)) return false;
            if (this.userGrid[r][c] !== 0) return false;
            const cands = this.getCandidates(r, c);
            return cands.has(d1) || cands.has(d2);
          });

          if (affected.length > 0) {
            // Determine unit type label
            const unitLabel = unit.label.startsWith('שורה') ? unit.label
              : unit.label.startsWith('עמודה') ? unit.label
              : 'הריבוע';
            const unitSuffix = unit.label.startsWith('שורה') ? 'השורה'
              : unit.label.startsWith('עמודה') ? 'העמודה'
              : 'הריבוע';

            return {
              type: 'naked_pair',
              targetCell: [a.r, a.c],
              digit: d1,
              explanation: `שני תאים ב${unitLabel} מכילים רק את הספרות ${d1} ו-${d2} – אפשר למחוק אותן משאר ${unitSuffix}`,
              highlightCells: uniqueCells([[a.r, a.c], [b.r, b.c], ...affected]),
            };
          }
        }
      }
    }
    return null;
  }

  /** Fallback: reveal cell with fewest candidates */
  private fallbackHint(): Hint {
    let best: [number, number] | null = null;
    let bestCount = 10;

    for (const [r, c] of this.emptyCells()) {
      const count = this.getCandidates(r, c).size;
      if (count < bestCount) {
        bestCount = count;
        best = [r, c];
      }
    }

    if (!best) {
      // Puzzle is complete or stuck — shouldn't happen
      best = [0, 0];
    }

    const [r, c] = best;
    const digit = this.solution[r][c];

    return {
      type: 'fallback',
      targetCell: [r, c],
      digit,
      explanation: 'נסה את התא הזה – יש לו הכי פחות אפשרויות',
      highlightCells: [[r, c]],
    };
  }
}
