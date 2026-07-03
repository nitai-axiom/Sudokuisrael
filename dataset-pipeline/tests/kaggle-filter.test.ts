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

test('prefilterTier priority: 24-clue diff-0 falls to easy (not very_easy)', () => {
  assert.equal(prefilterTier(24, 0), 'easy');
});

test('prefilterTier assigns medium (first match) and hard by difficulty', () => {
  assert.equal(prefilterTier(24, 2.0), 'medium'); // matches medium AND hard; first-in-TIERS wins
  assert.equal(prefilterTier(22, 2.0), 'hard');   // 22 clues below medium's min → hard only
});

test('prefilterTier returns null outside all bands', () => {
  assert.equal(prefilterTier(31, 8.5), null); // too many clues / too hard
  assert.equal(prefilterTier(20, 0.5), null); // clues below every band
});

test('prefilterTiers returns EVERY matching tier (overlapping bands)', () => {
  assert.deepEqual(prefilterTiers(25, 0), ['very_easy', 'easy']); // diff-0, 25 clues → both low tiers
  assert.deepEqual(prefilterTiers(24, 2.0), ['medium', 'hard']);  // mid diff, 24 clues → both mid tiers
  assert.deepEqual(prefilterTiers(22, 2.0), ['hard']);            // hard only
  assert.deepEqual(prefilterTiers(31, 8.5), []);                  // none
});
