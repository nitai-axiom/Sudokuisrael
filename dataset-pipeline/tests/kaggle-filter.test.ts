import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKaggleLine, prefilterTier, prefilterTiers } from '../src/kaggle-filter.ts';

const HEADER = 'id,puzzle,solution,clues,difficulty';
// 25-clue-ish puzzle: 56 dots then 25 digits; solution is a valid-length 81-digit filler.
const PUZ = '.'.repeat(56) + '1234567891234567891234567';
const SOL = Array.from({ length: 81 }, (_, i) => String((i % 9) + 1)).join('');

test('parseKaggleLine skips the header', () => {
  assert.equal(parseKaggleLine(HEADER), null);
});

test('parseKaggleLine parses a data row and normalizes blanks to 0', () => {
  const row = parseKaggleLine(`284123,${PUZ},${SOL},25,0.0`);
  assert.ok(row);
  assert.equal(row!.sourceId, 284123);
  assert.equal(row!.clues, 25);
  assert.equal(row!.difficulty, 0.0);
  assert.match(row!.puzzle, /^[0-9]{81}$/); // dots became zeros
});

test('parseKaggleLine returns null on malformed rows', () => {
  assert.equal(parseKaggleLine('not,enough'), null);
  assert.equal(parseKaggleLine(`1,${PUZ},${SOL},notanumber,0.0`), null);
  assert.equal(parseKaggleLine(`1,${PUZ},${SOL},,0.0`), null); // blank clues
  assert.equal(parseKaggleLine(`1,${PUZ},${SOL},25,`), null);  // blank difficulty
});

test('prefilterTier assigns very_easy for diff 0 with 25-26 clues', () => {
  assert.equal(prefilterTier(25, 0), 'very_easy');
  assert.equal(prefilterTier(26, 0), 'very_easy');
});

test('prefilterTier 24-clue diff-0 → easy (disjoint from very_easy 25-26)', () => {
  assert.equal(prefilterTier(24, 0), 'easy');
});

test('prefilterTier single-match: medium shadows hard (their bands share clues+diff)', () => {
  // medium and hard share clues 22-26; medium (checked first) covers diff 1-3 ⊇ hard's 1-2.5,
  // so the legacy single-match prefilterTier never returns hard — that split is graders' job.
  assert.equal(prefilterTier(24, 2.0), 'medium');
  assert.equal(prefilterTier(22, 2.0), 'medium');
});

test('prefilterTier returns null outside all bands', () => {
  assert.equal(prefilterTier(31, 8.5), null); // too many clues / too hard
  assert.equal(prefilterTier(20, 0.5), null); // clues below every band
});

test('prefilterTiers returns EVERY matching tier', () => {
  assert.deepEqual(prefilterTiers(25, 0), ['very_easy']);        // 25-clue diff-0 → very_easy only (easy is 23-24)
  assert.deepEqual(prefilterTiers(24, 0.5), ['easy']);           // 24-clue diff-0.5 → easy only (low tiers disjoint)
  assert.deepEqual(prefilterTiers(24, 2.0), ['medium', 'hard']); // mid diff → both mid tiers (graders split)
  assert.deepEqual(prefilterTiers(22, 2.0), ['medium', 'hard']); // 22 clues now in medium too
  assert.deepEqual(prefilterTiers(31, 8.5), []);                 // none
});
