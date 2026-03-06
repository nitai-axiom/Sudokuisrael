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
  maxMistakes: number;
  hintsUsed: number;
  isGameOver: boolean;
  isComplete: boolean;
  completedUnits: Set<string>;
  elapsed: number;
  timerRunning: boolean;
}

export interface Hint {
  type:
    | 'naked_single'
    | 'hidden_single'
    | 'locked_candidates'
    | 'naked_pair'
    | 'hidden_pair'
    | 'x_wing'
    | 'y_wing'
    | 'swordfish'
    | 'fallback';
  action: 'place' | 'eliminate';
  targetCell: [number, number];
  digit: number;
  digits: number[];
  explanation: string;
  highlightCells: [number, number][];
  eliminationCells: [number, number][];
}

export interface MoveResult {
  correct: boolean;
  mistake: boolean;
  gameOver: boolean;
  isComplete: boolean;
  completedUnits: string[];
}

interface Snapshot {
  userGrid: Grid;
  notes: Notes;
  mistakes: number;
}

// ─── Module-level constants ────────────────────────────────────────────────────

/** All 27 units (9 rows + 9 cols + 9 boxes) */
const ALL_UNITS: [number, number][][] = (() => {
  const units: [number, number][][] = [];
  for (let i = 0; i < 9; i++) {
    // rows
    units.push(Array.from({ length: 9 }, (_, c) => [i, c]));
    // cols
    units.push(Array.from({ length: 9 }, (_, r) => [r, i]));
    // boxes
    const br = Math.floor(i / 3) * 3;
    const bc = (i % 3) * 3;
    const box: [number, number][] = [];
    for (let r = br; r < br + 3; r++)
      for (let c = bc; c < bc + 3; c++)
        box.push([r, c]);
    units.push(box);
  }
  return units;
})();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseGrid(str: string): Grid {
  if (str.length < 81) {
    throw new Error(`Invalid grid string: expected 81 characters, got ${str.length}`);
  }
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

function isValidCoord(row: number, col: number): boolean {
  return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < 9 && col >= 0 && col < 9;
}

function isValidDigit(digit: number): boolean {
  return Number.isInteger(digit) && digit >= 1 && digit <= 9;
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

/** All peers of a cell (row + col + box, deduplicated) */
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

/** True if two cells share a row, column, or box */
function sees(r1: number, c1: number, r2: number, c2: number): boolean {
  if (r1 === r2 && c1 === c2) return false;
  return r1 === r2 || c1 === c2 || boxIndex(r1, c1) === boxIndex(r2, c2);
}

/** Hebrew label for a unit (row / col / box) */
function unitHebrewLabel(unit: [number, number][]): string {
  const r0 = unit[0][0], c0 = unit[0][1];
  if (unit.every(([r, c]) => boxIndex(r, c) === boxIndex(r0, c0))) return 'הריבוע';
  if (unit.every(([r]) => r === r0)) return `שורה ${r0 + 1}`;
  if (unit.every(([, c]) => c === c0)) return `עמודה ${c0 + 1}`;
  return 'היחידה';
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

  // Timer state
  private elapsed: number;          // accumulated seconds
  private timerStart: number | null; // Date.now() when started, null if paused

  // Undo history
  private history: Snapshot[];

  constructor(puzzleStr: string, solutionStr: string) {
    this.puzzle = parseGrid(puzzleStr);
    this.solution = parseGrid(solutionStr);
    this.userGrid = cloneGrid(this.puzzle);
    this.notes = emptyNotes();
    this.mistakes = 0;
    this.hintsUsed = 0;
    this.isGameOver = false;
    this.isComplete = false;
    this.completedUnits = new Set();
    this.elapsed = 0;
    this.timerStart = null;
    this.history = [];
  }

  // ── Timer ──────────────────────────────────────────────────────────────────

  startTimer(): void {
    if (this.timerStart !== null) return;
    this.timerStart = Date.now();
  }

  pauseTimer(): void {
    if (this.timerStart === null) return;
    this.elapsed += (Date.now() - this.timerStart) / 1000;
    this.timerStart = null;
  }

  resetTimer(): void {
    this.timerStart = null;
    this.elapsed = 0;
  }

  getElapsed(): number {
    if (this.timerStart !== null) {
      return this.elapsed + (Date.now() - this.timerStart) / 1000;
    }
    return this.elapsed;
  }

  // ── Undo ───────────────────────────────────────────────────────────────────

  private pushHistory(): void {
    if (this.history.length >= 50) this.history.shift();
    this.history.push({
      userGrid: cloneGrid(this.userGrid),
      notes: cloneNotes(this.notes),
      mistakes: this.mistakes,
    });
  }

  undo(): boolean {
    const snap = this.history.pop();
    if (!snap) return false;
    this.userGrid = snap.userGrid;
    this.notes = snap.notes;
    this.mistakes = snap.mistakes;
    this.isGameOver = this.mistakes >= 3;
    this.isComplete = false;
    this.recomputeCompletedUnits();
    return true;
  }

  resetPuzzle(): void {
    this.userGrid = cloneGrid(this.puzzle);
    this.notes = emptyNotes();
    this.mistakes = 0;
    this.isGameOver = false;
    this.isComplete = false;
    this.completedUnits = new Set();
    this.history = [];
    this.resetTimer();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  isGiven(row: number, col: number): boolean {
    return this.puzzle[row][col] !== 0;
  }

  /** Whether a cell has been correctly filled by the user */
  isSolved(row: number, col: number): boolean {
    return !this.isGiven(row, col) && this.userGrid[row][col] === this.solution[row][col];
  }

  getState(): GameState {
    return {
      puzzle: cloneGrid(this.puzzle),
      solution: cloneGrid(this.solution),
      userGrid: cloneGrid(this.userGrid),
      notes: cloneNotes(this.notes),
      mistakes: this.mistakes,
      maxMistakes: 3,
      hintsUsed: this.hintsUsed,
      isGameOver: this.isGameOver,
      isComplete: this.isComplete,
      completedUnits: new Set(this.completedUnits),
      elapsed: this.getElapsed(),
      timerRunning: this.timerStart !== null,
    };
  }

  enterDigit(row: number, col: number, digit: number): MoveResult {
    if (!isValidCoord(row, col) || !isValidDigit(digit)) {
      return { correct: false, mistake: false, gameOver: this.isGameOver, isComplete: this.isComplete, completedUnits: [] };
    }
    if (this.isGameOver || this.isComplete) {
      return { correct: false, mistake: false, gameOver: this.isGameOver, isComplete: this.isComplete, completedUnits: [] };
    }
    if (this.isGiven(row, col) || this.isSolved(row, col)) {
      return { correct: false, mistake: false, gameOver: false, isComplete: false, completedUnits: [] };
    }

    this.pushHistory();

    const correct = this.solution[row][col] === digit;

    if (!correct) {
      this.mistakes++;
      if (this.mistakes >= 3) {
        this.isGameOver = true;
        this.pauseTimer();
      }
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
    if (this.isComplete) this.pauseTimer();

    return {
      correct: true,
      mistake: false,
      gameOver: false,
      isComplete: this.isComplete,
      completedUnits: newlyCompleted,
    };
  }

  eraseCell(row: number, col: number): void {
    if (!isValidCoord(row, col)) return;
    if (this.isGiven(row, col)) return;
    if (this.isSolved(row, col)) return; // cannot erase correctly placed digits
    if (this.userGrid[row][col] === 0 && this.notes[row][col].size === 0) return; // nothing to erase
    this.pushHistory();
    this.userGrid[row][col] = 0;
    this.notes[row][col].clear();
  }

  toggleNote(row: number, col: number, digit: number): void {
    if (!isValidCoord(row, col) || !isValidDigit(digit)) return;
    if (this.isGiven(row, col)) return;
    if (this.userGrid[row][col] !== 0) return;
    this.pushHistory();
    const cell = this.notes[row][col];
    if (cell.has(digit)) cell.delete(digit);
    else cell.add(digit);
  }

  getHint(): Hint | null {
    if (this.isGameOver || this.isComplete) return null;

    const hint =
      this.tryNakedSingle() ??
      this.tryHiddenSingle() ??
      this.tryLockedCandidates() ??
      this.tryNakedPair() ??
      this.tryHiddenPair() ??
      this.tryXWing() ??
      this.tryYWing() ??
      this.trySwordfish() ??
      this.fallbackHint();

    if (hint) this.hintsUsed++;
    return hint;
  }

  getCandidates(row: number, col: number): Set<number> {
    const used = new Set<number>();
    for (const [rr, cc] of allPeers(row, col)) {
      const val = this.userGrid[rr][cc];
      if (val !== 0) used.add(val);
    }
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

  private recomputeCompletedUnits(): void {
    this.completedUnits.clear();
    for (let i = 0; i < 9; i++) {
      const rowCells: [number, number][] = Array.from({ length: 9 }, (_, c) => [i, c]);
      if (this.isUnitComplete(rowCells)) this.completedUnits.add(`row-${i}`);

      const colCells: [number, number][] = Array.from({ length: 9 }, (_, r) => [r, i]);
      if (this.isUnitComplete(colCells)) this.completedUnits.add(`col-${i}`);

      if (this.isUnitComplete(boxCells(i))) this.completedUnits.add(`box-${i}`);
    }
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
        const peers = allPeers(r, c).filter(([rr, cc]) => this.userGrid[rr][cc] !== 0);
        return {
          type: 'naked_single',
          action: 'place',
          targetCell: [r, c],
          digit,
          digits: [digit],
          explanation: `בתא הזה יכולה להיכנס רק הספרה ${digit} – כל שאר הספרות כבר קיימות בשורה, בעמודה או בריבוע שלו`,
          highlightCells: uniqueCells([[r, c], ...peers]),
          eliminationCells: [],
        };
      }
    }
    return null;
  }

  /** Strategy 2: Hidden Single */
  private tryHiddenSingle(): Hint | null {
    for (const unit of ALL_UNITS) {
      const label = unitHebrewLabel(unit);
      for (let digit = 1; digit <= 9; digit++) {
        const candidates = unit.filter(([r, c]) => {
          if (this.userGrid[r][c] !== 0) return false;
          return this.getCandidates(r, c).has(digit);
        });
        if (candidates.length === 1) {
          const [r, c] = candidates[0];
          return {
            type: 'hidden_single',
            action: 'place',
            targetCell: [r, c],
            digit,
            digits: [digit],
            explanation: `ב${label}, הספרה ${digit} יכולה להופיע רק בתא הזה`,
            highlightCells: uniqueCells([...unit, [r, c]]),
            eliminationCells: [],
          };
        }
      }
    }
    return null;
  }

  /** Strategy 3: Locked Candidates (Pointing pair/triple box→line and line→box) */
  private tryLockedCandidates(): Hint | null {
    // Box → line (pointing pairs/triples)
    for (let bi = 0; bi < 9; bi++) {
      const cells = boxCells(bi);
      for (let digit = 1; digit <= 9; digit++) {
        const cands = cells.filter(([r, c]) => {
          if (this.userGrid[r][c] !== 0) return false;
          return this.getCandidates(r, c).has(digit);
        });
        if (cands.length < 2) continue;

        const rows = new Set(cands.map(([r]) => r));
        if (rows.size === 1) {
          const row = [...rows][0];
          const eliminated = Array.from({ length: 9 }, (_, c) => [row, c] as [number, number]).filter(([r, c]) => {
            if (boxIndex(r, c) === bi) return false;
            if (this.userGrid[r][c] !== 0) return false;
            return this.getCandidates(r, c).has(digit);
          });
          if (eliminated.length > 0) {
            const groupLabel = cands.length === 2 ? 'זוג מצביע' : 'שלישייה מצביעה';
            return {
              type: 'locked_candidates',
              action: 'eliminate',
              targetCell: cands[0],
              digit,
              digits: [digit],
              explanation: `${groupLabel}: בריבוע הזה, הספרה ${digit} חייבת להיות בשורה ${row + 1} – אפשר למחוק אותה משאר השורה`,
              highlightCells: uniqueCells([...cands]),
              eliminationCells: uniqueCells([...eliminated]),
            };
          }
        }

        const cols = new Set(cands.map(([, c]) => c));
        if (cols.size === 1) {
          const col = [...cols][0];
          const eliminated = Array.from({ length: 9 }, (_, r) => [r, col] as [number, number]).filter(([r, c]) => {
            if (boxIndex(r, c) === bi) return false;
            if (this.userGrid[r][c] !== 0) return false;
            return this.getCandidates(r, c).has(digit);
          });
          if (eliminated.length > 0) {
            const groupLabel = cands.length === 2 ? 'זוג מצביע' : 'שלישייה מצביעה';
            return {
              type: 'locked_candidates',
              action: 'eliminate',
              targetCell: cands[0],
              digit,
              digits: [digit],
              explanation: `${groupLabel}: בריבוע הזה, הספרה ${digit} חייבת להיות בעמודה ${col + 1} – אפשר למחוק אותה משאר העמודה`,
              highlightCells: uniqueCells([...cands]),
              eliminationCells: uniqueCells([...eliminated]),
            };
          }
        }
      }
    }

    // Line → box (box-line reduction)
    for (let i = 0; i < 9; i++) {
      for (const isRow of [true, false]) {
        const lineCells: [number, number][] = Array.from({ length: 9 }, (_, j) =>
          isRow ? [i, j] : [j, i]
        );
        for (let digit = 1; digit <= 9; digit++) {
          const cands = lineCells.filter(([r, c]) => {
            if (this.userGrid[r][c] !== 0) return false;
            return this.getCandidates(r, c).has(digit);
          });
          if (cands.length < 2) continue;
          const boxes = new Set(cands.map(([r, c]) => boxIndex(r, c)));
          if (boxes.size !== 1) continue;
          const bi = [...boxes][0];
          const eliminated = boxCells(bi).filter(([r, c]) => {
            if (isRow ? r === i : c === i) return false;
            if (this.userGrid[r][c] !== 0) return false;
            return this.getCandidates(r, c).has(digit);
          });
          if (eliminated.length > 0) {
            const lineLabel = isRow ? `שורה ${i + 1}` : `עמודה ${i + 1}`;
            return {
              type: 'locked_candidates',
              action: 'eliminate',
              targetCell: cands[0],
              digit,
              digits: [digit],
              explanation: `ב${lineLabel}, הספרה ${digit} מוגבלת לריבוע אחד – אפשר למחוק אותה משאר הריבוע`,
              highlightCells: uniqueCells([...cands]),
              eliminationCells: uniqueCells([...eliminated]),
            };
          }
        }
      }
    }

    return null;
  }

  /** Strategy 4: Naked Pair */
  private tryNakedPair(): Hint | null {
    for (const unit of ALL_UNITS) {
      const twoCandCells = unit
        .filter(([r, c]) => this.userGrid[r][c] === 0)
        .map(([r, c]) => ({ r, c, cands: this.getCandidates(r, c) }))
        .filter(x => x.cands.size === 2);

      for (let i = 0; i < twoCandCells.length; i++) {
        for (let j = i + 1; j < twoCandCells.length; j++) {
          const a = twoCandCells[i];
          const b = twoCandCells[j];
          const aArr = [...a.cands].sort((x, y) => x - y);
          const bArr = [...b.cands].sort((x, y) => x - y);
          if (aArr[0] !== bArr[0] || aArr[1] !== bArr[1]) continue;

          const [d1, d2] = aArr;
          const affected = unit.filter(([r, c]) => {
            if ((r === a.r && c === a.c) || (r === b.r && c === b.c)) return false;
            if (this.userGrid[r][c] !== 0) return false;
            const cands = this.getCandidates(r, c);
            return cands.has(d1) || cands.has(d2);
          });

          if (affected.length > 0) {
            const label = unitHebrewLabel(unit);
            const suffix = label.startsWith('שורה') ? 'השורה' : label.startsWith('עמודה') ? 'העמודה' : 'הריבוע';
            return {
              type: 'naked_pair',
              action: 'eliminate',
              targetCell: [a.r, a.c],
              digit: d1,
              digits: [d1, d2],
              explanation: `זוג עירום ב${label}: שני תאים מכילים רק את הספרות ${d1} ו-${d2} – אפשר למחוק אותן משאר ${suffix}`,
              highlightCells: uniqueCells([[a.r, a.c], [b.r, b.c]]),
              eliminationCells: uniqueCells([...affected]),
            };
          }
        }
      }
    }
    return null;
  }

  /** Strategy 5: Hidden Pair */
  private tryHiddenPair(): Hint | null {
    for (const unit of ALL_UNITS) {
      const emptyCells = unit.filter(([r, c]) => this.userGrid[r][c] === 0);
      for (let d1 = 1; d1 <= 8; d1++) {
        for (let d2 = d1 + 1; d2 <= 9; d2++) {
          const cells1 = emptyCells.filter(([r, c]) => this.getCandidates(r, c).has(d1));
          const cells2 = emptyCells.filter(([r, c]) => this.getCandidates(r, c).has(d2));
          if (cells1.length !== 2 || cells2.length !== 2) continue;

          const key1 = cells1.map(([r, c]) => `${r},${c}`).sort().join('|');
          const key2 = cells2.map(([r, c]) => `${r},${c}`).sort().join('|');
          if (key1 !== key2) continue;

          const [r1, c1] = cells1[0];
          const [r2, c2] = cells1[1];
          const cands1 = this.getCandidates(r1, c1);
          const cands2 = this.getCandidates(r2, c2);
          const extraIn1 = [...cands1].filter(d => d !== d1 && d !== d2);
          const extraIn2 = [...cands2].filter(d => d !== d1 && d !== d2);
          if (extraIn1.length === 0 && extraIn2.length === 0) continue;

          const label = unitHebrewLabel(unit);
          return {
            type: 'hidden_pair',
            action: 'eliminate',
            targetCell: [r1, c1],
            digit: d1,
            digits: [d1, d2],
            explanation: `זוג נסתר ב${label}: הספרות ${d1} ו-${d2} מופיעות רק בשני תאים – אפשר למחוק את שאר המועמדים מאותם תאים`,
            highlightCells: uniqueCells([[r1, c1], [r2, c2]]),
            eliminationCells: uniqueCells([[r1, c1], [r2, c2]]),
          };
        }
      }
    }
    return null;
  }

  /** Strategy 6: X-Wing */
  private tryXWing(): Hint | null {
    for (let digit = 1; digit <= 9; digit++) {
      // Row-based X-Wing
      const rowCandCols: Map<number, number[]> = new Map();
      for (let r = 0; r < 9; r++) {
        const cols = [];
        for (let c = 0; c < 9; c++) {
          if (this.userGrid[r][c] === 0 && this.getCandidates(r, c).has(digit)) cols.push(c);
        }
        if (cols.length === 2) rowCandCols.set(r, cols);
      }
      const rowsWithTwo = [...rowCandCols.entries()];
      for (let i = 0; i < rowsWithTwo.length; i++) {
        for (let j = i + 1; j < rowsWithTwo.length; j++) {
          const [r1, cols1] = rowsWithTwo[i];
          const [r2, cols2] = rowsWithTwo[j];
          if (cols1[0] !== cols2[0] || cols1[1] !== cols2[1]) continue;
          const [c1, c2] = cols1;
          const eliminated: [number, number][] = [];
          for (let r = 0; r < 9; r++) {
            if (r === r1 || r === r2) continue;
            for (const c of [c1, c2]) {
              if (this.userGrid[r][c] === 0 && this.getCandidates(r, c).has(digit)) {
                eliminated.push([r, c]);
              }
            }
          }
          if (eliminated.length > 0) {
            return {
              type: 'x_wing',
              action: 'eliminate',
              targetCell: [r1, c1],
              digit,
              digits: [digit],
              explanation: `X-Wing: הספרה ${digit} מופיעה בדיוק בשתי עמודות בשורות ${r1 + 1} ו-${r2 + 1} – אפשר למחוק אותה משאר אותן עמודות`,
              highlightCells: uniqueCells([[r1, c1], [r1, c2], [r2, c1], [r2, c2]]),
              eliminationCells: uniqueCells([...eliminated]),
            };
          }
        }
      }

      // Col-based X-Wing
      const colCandRows: Map<number, number[]> = new Map();
      for (let c = 0; c < 9; c++) {
        const rows = [];
        for (let r = 0; r < 9; r++) {
          if (this.userGrid[r][c] === 0 && this.getCandidates(r, c).has(digit)) rows.push(r);
        }
        if (rows.length === 2) colCandRows.set(c, rows);
      }
      const colsWithTwo = [...colCandRows.entries()];
      for (let i = 0; i < colsWithTwo.length; i++) {
        for (let j = i + 1; j < colsWithTwo.length; j++) {
          const [c1, rows1] = colsWithTwo[i];
          const [c2, rows2] = colsWithTwo[j];
          if (rows1[0] !== rows2[0] || rows1[1] !== rows2[1]) continue;
          const [r1, r2] = rows1;
          const eliminated: [number, number][] = [];
          for (let c = 0; c < 9; c++) {
            if (c === c1 || c === c2) continue;
            for (const r of [r1, r2]) {
              if (this.userGrid[r][c] === 0 && this.getCandidates(r, c).has(digit)) {
                eliminated.push([r, c]);
              }
            }
          }
          if (eliminated.length > 0) {
            return {
              type: 'x_wing',
              action: 'eliminate',
              targetCell: [r1, c1],
              digit,
              digits: [digit],
              explanation: `X-Wing: הספרה ${digit} מופיעה בדיוק בשתי שורות בעמודות ${c1 + 1} ו-${c2 + 1} – אפשר למחוק אותה משאר אותן שורות`,
              highlightCells: uniqueCells([[r1, c1], [r2, c1], [r1, c2], [r2, c2]]),
              eliminationCells: uniqueCells([...eliminated]),
            };
          }
        }
      }
    }
    return null;
  }

  /** Strategy 7: Y-Wing (XY-Wing) */
  private tryYWing(): Hint | null {
    const empty = this.emptyCells();
    const twoCand = empty
      .map(([r, c]) => ({ r, c, cands: this.getCandidates(r, c) }))
      .filter(x => x.cands.size === 2);

    for (const pivot of twoCand) {
      const [a, b] = [...pivot.cands];
      for (const wing1 of twoCand) {
        if (wing1.r === pivot.r && wing1.c === pivot.c) continue;
        if (!sees(pivot.r, pivot.c, wing1.r, wing1.c)) continue;
        if (!wing1.cands.has(a)) continue;
        const [wa1, wa2] = [...wing1.cands];
        const c = wa1 === a ? wa2 : wa1;
        if (c === b) continue;

        for (const wing2 of twoCand) {
          if (wing2.r === pivot.r && wing2.c === pivot.c) continue;
          if (wing2.r === wing1.r && wing2.c === wing1.c) continue;
          if (!sees(pivot.r, pivot.c, wing2.r, wing2.c)) continue;
          if (!wing2.cands.has(b) || !wing2.cands.has(c)) continue;
          if (wing2.cands.size !== 2) continue;

          const eliminated: [number, number][] = empty.filter(([r, cc]) => {
            if ((r === wing1.r && cc === wing1.c) || (r === wing2.r && cc === wing2.c)) return false;
            return sees(r, cc, wing1.r, wing1.c) && sees(r, cc, wing2.r, wing2.c) &&
              this.getCandidates(r, cc).has(c);
          });

          if (eliminated.length > 0) {
            return {
              type: 'y_wing',
              action: 'eliminate',
              targetCell: [pivot.r, pivot.c],
              digit: c,
              digits: [a, b, c],
              explanation: `Y-Wing: תא ציר עם {${a},${b}} + שני כנפיים – אפשר למחוק את הספרה ${c} מכל תא הנצפה על ידי שתי הכנפיים`,
              highlightCells: uniqueCells([[pivot.r, pivot.c], [wing1.r, wing1.c], [wing2.r, wing2.c]]),
              eliminationCells: uniqueCells([...eliminated]),
            };
          }
        }
      }
    }
    return null;
  }

  /** Strategy 8: Swordfish */
  private trySwordfish(): Hint | null {
    for (let digit = 1; digit <= 9; digit++) {
      // Row-based Swordfish
      const rowCandCols: Map<number, number[]> = new Map();
      for (let r = 0; r < 9; r++) {
        const cols = [];
        for (let c = 0; c < 9; c++) {
          if (this.userGrid[r][c] === 0 && this.getCandidates(r, c).has(digit)) cols.push(c);
        }
        if (cols.length >= 2 && cols.length <= 3) rowCandCols.set(r, cols);
      }
      const rowEntries = [...rowCandCols.entries()];
      for (let i = 0; i < rowEntries.length; i++) {
        for (let j = i + 1; j < rowEntries.length; j++) {
          for (let k = j + 1; k < rowEntries.length; k++) {
            const [r1, cols1] = rowEntries[i];
            const [r2, cols2] = rowEntries[j];
            const [r3, cols3] = rowEntries[k];
            const unionCols = new Set([...cols1, ...cols2, ...cols3]);
            if (unionCols.size !== 3) continue;
            const colArr = [...unionCols];
            const eliminated: [number, number][] = [];
            for (let r = 0; r < 9; r++) {
              if (r === r1 || r === r2 || r === r3) continue;
              for (const c of colArr) {
                if (this.userGrid[r][c] === 0 && this.getCandidates(r, c).has(digit)) {
                  eliminated.push([r, c]);
                }
              }
            }
            if (eliminated.length > 0) {
              const definers: [number, number][] = [];
              for (const [r, cols] of [[r1, cols1], [r2, cols2], [r3, cols3]] as [number, number[]][]) {
                for (const c of cols) definers.push([r, c]);
              }
              return {
                type: 'swordfish',
                action: 'eliminate',
                targetCell: [r1, cols1[0]],
                digit,
                digits: [digit],
                explanation: `Swordfish: הספרה ${digit} מוגבלת לשלוש שורות ושלוש עמודות – אפשר למחוק אותה משאר אותן עמודות`,
                highlightCells: uniqueCells([...definers]),
                eliminationCells: uniqueCells([...eliminated]),
              };
            }
          }
        }
      }

      // Col-based Swordfish
      const colCandRows: Map<number, number[]> = new Map();
      for (let c = 0; c < 9; c++) {
        const rows = [];
        for (let r = 0; r < 9; r++) {
          if (this.userGrid[r][c] === 0 && this.getCandidates(r, c).has(digit)) rows.push(r);
        }
        if (rows.length >= 2 && rows.length <= 3) colCandRows.set(c, rows);
      }
      const colEntries = [...colCandRows.entries()];
      for (let i = 0; i < colEntries.length; i++) {
        for (let j = i + 1; j < colEntries.length; j++) {
          for (let k = j + 1; k < colEntries.length; k++) {
            const [c1, rows1] = colEntries[i];
            const [c2, rows2] = colEntries[j];
            const [c3, rows3] = colEntries[k];
            const unionRows = new Set([...rows1, ...rows2, ...rows3]);
            if (unionRows.size !== 3) continue;
            const rowArr = [...unionRows];
            const eliminated: [number, number][] = [];
            for (let c = 0; c < 9; c++) {
              if (c === c1 || c === c2 || c === c3) continue;
              for (const r of rowArr) {
                if (this.userGrid[r][c] === 0 && this.getCandidates(r, c).has(digit)) {
                  eliminated.push([r, c]);
                }
              }
            }
            if (eliminated.length > 0) {
              const definers: [number, number][] = [];
              for (const [c, rows] of [[c1, rows1], [c2, rows2], [c3, rows3]] as [number, number[]][]) {
                for (const r of rows) definers.push([r, c]);
              }
              return {
                type: 'swordfish',
                action: 'eliminate',
                targetCell: [rows1[0], c1],
                digit,
                digits: [digit],
                explanation: `Swordfish: הספרה ${digit} מוגבלת לשלוש עמודות ושלוש שורות – אפשר למחוק אותה משאר אותן שורות`,
                highlightCells: uniqueCells([...definers]),
                eliminationCells: uniqueCells([...eliminated]),
              };
            }
          }
        }
      }
    }
    return null;
  }

  /** Fallback: reveal cell with fewest candidates */
  private fallbackHint(): Hint | null {
    let best: [number, number] | null = null;
    let bestCount = 10;

    for (const [r, c] of this.emptyCells()) {
      const count = this.getCandidates(r, c).size;
      if (count < bestCount) {
        bestCount = count;
        best = [r, c];
      }
    }

    if (!best) return null;

    const [r, c] = best;
    const digit = this.solution[r][c];

    return {
      type: 'fallback',
      action: 'place',
      targetCell: [r, c],
      digit,
      digits: [digit],
      explanation: 'נסה את התא הזה – יש לו הכי פחות אפשרויות',
      highlightCells: [[r, c]],
      eliminationCells: [],
    };
  }
}
