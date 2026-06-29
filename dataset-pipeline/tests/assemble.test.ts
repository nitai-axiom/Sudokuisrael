import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortRecords } from '../src/assemble.ts';

const rec = (difficulty: any, givens: number) => ({
  puzzle: '1'.repeat(givens) + '0'.repeat(81 - givens), solution: '123456789'.repeat(9),
  difficulty, techniques: ['naked_singles'], givens, er_rating: null, fun_score: 1,
  generated_at: '2026-06-28T00:00:00Z',
});

test('sorts by tier order then givens descending', () => {
  const rows = [rec('medium', 30), rec('very_easy', 40), rec('very_easy', 45), rec('easy', 35)];
  const out = sortRecords(rows);
  assert.deepEqual(out.map((r) => r.difficulty), ['very_easy', 'very_easy', 'easy', 'medium']);
  assert.deepEqual(out.slice(0, 2).map((r) => r.givens), [45, 40]);
});
