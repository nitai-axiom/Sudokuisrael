import {
  EXPECTED_GRADE, HARD_ER_MIN_FAIR, HARD_ER_MAX_FAIR, type LowerTier,
  KAGGLE_TARGETS, BATCH_SIZE, type Tier,
} from './config.ts';
import { passesClueFloor } from './grid.ts';
import { solveAndCount as realSolve, type SolveResult } from './qqwing.ts';
import { gradeBatch as realGrade, type Grade } from './grader.ts';
import { rate as realRate, type Rating } from './serate.ts';
import { funScore } from './funscore.ts';
import { buildRecord, validateRecord, type PuzzleRecord } from './record.ts';
import { loadCheckpoint, appendCheckpoint, loadCursor, saveCursor } from './checkpoint.ts';
import { dedupeByPuzzle } from './dedupe.ts';

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

export type Candidate = { sourceId: number; puzzle: string };

/**
 * Finite-candidate build loop for the Kaggle pipeline: consumes a fixed list of
 * pre-fetched candidates (in BATCH_SIZE slices from a resumable cursor), solves/grades
 * (and rates, hard-only) each batch, routes puzzles through the tier's accept gate,
 * dedupes against accumulated survivors, and checkpoints progress every batch.
 *
 * Does NOT throw when candidates run out — returns fewer than target with a WARN.
 */
export async function buildKaggleTier(tier: Tier, candidates: Candidate[], opts?: {
  target?: number; now?: () => string;
  solveAndCount?: typeof realSolve; gradeBatch?: typeof realGrade; rate?: typeof realRate;
}): Promise<PuzzleRecord[]> {
  const target = opts?.target ?? KAGGLE_TARGETS[tier];
  const now = opts?.now ?? (() => new Date().toISOString());
  const solve = opts?.solveAndCount ?? realSolve;
  const grade = opts?.gradeBatch ?? realGrade;
  const rateF = opts?.rate ?? realRate;

  let survivors = loadCheckpoint(tier);
  let cursor = loadCursor(tier);

  while (survivors.length < target && cursor < candidates.length) {
    const batch = candidates.slice(cursor, cursor + BATCH_SIZE);
    const puzzles = batch.map((c) => c.puzzle);

    const solves = await solve(puzzles);
    const grades = await grade(puzzles);
    const ratings: Rating[] = tier === 'hard' ? await rateF(puzzles) : puzzles.map((p) => ({ puzzle: p, er: null }));
    if (solves.length !== puzzles.length || grades.length !== puzzles.length || ratings.length !== puzzles.length) {
      throw new Error(`wrapper length mismatch in ${tier}`);
    }

    const accepted: PuzzleRecord[] = [];
    for (let i = 0; i < puzzles.length; i++) {
      const r = tier === 'hard'
        ? acceptKaggleHard({ solve: solves[i], er: ratings[i]?.er ?? null, grade: grades[i], sourceId: batch[i].sourceId, now: now() })
        : acceptKaggleLower({ tier: tier as LowerTier, solve: solves[i], grade: grades[i], sourceId: batch[i].sourceId, now: now() });
      if (r) accepted.push(r);
    }

    const fresh = dedupeByPuzzle([...survivors, ...accepted]).slice(survivors.length);
    appendCheckpoint(tier, fresh);
    survivors = survivors.concat(fresh);
    cursor += batch.length;
    saveCursor(tier, cursor);
    process.stderr.write(`\r  ${tier}: ${survivors.length}/${target} (consumed ${cursor}/${candidates.length})`);
  }
  process.stderr.write('\n');
  if (survivors.length < target) {
    process.stderr.write(`  WARN ${tier}: ran out of candidates at ${survivors.length}/${target} — raise oversample factor\n`);
  }
  return survivors.slice(0, target);
}
