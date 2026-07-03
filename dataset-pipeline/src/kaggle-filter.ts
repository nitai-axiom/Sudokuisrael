import { KAGGLE_PREFILTER, TIERS, type Tier } from './config.ts';
import { normalizeBlanks } from './grid.ts';

export type KaggleRow = { sourceId: number; puzzle: string; clues: number; difficulty: number };

// Columns: id,puzzle,solution,clues,difficulty. Puzzle/solution are digits+dots (no commas),
// so a plain split is safe for this dataset.
export function parseKaggleLine(line: string): KaggleRow | null {
  const t = line.trim();
  if (t.length === 0) return null;
  if (t.startsWith('id,')) return null; // header
  const parts = t.split(',');
  if (parts.length !== 5) return null;
  // Number('') === 0 (finite), so an empty numeric field would fabricate a bogus row.
  if (parts[0].trim() === '' || parts[3].trim() === '' || parts[4].trim() === '') return null;
  const sourceId = Number(parts[0]);
  const clues = Number(parts[3]);
  const difficulty = Number(parts[4]);
  if (!Number.isFinite(sourceId) || !Number.isFinite(clues) || !Number.isFinite(difficulty)) return null;
  let puzzle: string;
  try {
    puzzle = normalizeBlanks(parts[1]); // '.'→'0', asserts 81 chars
  } catch {
    return null;
  }
  return { sourceId, puzzle, clues, difficulty };
}

export function prefilterTier(clues: number, difficulty: number): Tier | null {
  for (const tier of TIERS) {
    const b = KAGGLE_PREFILTER[tier];
    if (clues >= b.cluesMin && clues <= b.cluesMax && difficulty >= b.kdMin && difficulty <= b.kdMax) {
      return tier;
    }
  }
  return null;
}
