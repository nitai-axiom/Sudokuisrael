import { test } from 'node:test';
import assert from 'node:assert/strict';
import { funScore } from '../src/funscore.ts';

test('unsolvable puzzles are rejected (null)', () => {
  assert.equal(funScore({ solvable: false, difficulty: null, techniques: [] }), null);
});

test('score equals distinct technique count', () => {
  assert.equal(funScore({ solvable: true, difficulty: 'easy', techniques: ['naked_singles', 'hidden_singles'] }), 2);
});

test('score is clamped to 5', () => {
  const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  assert.equal(funScore({ solvable: true, difficulty: 'medium', techniques: many }), 5);
});

test('deduplicates technique names before counting', () => {
  assert.equal(funScore({ solvable: true, difficulty: 'easy', techniques: ['naked_singles', 'naked_singles'] }), 1);
});
