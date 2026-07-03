import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterLines } from '../src/kaggle-filter-cli.ts';

const SOL = Array.from({ length: 81 }, (_, i) => String((i % 9) + 1)).join('');
const P25 = '.'.repeat(56) + '1234567891234567891234567';
const rows = [
  'id,puzzle,solution,clues,difficulty',
  `1,${P25},${SOL},25,0.0`,   // very_easy
  `2,${P25},${SOL},25,0.0`,   // very_easy (2nd) — capped test
  `3,${P25},${SOL},24,0.5`,   // easy
];

test('filterLines buckets rows and respects per-tier caps', () => {
  const caps = { very_easy: 1, easy: 10, medium: 10, hard: 10 };
  const out = filterLines(rows, caps);
  const veryEasy = out.filter((o) => o.tier === 'very_easy');
  assert.equal(veryEasy.length, 1);            // capped at 1 despite 2 candidates
  assert.ok(out.some((o) => o.tier === 'easy'));
});
