import { TARGETS, EXPECTED_GRADE, BATCH_SIZE, type Tier } from './config.ts';
import { isSymmetric180, passesClueFloor } from './grid.ts';
import { generate, solveAndCount, type SolveResult } from './qqwing.ts';
import { gradeBatch, type Grade } from './grader.ts';
import { funScore } from './funscore.ts';
import { buildRecord, validateRecord, type PuzzleRecord } from './record.ts';
import { loadCheckpoint, appendCheckpoint } from './checkpoint.ts';
import { dedupeByPuzzle } from './dedupe.ts';

/** Pure acceptance gate for one candidate. Returns the record or null (rejected). */
export function acceptPuzzle(args: {
  tier: Tier; solve: SolveResult; grade: Grade; now: string;
}): PuzzleRecord | null {
  const { tier, solve, grade, now } = args;

  // 1. Unique solution (the mandatory gate).
  if (solve.solutionCount !== 1 || !solve.solution) return null;

  // 2. 180° rotational symmetry of the givens.
  if (!isSymmetric180(solve.puzzle)) return null;

  // 3. Clue floor (always symmetric here → 18).
  if (!passesClueFloor(solve.puzzle, true)) return null;

  // 4. Pure-logic solvable + fun-score.
  const score = funScore(grade);
  if (score === null) return null;

  // 5. Grade matches the tier (real difficulty, not mislabeled).
  if (grade.difficulty !== EXPECTED_GRADE[tier]) return null;

  // 6. Build + validate the record.
  const record = buildRecord({ puzzle: solve.puzzle, solution: solve.solution, tier, grade, funScore: score, now });
  if (validateRecord(record).length > 0) return null;

  return record;
}

/** Over-generation loop for one tier; resumes from checkpoint until target survivors. */
export async function buildTier(tier: Tier, opts?: { target?: number; now?: () => string }): Promise<PuzzleRecord[]> {
  const target = opts?.target ?? TARGETS[tier];
  const now = opts?.now ?? (() => new Date().toISOString());

  let survivors = loadCheckpoint(tier);
  let rounds = 0;
  while (survivors.length < target) {
    const need = target - survivors.length;
    const puzzles = await generate(tier, Math.min(BATCH_SIZE, Math.max(need, 50)));
    const [solves, grades] = await Promise.all([solveAndCount(puzzles), gradeBatch(puzzles)]);

    const accepted: PuzzleRecord[] = [];
    for (let i = 0; i < puzzles.length; i++) {
      const r = acceptPuzzle({ tier, solve: solves[i], grade: grades[i], now: now() });
      if (r) accepted.push(r);
    }
    const fresh = dedupeByPuzzle([...survivors, ...accepted]).slice(survivors.length);
    appendCheckpoint(tier, fresh);
    survivors = survivors.concat(fresh);

    rounds++;
    process.stderr.write(`\r  ${tier}: ${survivors.length}/${target} (round ${rounds})`);
    if (rounds > 100_000) throw new Error(`${tier}: gave up after ${rounds} rounds`);
  }
  process.stderr.write('\n');
  return survivors.slice(0, target);
}
