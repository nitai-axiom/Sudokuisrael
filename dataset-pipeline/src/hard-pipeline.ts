import { TARGETS, ER_MIN, ER_MAX, BATCH_SIZE, MAX_CONSECUTIVE_BATCH_FAILURES } from './config.ts';
import { passesClueFloor } from './grid.ts';
import { solveAndCount, type SolveResult } from './qqwing.ts';
import { generateHard, type HodokuPuzzle } from './hodoku.ts';
import { rate, type Rating } from './serate.ts';
import { buildRecord, validateRecord, type PuzzleRecord } from './record.ts';
import { loadCheckpoint, appendCheckpoint } from './checkpoint.ts';
import { dedupeByPuzzle } from './dedupe.ts';

// NOTE: isSymmetric180 is intentionally NOT imported or called here.
// Owner decision 2026-06-29: HoDoKu cannot generate symmetric puzzles (0/200 = 0.0% symmetric
// in an empirical run). The symmetry gate is dropped for the hard tier only. All other gates
// remain: uniqueness, ER band, and clue floor.

/** Pure acceptance gate for one hard candidate. Returns the record or null (rejected). */
export function acceptHard(args: {
  solve: SolveResult; er: number | null; techniques: string[]; now: string;
}): PuzzleRecord | null {
  const { solve, er, techniques, now } = args;

  // 1. Trusted uniqueness gate (qqwing solveAndCount — trusted, not HoDoKu output).
  if (solve.solutionCount !== 1 || !solve.solution) return null;

  // 2. ER band filter.
  if (er === null || er < ER_MIN || er > ER_MAX) return null;

  // 3. Clue floor (asymmetric puzzles use the non-symmetric floor of 17).
  if (!passesClueFloor(solve.puzzle, false)) return null;

  // 4. Build + validate the record.
  const tech = techniques.length > 0 ? techniques : ['x_wing'];   // fallback technique tag
  const record = buildRecord({
    puzzle: solve.puzzle,
    solution: solve.solution,
    tier: 'hard',
    grade: { techniques: tech },
    funScore: null,
    erRating: er,
    now,
  });
  if (validateRecord(record).length > 0) return null;

  return record;
}

/** Over-generation loop for the hard tier; resumes from checkpoint until target survivors. */
export async function buildHardTier(opts?: {
  target?: number;
  now?: () => string;
  generateHard?: typeof generateHard;
  solveAndCount?: typeof solveAndCount;
  rate?: typeof rate;
}): Promise<PuzzleRecord[]> {
  const target = opts?.target ?? TARGETS.hard;
  const now = opts?.now ?? (() => new Date().toISOString());
  const gen = opts?.generateHard ?? generateHard;
  const solve = opts?.solveAndCount ?? solveAndCount;
  const rateF = opts?.rate ?? rate;

  let survivors = loadCheckpoint('hard');
  let rounds = 0;
  let consecutiveFailures = 0;
  while (survivors.length < target) {
    try {
      const batch: HodokuPuzzle[] = await gen(BATCH_SIZE);
      const puzzles = batch.map((b) => b.puzzle);
      const [solves, ratings]: [SolveResult[], Rating[]] = await Promise.all([solve(puzzles), rateF(puzzles)]);

      // FIX 3: guard against wrapper length mismatches (treats as a retryable batch failure).
      if (solves.length !== puzzles.length || ratings.length !== puzzles.length) {
        throw new Error(
          `wrapper length mismatch: ${puzzles.length} puzzles, ${solves.length} solves, ${ratings.length} ratings`,
        );
      }

      const accepted: PuzzleRecord[] = [];
      for (let i = 0; i < puzzles.length; i++) {
        const r = acceptHard({
          solve: solves[i],
          er: ratings[i]?.er ?? null,
          techniques: batch[i].techniques,
          now: now(),
        });
        if (r) accepted.push(r);
      }
      const fresh = dedupeByPuzzle([...survivors, ...accepted]).slice(survivors.length);
      appendCheckpoint('hard', fresh);
      survivors = survivors.concat(fresh);

      rounds++;
      process.stderr.write(`\r  hard: ${survivors.length}/${target} (round ${rounds})`);
      if (rounds > 100_000) throw new Error(`hard: gave up after ${rounds} rounds`);
      consecutiveFailures = 0;
    } catch (e) {
      consecutiveFailures++;
      process.stderr.write(`\n  hard: batch failed (${(e as Error).message}); retry ${consecutiveFailures}/${MAX_CONSECUTIVE_BATCH_FAILURES}\n`);
      if (consecutiveFailures >= MAX_CONSECUTIVE_BATCH_FAILURES) {
        throw new Error(`hard: aborted after ${consecutiveFailures} consecutive batch failures: ${(e as Error).message}`);
      }
      continue;
    }
  }
  process.stderr.write('\n');
  return survivors.slice(0, target);
}
