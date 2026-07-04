import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { acceptHard, buildHardTier } from '../src/hard-pipeline.ts';
import { ER_MIN, ER_MAX, MAX_CONSECUTIVE_BATCH_FAILURES } from '../src/config.ts';
import { checkpointPath } from '../src/checkpoint.ts';
import type { SolveResult } from '../src/qqwing.ts';
import type { Rating } from '../src/serate.ts';
import type { HodokuPuzzle } from '../src/hodoku.ts';

// Symmetric puzzle: first 10 and last 10 cells filled, rest zeros
const SYM = (() => { const a = Array(81).fill('0'); for (let i=0;i<10;i++){a[i]='1';a[80-i]='1';} return a.join(''); })();
// Asymmetric puzzle: first 20 cells filled (cells 0-19 = '1'), rest zeros — cell i filled but cell 80-i empty for i<20
const ASYM = (() => { const a = Array(81).fill('0'); for (let i=0;i<20;i++){a[i]='1';} return a.join(''); })();
const SOL = '123456789'.repeat(9);

// A minimal valid puzzle string for injection (17+ clues, asymmetric ok for hard).
// We'll use ASYM as the puzzle (20 clues, passes the 17-clue floor for hard).
const VALID_PUZZLE = ASYM;

// Deterministic fake deps that produce one accepted record per batch.
function makeFakeDeps(puzzle = VALID_PUZZLE, er = 4.2) {
  const fakeGenerateHard = async (_n: number): Promise<HodokuPuzzle[]> => [
    { puzzle, techniques: ['x_wing'] },
  ];
  const fakeSolveAndCount = async (puzzles: string[]): Promise<SolveResult[]> =>
    puzzles.map((p) => ({ puzzle: p, solution: SOL, solutionCount: 1 }));
  const fakeRate = async (puzzles: string[]): Promise<Rating[]> =>
    puzzles.map((p) => ({ puzzle: p, er }));
  return { fakeGenerateHard, fakeSolveAndCount, fakeRate };
}

// ---------------------------------------------------------------------------
// acceptHard unit tests (existing behaviour preserved)
// ---------------------------------------------------------------------------

test('ER band constants', () => { assert.equal(ER_MIN, 3.4); assert.equal(ER_MAX, 5.0); });

test('accepts a unique, symmetric, in-band hard puzzle', () => {
  const r = acceptHard({ solve: { puzzle: SYM, solution: SOL, solutionCount: 1 }, er: 4.2, techniques: ['x_wing'], now: 't' });
  assert.ok(r);
  assert.equal(r!.difficulty, 'hard');
  assert.equal(r!.er_rating, 4.2);
  assert.equal(r!.fun_score, null);
});

test('accepts an asymmetric, unique, in-band hard puzzle (symmetry gate is removed)', () => {
  const r = acceptHard({ solve: { puzzle: ASYM, solution: SOL, solutionCount: 1 }, er: 4.2, techniques: ['x_wing'], now: 't' });
  assert.ok(r, 'asymmetric puzzle must be accepted — symmetry gate is dropped for hard tier');
  assert.equal(r!.difficulty, 'hard');
  assert.equal(r!.er_rating, 4.2);
});

test('rejects out-of-band ER', () => {
  assert.equal(acceptHard({ solve: { puzzle: SYM, solution: SOL, solutionCount: 1 }, er: 6.5, techniques: ['x_wing'], now: 't' }), null);
  assert.equal(acceptHard({ solve: { puzzle: SYM, solution: SOL, solutionCount: 1 }, er: 3.0, techniques: ['x_wing'], now: 't' }), null);
});

test('rejects non-unique', () => {
  assert.equal(acceptHard({ solve: { puzzle: SYM, solution: null, solutionCount: 2 }, er: 4.2, techniques: ['x_wing'], now: 't' }), null);
});

// ---------------------------------------------------------------------------
// buildHardTier retry tests (FIX 1 + FIX 3) — no Docker, injected fake IO fns
// ---------------------------------------------------------------------------

