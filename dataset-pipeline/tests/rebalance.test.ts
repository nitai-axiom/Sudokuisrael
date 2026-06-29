import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropByFunScore } from '../src/rebalance.ts';

const rec = (fun: number, tag: string) => ({
  puzzle: '0'.repeat(81), solution: '123456789'.repeat(9), difficulty: 'medium' as const,
  techniques: ['naked_singles'], givens: 30, er_rating: null, fun_score: fun, generated_at: 'x', tag,
});

test('drops exactly N of the target score, keeps everything else in order', () => {
  const rows = [rec(2, 'a'), rec(3, 'b'), rec(3, 'c'), rec(4, 'd'), rec(3, 'e'), rec(5, 'f')];
  const out = dropByFunScore(rows, 3, 2); // drop 2 of the score-3
  assert.equal(out.length, 4);
  // first two score-3 (b, c) dropped; e (3rd score-3) kept; non-3 all kept, order preserved
  assert.deepEqual(out.map((r: any) => r.tag), ['a', 'd', 'e', 'f']);
});

test('drops at most the available count', () => {
  const rows = [rec(3, 'a'), rec(2, 'b'), rec(3, 'c')];
  const out = dropByFunScore(rows, 3, 10); // only 2 score-3 exist
  assert.deepEqual(out.map((r: any) => r.tag), ['b']);
});

test('drop 0 is a no-op', () => {
  const rows = [rec(3, 'a'), rec(4, 'b')];
  assert.equal(dropByFunScore(rows, 3, 0).length, 2);
});
