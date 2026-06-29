import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSerateOutput } from '../src/serate.ts';

// Real output shape from fixture (serate --format=%r): one ER float per line, order = input order.
const FIXTURE_PUZZLES = [
  '003000620000000000800900100000041030040709008900500000072000004510600200000008000',
  '900710000040000000005800000000000000000602040801300600103450008700080032000000000',
  '008057200050400070000000005830000609012000000004200300000800000900610000006024800',
];

// Captured fixture output: serate --format=%r for the 3 puzzles above.
const FIXTURE_RAW = '3.2\n4.2\n5.7\n';

test('parseSerateOutput pairs each puzzle with its ER number', () => {
  const puzzles = [FIXTURE_PUZZLES[0], FIXTURE_PUZZLES[1]];
  const raw = '3.2\n4.2\n';
  const out = parseSerateOutput(raw, puzzles);
  assert.equal(out.length, 2);
  assert.equal(out[0].puzzle, puzzles[0]);
  assert.equal(out[0].er, 3.2);
  assert.equal(out[1].puzzle, puzzles[1]);
  assert.equal(out[1].er, 4.2);
});

test('parseSerateOutput handles 3-puzzle fixture', () => {
  const out = parseSerateOutput(FIXTURE_RAW, FIXTURE_PUZZLES);
  assert.equal(out.length, 3);
  assert.equal(out[0].er, 3.2);
  assert.equal(out[1].er, 4.2);
  assert.equal(out[2].er, 5.7);
});

test('parseSerateOutput yields null ER for unparseable lines', () => {
  const out = parseSerateOutput('ERROR\n', ['0'.repeat(81)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].er, null);
});

test('parseSerateOutput yields null for missing lines (fewer output than input)', () => {
  const out = parseSerateOutput('3.2\n', [FIXTURE_PUZZLES[0], FIXTURE_PUZZLES[1]]);
  assert.equal(out.length, 2);
  assert.equal(out[0].er, 3.2);
  assert.equal(out[1].er, null);
});

test('parseSerateOutput returns empty array for empty puzzles', () => {
  const out = parseSerateOutput('', []);
  assert.equal(out.length, 0);
});
