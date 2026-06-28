import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGradeLine } from '../src/grader.ts';

test('parseGradeLine reads a solvable easy grade', () => {
  const g = parseGradeLine('{"solvable":true,"difficulty":"easy","techniques":["naked_singles","hidden_singles"]}');
  assert.equal(g.solvable, true);
  assert.equal(g.difficulty, 'easy');
  assert.deepEqual(g.techniques, ['naked_singles', 'hidden_singles']);
});

test('parseGradeLine reads an unsolvable grade', () => {
  const g = parseGradeLine('{"solvable":false,"difficulty":null,"techniques":[]}');
  assert.equal(g.solvable, false);
  assert.equal(g.difficulty, null);
  assert.deepEqual(g.techniques, []);
});

test('parseGradeLine throws on malformed JSON', () => {
  assert.throws(() => parseGradeLine('not json'));
});
