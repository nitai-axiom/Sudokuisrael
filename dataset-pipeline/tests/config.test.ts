import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIERS, LOWER_TIERS, TARGETS, QQWING_DIFFICULTY, EXPECTED_GRADE, MIN_CLUES, MIN_CLUES_SYMMETRIC } from '../src/config.ts';

test('all tiers (including hard) are defined', () => {
  assert.deepEqual([...TIERS], ['very_easy', 'easy', 'medium', 'hard']);
  assert.equal(TARGETS.very_easy, 2000);
  assert.equal(TARGETS.easy, 3000);
  assert.equal(TARGETS.medium, 3000);
  assert.equal(TARGETS.hard, 2000);
});

test('lower tiers are defined separately', () => {
  assert.deepEqual([...LOWER_TIERS], ['very_easy', 'easy', 'medium']);
});

test('qqwing difficulty + expected grade maps cover every lower tier (not hard)', () => {
  for (const t of LOWER_TIERS) {
    assert.ok(QQWING_DIFFICULTY[t], `missing qqwing difficulty for ${t}`);
    assert.ok(EXPECTED_GRADE[t], `missing expected grade for ${t}`);
  }
  assert.equal(QQWING_DIFFICULTY.medium, 'intermediate');
  assert.equal(EXPECTED_GRADE.medium, 'medium');
});

test('clue floors match the spec', () => {
  assert.equal(MIN_CLUES, 17);
  assert.equal(MIN_CLUES_SYMMETRIC, 18);
});

test('Kaggle targets sum to 150000', async () => {
  const { KAGGLE_TARGETS } = await import('../src/config.ts');
  const sum = Object.values(KAGGLE_TARGETS).reduce((a, b) => a + b, 0);
  assert.equal(sum, 150000);
});

test('fair-hard band excludes the deep-chain/coloring zone', async () => {
  const { HARD_ER_MIN_FAIR, HARD_ER_MAX_FAIR } = await import('../src/config.ts');
  assert.ok(HARD_ER_MIN_FAIR < HARD_ER_MAX_FAIR);
  assert.ok(HARD_ER_MIN_FAIR >= 3.4);       // hard starts above medium's repertoire
  assert.ok(HARD_ER_MAX_FAIR <= 4.5);       // owner cap: no ER>4.5 (coloring/deep chains)
});

test('every tier has a pre-filter band with sane bounds', async () => {
  const { KAGGLE_PREFILTER } = await import('../src/config.ts');
  for (const band of Object.values(KAGGLE_PREFILTER)) {
    assert.ok(band.cluesMin <= band.cluesMax);
    assert.ok(band.kdMin <= band.kdMax);
    assert.ok(band.cluesMin >= 19 && band.cluesMax <= 31); // dataset clue range
  }
});
