import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBlanks, clueCount, isSymmetric180, canonicalKey, passesClueFloor } from '../src/grid.ts';

const SOLVED =
  '534678912672195348198342567859761423426853791713924856961537284287419635345286179';

test('normalizeBlanks turns dots into zeros and validates length', () => {
  const dotted = '.' + SOLVED.slice(1);
  assert.equal(normalizeBlanks(dotted)[0], '0');
  assert.equal(normalizeBlanks(dotted).length, 81);
  assert.throws(() => normalizeBlanks('123'));
  assert.throws(() => normalizeBlanks('x'.repeat(81)));
});

test('clueCount counts non-zero cells', () => {
  assert.equal(clueCount(SOLVED), 81);
  assert.equal(clueCount('0'.repeat(81)), 0);
});

test('isSymmetric180 detects rotational symmetry of the given pattern', () => {
  // A fully-given grid is trivially symmetric (every cell filled).
  assert.equal(isSymmetric180(SOLVED), true);
  // Asymmetric: only cell 0 filled, its 180° partner (cell 80) blank.
  const asym = '5' + '0'.repeat(80);
  assert.equal(isSymmetric180(asym), false);
  // Symmetric: cell 0 and cell 80 both filled, rest blank.
  const sym = '5' + '0'.repeat(79) + '9';
  assert.equal(isSymmetric180(sym), true);
});

test('canonicalKey is the normalized string', () => {
  const dotted = '.' + SOLVED.slice(1);
  assert.equal(canonicalKey(dotted), normalizeBlanks(dotted));
});

test('passesClueFloor enforces 17 / 18', () => {
  const make = (n: number) => '1'.repeat(n) + '0'.repeat(81 - n);
  assert.equal(passesClueFloor(make(17), false), true);
  assert.equal(passesClueFloor(make(16), false), false);
  assert.equal(passesClueFloor(make(18), true), true);
  assert.equal(passesClueFloor(make(17), true), false);
});
