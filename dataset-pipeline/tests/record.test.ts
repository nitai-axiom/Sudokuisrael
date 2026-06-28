import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecord, validateRecord } from '../src/record.ts';

const PUZZLE = '1'.repeat(24) + '0'.repeat(57);
const SOLUTION = '123456789'.repeat(9);
const grade = { solvable: true, difficulty: 'easy' as const, techniques: ['naked_singles'] };

test('buildRecord fills schema fields', () => {
  const r = buildRecord({ puzzle: PUZZLE, solution: SOLUTION, tier: 'easy', grade, funScore: 1, now: '2026-06-28T00:00:00Z' });
  assert.equal(r.difficulty, 'easy');
  assert.equal(r.givens, 24);
  assert.equal(r.er_rating, null);
  assert.equal(r.fun_score, 1);
  assert.deepEqual(r.techniques, ['naked_singles']);
  assert.equal(r.generated_at, '2026-06-28T00:00:00Z');
});

test('validateRecord accepts a good record', () => {
  const r = buildRecord({ puzzle: PUZZLE, solution: SOLUTION, tier: 'easy', grade, funScore: 1, now: '2026-06-28T00:00:00Z' });
  assert.deepEqual(validateRecord(r), []);
});

test('validateRecord rejects bad lengths and empty techniques', () => {
  const r = buildRecord({ puzzle: PUZZLE, solution: SOLUTION, tier: 'easy', grade, funScore: 1, now: '2026-06-28T00:00:00Z' });
  assert.ok(validateRecord({ ...r, puzzle: '123' }).length > 0);
  assert.ok(validateRecord({ ...r, solution: '123' }).length > 0);
  assert.ok(validateRecord({ ...r, techniques: [] }).length > 0);
});
