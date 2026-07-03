import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortRecords, assignIds } from '../src/assemble.ts';
import type { PuzzleRecord } from '../src/record.ts';

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

test('hard sorts last after very_easy/easy/medium', () => {
  const hardRec = (difficulty: any, givens: number) => ({
    puzzle: '1'.repeat(givens) + '0'.repeat(81 - givens), solution: '123456789'.repeat(9),
    difficulty, techniques: ['x_wing'], givens, er_rating: difficulty === 'hard' ? 4.2 : null,
    fun_score: difficulty === 'hard' ? null : 1, generated_at: 't',
  });
  const out = sortRecords([hardRec('hard', 24), hardRec('very_easy', 40), hardRec('medium', 30)]);
  assert.deepEqual(out.map((r) => r.difficulty), ['very_easy', 'medium', 'hard']);
});

function puzzleRec(difficulty: PuzzleRecord['difficulty'], givens: number): PuzzleRecord {
  return {
    id: 0, source_id: null, puzzle: '0'.repeat(81 - givens) + '1'.repeat(givens),
    solution: Array.from({ length: 81 }, (_, i) => String((i % 9) + 1)).join(''),
    difficulty, techniques: ['naked_single'], givens, er_rating: null, fun_score: 1,
    generated_at: 'x',
  };
}

test('assignIds numbers rows 1..N contiguously in sorted (tier) order', () => {
  const rows = [puzzleRec('hard', 22), puzzleRec('very_easy', 26), puzzleRec('easy', 24)];
  const out = assignIds(rows);
  assert.deepEqual(out.map((r) => r.id), [1, 2, 3]);
  assert.deepEqual(out.map((r) => r.difficulty), ['very_easy', 'easy', 'hard']); // sortRecords order
  assert.equal(out[out.length - 1].id, out.length);
});
