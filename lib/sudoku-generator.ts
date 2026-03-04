// sudoku-generator.ts
// Pure TypeScript Sudoku generator. No external dependencies.
// Output format matches the Rust pipeline tool.

export interface PuzzleRecord {
  puzzle: string;       // 81-char, '0' = empty
  solution: string;     // 81-char, fully filled
  difficulty: 'easy' | 'medium' | 'hard';
  techniques: string[]; // e.g. ['naked_singles', 'hidden_singles']
  givens: number;
  generated_at: string; // ISO 8601
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Return the 3×3 box index (0–8) for a flat cell index (0–80). */
function boxOf(idx: number): number {
  const row = Math.floor(idx / 9);
  const col = idx % 9;
  return Math.floor(row / 3) * 3 + Math.floor(col / 3);
}

/** Return true if placing `digit` at `idx` violates no constraints. */
function isValid(grid: number[], idx: number, digit: number): boolean {
  const row = Math.floor(idx / 9);
  const col = idx % 9;
  const boxRow = Math.floor(row / 3) * 3;
  const boxCol = Math.floor(col / 3) * 3;

  for (let i = 0; i < 9; i++) {
    // Row check
    if (grid[row * 9 + i] === digit) return false;
    // Col check
    if (grid[i * 9 + col] === digit) return false;
    // Box check
    if (grid[(boxRow + Math.floor(i / 3)) * 9 + boxCol + (i % 3)] === digit) return false;
  }
  return true;
}

// ─── Step 1: Fill Grid ───────────────────────────────────────────────────────

/**
 * Randomised backtracking. Mutates `grid` in place.
 * Returns true when the grid is fully filled.
 */
function fillGrid(grid: number[]): boolean {
  const empty = grid.indexOf(0);
  if (empty === -1) return true; // all filled

  const digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const d of digits) {
    if (isValid(grid, empty, d)) {
      grid[empty] = d;
      if (fillGrid(grid)) return true;
      grid[empty] = 0;
    }
  }
  return false;
}

// ─── Step 2: Count Solutions ─────────────────────────────────────────────────

/**
 * Deterministic backtracking solver that stops once `max` solutions found.
 * Returns 0, 1, or `max`.
 */
function countSolutions(grid: number[], max: number): number {
  const empty = grid.indexOf(0);
  if (empty === -1) return 1; // one complete solution found

  let count = 0;
  for (let d = 1; d <= 9; d++) {
    if (isValid(grid, empty, d)) {
      grid[empty] = d;
      count += countSolutions(grid, max);
      grid[empty] = 0;
      if (count >= max) return count;
    }
  }
  return count;
}

// ─── Step 3: Dig Holes ───────────────────────────────────────────────────────

/**
 * Starting from a complete solution, remove as many digits as possible
 * while preserving a unique solution.
 */
function digHoles(solution: number[]): number[] {
  const candidate = [...solution];
  const positions = shuffle([...Array(81).keys()]);

  for (const pos of positions) {
    const saved = candidate[pos];
    candidate[pos] = 0;

    const test = [...candidate];
    if (countSolutions(test, 2) !== 1) {
      candidate[pos] = saved; // restore — uniqueness broken
    }
  }
  return candidate;
}

// ─── Step 4: Grade Difficulty ────────────────────────────────────────────────

interface GradeResult {
  difficulty: 'easy' | 'medium' | 'hard';
  techniques: string[];
}

/**
 * Simulate human-style solving using candidate sets.
 * Identifies which techniques were needed.
 */
function gradeDifficulty(puzzle: number[]): GradeResult {
  // candidates[i] = Set of possible digits for cell i (null if given)
  const candidates: (Set<number> | null)[] = puzzle.map(v =>
    v === 0 ? new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]) : null
  );

  // Eliminate candidates based on givens
  for (let i = 0; i < 81; i++) {
    if (puzzle[i] !== 0) {
      eliminateDigit(candidates, i, puzzle[i]);
    }
  }

  const techniquesUsed = new Set<string>();
  let progress = true;

  while (progress) {
    progress = false;

    // 1. Naked singles
    if (applyNakedSingles(candidates)) {
      techniquesUsed.add('naked_singles');
      progress = true;
      continue;
    }

    // 2. Hidden singles
    if (applyHiddenSingles(candidates)) {
      techniquesUsed.add('hidden_singles');
      progress = true;
      continue;
    }

    // 3. Locked candidates
    if (applyLockedCandidates(candidates)) {
      techniquesUsed.add('locked_candidates');
      progress = true;
      continue;
    }

    // 4. Naked pairs
    if (applyNakedPairs(candidates)) {
      techniquesUsed.add('naked_pairs');
      progress = true;
      continue;
    }
  }

  const solved = candidates.every(c => c === null || c.size === 1);

  let difficulty: 'easy' | 'medium' | 'hard';
  if (!solved) {
    difficulty = 'hard';
  } else if (techniquesUsed.has('locked_candidates') || techniquesUsed.has('naked_pairs')) {
    difficulty = 'medium';
  } else {
    difficulty = 'easy';
  }

  return { difficulty, techniques: [...techniquesUsed] };
}

