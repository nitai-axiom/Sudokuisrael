import { EXPECTED_GRADE, HARD_ER_MIN_FAIR, HARD_ER_MAX_FAIR, type LowerTier } from './config.ts';
import { passesClueFloor } from './grid.ts';
import type { SolveResult } from './qqwing.ts';
import type { Grade } from './grader.ts';
import { funScore } from './funscore.ts';
import { buildRecord, validateRecord, type PuzzleRecord } from './record.ts';

/** Lower-tier accept gate (symmetry removed vs the qqwing pipeline). */
export function acceptKaggleLower(args: {
  tier: LowerTier; solve: SolveResult; grade: Grade; sourceId: number; now: string;
}): PuzzleRecord | null {
  const { tier, solve, grade, sourceId, now } = args;
  if (solve.solutionCount !== 1 || !solve.solution) return null;   // trusted uniqueness
  if (!passesClueFloor(solve.puzzle, false)) return null;          // asymmetric floor (17)
  const score = funScore(grade);                                   // null ⇒ needs guessing
  if (score === null) return null;
  if (grade.difficulty !== EXPECTED_GRADE[tier]) return null;      // real difficulty
  const record = buildRecord({ puzzle: solve.puzzle, solution: solve.solution, tier, grade, funScore: score, now, sourceId });
  if (validateRecord(record).length > 0) return null;
  return record;
}

/** Hard accept gate: fair serate band + pure-logic (no guessing). */
export function acceptKaggleHard(args: {
  solve: SolveResult; er: number | null; grade: Grade; sourceId: number; now: string;
}): PuzzleRecord | null {
  const { solve, er, grade, sourceId, now } = args;
  if (solve.solutionCount !== 1 || !solve.solution) return null;
  if (er === null || er < HARD_ER_MIN_FAIR || er > HARD_ER_MAX_FAIR) return null;
  if (!grade.solvable) return null;                                // no guessing
  if (!passesClueFloor(solve.puzzle, false)) return null;
  const tech = grade.techniques.length > 0 ? grade.techniques : ['x_wing'];
  const record = buildRecord({
    puzzle: solve.puzzle, solution: solve.solution, tier: 'hard',
    grade: { techniques: tech }, funScore: null, erRating: er, now, sourceId,
  });
  if (validateRecord(record).length > 0) return null;
  return record;
}
