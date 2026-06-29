import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { acceptPuzzle, buildTier } from '../src/pipeline.ts';
import { MAX_CONSECUTIVE_BATCH_FAILURES } from '../src/config.ts';
import { checkpointPath } from '../src/checkpoint.ts';
import type { SolveResult } from '../src/qqwing.ts';
import type { Grade } from '../src/grader.ts';

// 18-clue, 180-symmetric blank pattern (cells i and 80-i filled together).
const SYM_PUZZLE = (() => {
  const a = Array(81).fill('0');
  for (let i = 0; i < 9; i++) { a[i] = '1'; a[80 - i] = '1'; }
  return a.join('');
})();
const SOLUTION = '123456789'.repeat(9);
const okSolve = { puzzle: SYM_PUZZLE, solution: SOLUTION, solutionCount: 1 };
const easyGrade = { solvable: true, difficulty: 'easy' as const, techniques: ['naked_singles', 'hidden_singles'] };

test('accepts a unique, symmetric, logic-solvable easy puzzle', () => {
  const r = acceptPuzzle({ tier: 'easy', solve: okSolve, grade: easyGrade, now: '2026-06-28T00:00:00Z' });
  assert.ok(r);
  assert.equal(r!.difficulty, 'easy');
  assert.equal(r!.fun_score, 2);
});

test('rejects non-unique puzzles', () => {
  const r = acceptPuzzle({ tier: 'easy', solve: { ...okSolve, solutionCount: 2, solution: null }, grade: easyGrade, now: 'x' });
  assert.equal(r, null);
});

test('rejects when grader difficulty does not match the tier', () => {
  // medium tier requires grader 'medium'; an 'easy' grade is a mislabeled trivial medium.
  const r = acceptPuzzle({ tier: 'medium', solve: okSolve, grade: easyGrade, now: 'x' });
  assert.equal(r, null);
});

test('rejects asymmetric puzzles', () => {
  const asym = '1' + '0'.repeat(80);
  const r = acceptPuzzle({ tier: 'easy', solve: { puzzle: asym, solution: SOLUTION, solutionCount: 1 }, grade: easyGrade, now: 'x' });
  assert.equal(r, null);
});

test('rejects puzzles that need guessing', () => {
  const r = acceptPuzzle({ tier: 'easy', solve: okSolve, grade: { solvable: false, difficulty: null, techniques: [] }, now: 'x' });
  assert.equal(r, null);
});

// ---------------------------------------------------------------------------
// buildTier retry tests (no Docker — injected fake IO fns)
// ---------------------------------------------------------------------------

test('buildTier retries a failed batch and succeeds when next call succeeds', async () => {
  const cp = checkpointPath('very_easy');
  fs.rmSync(cp, { force: true });

  let calls = 0;
  const fakeGenerate = async (_tier: string, _n: number): Promise<string[]> => {
    calls++;
    if (calls === 1) throw new Error('simulated generate failure');
    return [SYM_PUZZLE];
  };
  const fakeSolveAndCount = async (puzzles: string[]): Promise<SolveResult[]> =>
    puzzles.map((p) => ({ puzzle: p, solution: SOLUTION, solutionCount: 1 }));
  const fakeGradeBatch = async (puzzles: string[]): Promise<Grade[]> =>
    puzzles.map(() => ({ solvable: true, difficulty: 'easy' as const, techniques: ['naked_singles'] }));

  const result = await buildTier('very_easy', {
    target: 1,
    generate: fakeGenerate as any,
    solveAndCount: fakeSolveAndCount as any,
    gradeBatch: fakeGradeBatch as any,
  });

  assert.equal(result.length, 1);
  fs.rmSync(cp, { force: true });
});

test('buildTier aborts after MAX_CONSECUTIVE_BATCH_FAILURES consecutive failures', async () => {
  const cp = checkpointPath('very_easy');
  fs.rmSync(cp, { force: true });

  const fakeGenerate = async (): Promise<string[]> => {
    throw new Error('always fails');
  };

  await assert.rejects(
    () => buildTier('very_easy', {
      target: 1,
      generate: fakeGenerate as any,
      solveAndCount: async () => [],
      gradeBatch: async () => [],
    }),
    (err: Error) => {
      assert.match(err.message, /aborted after \d+ consecutive batch failures/);
      return true;
    },
  );

  fs.rmSync(cp, { force: true });
});