// ── Candidate elimination helper ─────────────────────────────────────────────

function eliminateDigit(candidates: (Set<number> | null)[], sourceIdx: number, digit: number): void {
  const row = Math.floor(sourceIdx / 9);
  const col = sourceIdx % 9;
  const boxRow = Math.floor(row / 3) * 3;
  const boxCol = Math.floor(col / 3) * 3;

  for (let i = 0; i < 9; i++) {
    const rIdx = row * 9 + i;
    const cIdx = i * 9 + col;
    const bIdx = (boxRow + Math.floor(i / 3)) * 9 + boxCol + (i % 3);

    candidates[rIdx]?.delete(digit);
    candidates[cIdx]?.delete(digit);
    candidates[bIdx]?.delete(digit);
  }
}

function placeDigit(candidates: (Set<number> | null)[], idx: number, digit: number): void {
  candidates[idx] = null; // mark as placed
  eliminateDigit(candidates, idx, digit);
}

// ── Technique: Naked Singles ─────────────────────────────────────────────────

function applyNakedSingles(candidates: (Set<number> | null)[]): boolean {
  let changed = false;
  for (let i = 0; i < 81; i++) {
    const c = candidates[i];
    if (c !== null && c.size === 1) {
      const digit = c.values().next().value as number;
      placeDigit(candidates, i, digit);
      changed = true;
    }
  }
  return changed;
}

// ── Technique: Hidden Singles ─────────────────────────────────────────────────

/**
 * For each unit (row/col/box), if a digit appears as a candidate in only
 * one cell, place it there.
 */
function applyHiddenSingles(candidates: (Set<number> | null)[]): boolean {
  let changed = false;

  const units: number[][] = [];

  // Rows
  for (let r = 0; r < 9; r++) {
    units.push([...Array(9).keys()].map(c => r * 9 + c));
  }
  // Cols
  for (let c = 0; c < 9; c++) {
    units.push([...Array(9).keys()].map(r => r * 9 + c));
  }
  // Boxes
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const box: number[] = [];
      for (let dr = 0; dr < 3; dr++) {
        for (let dc = 0; dc < 3; dc++) {
          box.push((br * 3 + dr) * 9 + (bc * 3 + dc));
        }
      }
      units.push(box);
    }
  }

  for (const unit of units) {
    for (let digit = 1; digit <= 9; digit++) {
      const positions = unit.filter(idx => candidates[idx]?.has(digit));
      if (positions.length === 1) {
        const idx = positions[0];
        if (candidates[idx] !== null && candidates[idx]!.size > 1) {
          placeDigit(candidates, idx, digit);
          changed = true;
        }
      }
    }
  }

  return changed;
}

// ── Technique: Locked Candidates ─────────────────────────────────────────────

/**
 * If all candidates for a digit in a box lie in a single row/col,
 * eliminate that digit from the rest of that row/col.
 * And vice versa (row/col → box).
 */
