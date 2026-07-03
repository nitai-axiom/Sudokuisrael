import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterLines } from '../src/kaggle-filter-cli.ts';

const SOL = Array.from({ length: 81 }, (_, i) => String((i % 9) + 1)).join('');
const P25 = '.'.repeat(56) + '1234567891234567891234567';
// The pre-filter reads the CSV clues/difficulty COLUMNS (not the puzzle string), so P25 is
// reused for every row and the clues/diff fields drive the tier assignment.
const rows = [
  'id,puzzle,solution,clues,difficulty',
  `1,${P25},${SOL},25,0.0`,   // clues 25, diff 0 → very_easy only
  `2,${P25},${SOL},25,0.0`,   // same → very_easy is capped, so this one is dropped
  `3,${P25},${SOL},24,0.5`,   // clues 24, diff 0.5 → easy only
  `4,${P25},${SOL},24,2.0`,   // clues 24, diff 2.0 → medium AND hard (shared mid band)
];

test('filterLines: caps enforced, low tiers disjoint, mid tiers multi-membership', () => {
  const caps = { very_easy: 1, easy: 10, medium: 10, hard: 10 };
  const out = filterLines(rows, caps);
  assert.equal(out.filter((o) => o.tier === 'very_easy').length, 1); // capped at 1 despite 2 candidates
  assert.equal(out.filter((o) => o.tier === 'easy').length, 1);      // only row 3
  // Row 1 (very_easy) is NOT also emitted to easy — low tiers are disjoint by clue count.
  assert.deepEqual(out.filter((o) => o.sourceId === 1).map((o) => o.tier), ['very_easy']);
  // Row 4 IS emitted to both medium and hard — they share the mid band.
  assert.deepEqual(out.filter((o) => o.sourceId === 4).map((o) => o.tier).sort(), ['hard', 'medium']);
});
