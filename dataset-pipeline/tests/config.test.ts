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