function applyLockedCandidates(candidates: (Set<number> | null)[]): boolean {
  let changed = false;

  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      // Collect box cells
      const boxCells: number[] = [];
      for (let dr = 0; dr < 3; dr++) {
        for (let dc = 0; dc < 3; dc++) {
          boxCells.push((br * 3 + dr) * 9 + (bc * 3 + dc));
        }
      }

      for (let digit = 1; digit <= 9; digit++) {
        const inBox = boxCells.filter(idx => candidates[idx]?.has(digit));
        if (inBox.length < 2) continue;

        // Check if all are in same row
        const rows = new Set(inBox.map(idx => Math.floor(idx / 9)));
        if (rows.size === 1) {
          const row = rows.values().next().value as number;
          for (let c = 0; c < 9; c++) {
            const idx = row * 9 + c;
            if (!boxCells.includes(idx) && candidates[idx]?.has(digit)) {
              candidates[idx]!.delete(digit);
              changed = true;
            }
          }
        }

        // Check if all are in same col
        const cols = new Set(inBox.map(idx => idx % 9));
        if (cols.size === 1) {
          const col = cols.values().next().value as number;
          for (let r = 0; r < 9; r++) {
            const idx = r * 9 + col;
            if (!boxCells.includes(idx) && candidates[idx]?.has(digit)) {
              candidates[idx]!.delete(digit);
              changed = true;
            }
          }
        }
      }

      // Row → box: if all candidates for digit in a row lie in this box,
      // eliminate from rest of box
      for (let r = br * 3; r < br * 3 + 3; r++) {
        for (let digit = 1; digit <= 9; digit++) {
          const inRow = [...Array(9).keys()]
            .map(c => r * 9 + c)
            .filter(idx => candidates[idx]?.has(digit));
          if (inRow.length < 2) continue;
          const allInBox = inRow.every(idx => boxCells.includes(idx));
          if (allInBox) {
            for (const idx of boxCells) {
              if (!inRow.includes(idx) && candidates[idx]?.has(digit)) {
                candidates[idx]!.delete(digit);
                changed = true;
              }
            }
          }
        }
      }

      // Col → box
      for (let c = bc * 3; c < bc * 3 + 3; c++) {
        for (let digit = 1; digit <= 9; digit++) {
          const inCol = [...Array(9).keys()]
            .map(r => r * 9 + c)
            .filter(idx => candidates[idx]?.has(digit));
          if (inCol.length < 2) continue;
          const allInBox = inCol.every(idx => boxCells.includes(idx));
          if (allInBox) {
            for (const idx of boxCells) {
              if (!inCol.includes(idx) && candidates[idx]?.has(digit)) {
                candidates[idx]!.delete(digit);
                changed = true;
              }
            }
          }
        }
      }
    }
  }

  return changed;
}

// ── Technique: Naked Pairs ───────────────────────────────────────────────────

/**
 * If two cells in a unit share exactly the same two candidates,
 * eliminate those digits from all other cells in the unit.
 */
function applyNakedPairs(candidates: (Set<number> | null)[]): boolean {
  let changed = false;

  const units: number[][] = [];
  for (let r = 0; r < 9; r++) units.push([...Array(9).keys()].map(c => r * 9 + c));
  for (let c = 0; c < 9; c++) units.push([...Array(9).keys()].map(r => r * 9 + c));
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const box: number[] = [];
      for (let dr = 0; dr < 3; dr++) {
        for (let dc = 0; dc < 3; dc++) {
          box.push((br * 3 + dr) * 9 + (bc * 3 + dc));
        }
      }
      units.push(box);
    }
  }

  for (const unit of units) {
    const pairs = unit.filter(idx => candidates[idx]?.size === 2);
    for (let i = 0; i < pairs.length; i++) {
      for (let j = i + 1; j < pairs.length; j++) {
        const a = candidates[pairs[i]]!;
        const b = candidates[pairs[j]]!;
        const [d1, d2] = [...a];
        if (a.size === 2 && b.size === 2 && a.has(d2) && b.has(d1) && b.has(d2)) {
          // Found a naked pair — eliminate from rest of unit
          for (const idx of unit) {
            if (idx === pairs[i] || idx === pairs[j]) continue;
            const c = candidates[idx];
            if (c?.has(d1)) { c.delete(d1); changed = true; }
            if (c?.has(d2)) { c.delete(d2); changed = true; }
          }
        }
      }
    }
  }

  return changed;
}

// ─── Step 5: generatePuzzle ───────────────────────────────────────────────────

export function generatePuzzle(difficulty?: 'easy' | 'medium' | 'hard'): PuzzleRecord {
  while (true) {
    // Fill a complete grid
    const solution = new Array(81).fill(0);
    fillGrid(solution);

    // Dig holes to produce a puzzle
    const puzzle = digHoles(solution);

    // Grade
    const { difficulty: rated, techniques } = gradeDifficulty(puzzle);

    // Accept if matches desired difficulty (or any if unspecified)
    if (!difficulty || rated === difficulty) {
      const givens = puzzle.filter(v => v !== 0).length;
      return {
        puzzle: puzzle.map(v => String(v)).join(''),
        solution: solution.map(v => String(v)).join(''),
        difficulty: rated,
        techniques,
        givens,
        generated_at: new Date().toISOString(),
      };
    }
  }
}

// ─── Step 6: generateBatch ────────────────────────────────────────────────────

export function generateBatch(
  count: number,
  difficulty?: 'easy' | 'medium' | 'hard'
): PuzzleRecord[] {
  const results: PuzzleRecord[] = [];
  for (let i = 0; i < count; i++) {
    results.push(generatePuzzle(difficulty));
  }
  return results;
}
