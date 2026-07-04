import { MIN_CLUES, MIN_CLUES_SYMMETRIC } from './config.ts';

/** Normalize a grid string: trim, map '.' → '0', validate 81 chars of [0-9]. */
export function normalizeBlanks(s: string): string {
  const t = s.trim();
  const out = t.replace(/\./g, '0');
  if (out.length !== 81) throw new Error(`grid must be 81 chars, got ${out.length}`);
  if (!/^[0-9]{81}$/.test(out)) throw new Error('grid contains non-digit characters');
  return out;
}

export function clueCount(puzzle: string): number {
  let n = 0;
  for (const c of puzzle) if (c !== '0') n++;
  return n;
}

/** True iff the filled/blank pattern is invariant under 180° rotation. */
export function isSymmetric180(puzzle: string): boolean {
  for (let i = 0; i < 81; i++) {
    const filled = puzzle[i] !== '0';
    const partnerFilled = puzzle[80 - i] !== '0';
    if (filled !== partnerFilled) return false;
  }
  return true;
}

/**
 * Dedupe key. We dedupe on the exact normalized puzzle string. Full
 * transform-canonicalization (rotation/mirror/relabel) is intentionally out of
 * scope: qqwing's random generation makes exact-string collisions the realistic
 * duplicate, and string dedupe is O(1) per puzzle. (Revisit only if dup rates show
 * disguised duplicates.)
 */
export function canonicalKey(puzzle: string): string {
  return normalizeBlanks(puzzle);
}

export function passesClueFloor(puzzle: string, symmetric: boolean): boolean {
  const floor = symmetric ? MIN_CLUES_SYMMETRIC : MIN_CLUES;
  return clueCount(puzzle) >= floor;
}
