import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterLines } from '../src/kaggle-filter-cli.ts';

const SOL = Array.from({ length: 81 }, (_, i) => String((i % 9) + 1)).join('');
const P25 = '.'.repeat(56) + '1234567891234567891234567';
const rows = [
  'id,puzzle,solution,clues,difficulty',
  `1,${P25},${SOL},25,0.0`,   // 25 clues, diff 0 → matches BOTH very_easy and easy
  `2,${P25},${SOL},25,0.0`,   // same → very_easy now capped, still counts for easy
  `3,${P25},${SOL},24,0.5`,   // 24 clues, diff 0.5 → easy only
];

test('filterLines respects per-tier caps and emits a row to every matching tier', () => {
  const caps = { very_easy: 1, easy: 10, medium: 10, hard: 10 };
  const out = filterLines(rows, caps);
  assert.equal(out.filter((o) => o.tier === 'very_easy').length, 1); // capped at 1 despite 2 candidates
  assert.equal(out.filter((o) => o.tier === 'easy').length, 3);      // all three rows match easy
  // Row 1 is emitted to BOTH very_easy and easy (overlapping bands, multi-membership).
  assert.deepEqual(out.filter((o) => o.sourceId === 1).map((o) => o.tier).sort(), ['easy', 'very_easy']);
});
