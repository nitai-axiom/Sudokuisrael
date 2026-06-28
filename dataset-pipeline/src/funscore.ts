import type { Grade } from './grader.ts';

/** Lower-tier fun-score: null = reject (needs guessing); otherwise 0–5 technique variety. */
export function funScore(grade: Grade): number | null {
  if (!grade.solvable) return null;
  const distinct = new Set(grade.techniques).size;
  return Math.min(5, distinct);
}
