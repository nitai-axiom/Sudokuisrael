import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadCheckpoint, appendCheckpoint, checkpointPath } from '../src/checkpoint.ts';

const rec = (puzzle: string) => ({
  puzzle, solution: '123456789'.repeat(9), difficulty: 'easy' as const,
  techniques: ['naked_singles'], givens: 81, er_rating: null, fun_score: 1,
  generated_at: '2026-06-28T00:00:00Z',
});

test('append then load round-trips and dedupes', () => {
  const p = checkpointPath('easy');
  fs.rmSync(p, { force: true });
  const A = '1'.repeat(81), B = '2'.repeat(81);
  appendCheckpoint('easy', [rec(A)]);
  appendCheckpoint('easy', [rec(B), rec(A)]); // A duplicated
  const loaded = loadCheckpoint('easy');
  assert.equal(loaded.length, 2);
  fs.rmSync(p, { force: true });
});

test('loadCheckpoint returns [] when file missing', () => {
  const p = checkpointPath('medium');
  fs.rmSync(p, { force: true });
  assert.deepEqual(loadCheckpoint('medium'), []);
});
