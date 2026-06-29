import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptHard } from '../src/hard-pipeline.ts';
import { ER_MIN, ER_MAX } from '../src/config.ts';

// Symmetric puzzle: first 10 and last 10 cells filled, rest zeros
const SYM = (() => { const a = Array(81).fill('0'); for (let i=0;i<10;i++){a[i]='1';a[80-i]='1';} return a.join(''); })();
// Asymmetric puzzle: first 20 cells filled (cells 0-19 = '1'), rest zeros — cell i filled but cell 80-i empty for i<20
const ASYM = (() => { const a = Array(81).fill('0'); for (let i=0;i<20;i++){a[i]='1';} return a.join(''); })();
const SOL = '123456789'.repeat(9);

test('ER band constants', () => { assert.equal(ER_MIN, 3.4); assert.equal(ER_MAX, 5.0); });

test('accepts a unique, symmetric, in-band hard puzzle', () => {
  const r = acceptHard({ solve: { puzzle: SYM, solution: SOL, solutionCount: 1 }, er: 4.2, techniques: ['x_wing'], now: 't' });
  assert.ok(r);
  assert.equal(r!.difficulty, 'hard');
  assert.equal(r!.er_rating, 4.2);
  assert.equal(r!.fun_score, null);
});

test('accepts an asymmetric, unique, in-band hard puzzle (symmetry gate is removed)', () => {
  const r = acceptHard({ solve: { puzzle: ASYM, solution: SOL, solutionCount: 1 }, er: 4.2, techniques: ['x_wing'], now: 't' });
  assert.ok(r, 'asymmetric puzzle must be accepted — symmetry gate is dropped for hard tier');
  assert.equal(r!.difficulty, 'hard');
  assert.equal(r!.er_rating, 4.2);
});

test('rejects out-of-band ER', () => {
  assert.equal(acceptHard({ solve: { puzzle: SYM, solution: SOL, solutionCount: 1 }, er: 6.5, techniques: ['x_wing'], now: 't' }), null);
  assert.equal(acceptHard({ solve: { puzzle: SYM, solution: SOL, solutionCount: 1 }, er: 3.0, techniques: ['x_wing'], now: 't' }), null);
});

test('rejects non-unique', () => {
  assert.equal(acceptHard({ solve: { puzzle: SYM, solution: null, solutionCount: 2 }, er: 4.2, techniques: ['x_wing'], now: 't' }), null);
});