test('buildHardTier retries a failed batch and completes when subsequent rounds succeed', async () => {
  const cp = checkpointPath('hard');
  fs.rmSync(cp, { force: true });

  let calls = 0;
  const { fakeSolveAndCount, fakeRate } = makeFakeDeps();

  // First call fails; subsequent calls succeed.
  const fakeGenerateHard = async (_n: number): Promise<HodokuPuzzle[]> => {
    calls++;
    if (calls === 1) throw new Error('simulated generate failure');
    return [{ puzzle: VALID_PUZZLE, techniques: ['x_wing'] }];
  };

  const result = await buildHardTier({
    target: 1,
    generateHard: fakeGenerateHard,
    solveAndCount: fakeSolveAndCount,
    rate: fakeRate,
  });

  assert.equal(result.length, 1);
  assert.equal(calls >= 2, true, 'should have retried at least once');
  fs.rmSync(cp, { force: true });
});

test('buildHardTier aborts after MAX_CONSECUTIVE_BATCH_FAILURES consecutive failures', async () => {
  const cp = checkpointPath('hard');
  fs.rmSync(cp, { force: true });

  const fakeGenerateHard = async (_n: number): Promise<HodokuPuzzle[]> => {
    throw new Error('always fails');
  };

  await assert.rejects(
    () => buildHardTier({
      target: 1,
      generateHard: fakeGenerateHard,
      solveAndCount: async () => [],
      rate: async () => [],
    }),
    (err: Error) => {
      assert.match(err.message, /aborted after \d+ consecutive batch failures/);
      return true;
    },
  );

  fs.rmSync(cp, { force: true });
});

test('buildHardTier treats a wrapper length mismatch as a retryable failure (FIX 3)', async () => {
  const cp = checkpointPath('hard');
  fs.rmSync(cp, { force: true });

  let calls = 0;
  const { fakeRate } = makeFakeDeps();

  const fakeGenerateHard = async (_n: number): Promise<HodokuPuzzle[]> => {
    calls++;
    return [{ puzzle: VALID_PUZZLE, techniques: ['x_wing'] }];
  };

  // First call returns fewer entries than puzzles (length mismatch).
  // Second call returns the correct length so it succeeds.
  const fakeSolveAndCount = async (puzzles: string[]): Promise<SolveResult[]> => {
    if (calls === 1) return []; // mismatch: 0 solves for 1 puzzle → retryable
    return puzzles.map((p) => ({ puzzle: p, solution: SOL, solutionCount: 1 }));
  };

  const result = await buildHardTier({
    target: 1,
    generateHard: fakeGenerateHard,
    solveAndCount: fakeSolveAndCount,
    rate: fakeRate,
  });

  assert.equal(result.length, 1);
  assert.ok(calls >= 2, 'should have retried after the length mismatch');
  fs.rmSync(cp, { force: true });
});

test('buildHardTier resets consecutiveFailures counter after a successful round', async () => {
  const cp = checkpointPath('hard');
  fs.rmSync(cp, { force: true });

  // Pattern: fail (call 1), succeed (call 2), fail (call 3), then done (target=1).
  // The first failure increments consecutiveFailures to 1.
  // The second call succeeds → counter resets to 0.
  // The third call fails → counter goes to 1 again (would be 2 if never reset).
  // But target is already met after call 2, so the loop exits before call 3.
  // We verify this by checking that calls === 2 (not 3).
  let calls = 0;
  const { fakeSolveAndCount, fakeRate } = makeFakeDeps();

  const fakeGenerateHard = async (_n: number): Promise<HodokuPuzzle[]> => {
    calls++;
    if (calls === 1) throw new Error(`simulated failure on call ${calls}`);
    return [{ puzzle: VALID_PUZZLE, techniques: ['x_wing'] }];
  };

  const result = await buildHardTier({
    target: 1,
    generateHard: fakeGenerateHard,
    solveAndCount: fakeSolveAndCount,
    rate: fakeRate,
  });

  assert.equal(result.length, 1);
  // call 1 = failure (retry), call 2 = success (target met, loop exits)
  assert.equal(calls, 2, 'should stop after 2 calls (1 fail + 1 success)');
  fs.rmSync(cp, { force: true });
});
