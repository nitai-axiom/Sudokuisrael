import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptKaggleLower, acceptKaggleHard } from '../src/kaggle-pipeline.ts';
import type { SolveResult } from '../src/qqwing.ts';
import type { Grade } from '../src/grader.ts';

const SOL = Array.from({ length: 81 }, (_, i) => String((i % 9) + 1)).join('');
const PUZ = '0'.repeat(56) + SOL.slice(56); // 25 givens, asymmetric
const uniqueSolve: SolveResult = { puzzle: PUZ, solution: SOL, solutionCount: 1 };
const easyGrade: Grade = { solvable: true, difficulty: 'easy', techniques: ['naked_single'] };
const mediumGrade: Grade = { solvable: true, difficulty: 'medium', techniques: ['naked_pair'] };

test('lower: accepts a unique, correctly-graded puzzle and carries source_id', () => {
  const r = acceptKaggleLower({ tier: 'very_easy', solve: uniqueSolve, grade: easyGrade, sourceId: 7, now: 'x' });
  assert.ok(r);
  assert.equal(r!.difficulty, 'very_easy');
  assert.equal(r!.source_id, 7);
});

test('lower: rejects non-unique solutions', () => {
  const solve: SolveResult = { puzzle: PUZ, solution: null, solutionCount: 2 };
  assert.equal(acceptKaggleLower({ tier: 'easy', solve, grade: easyGrade, sourceId: 1, now: 'x' }), null);
});

test('lower: rejects grade mismatch (medium graded into easy tier)', () => {
  assert.equal(acceptKaggleLower({ tier: 'easy', solve: uniqueSolve, grade: mediumGrade, sourceId: 1, now: 'x' }), null);
});

test('lower: rejects unsolvable (needs guessing)', () => {
  const g: Grade = { solvable: false, difficulty: null, techniques: [] };
  assert.equal(acceptKaggleLower({ tier: 'easy', solve: uniqueSolve, grade: g, sourceId: 1, now: 'x' }), null);
});

test('hard: accepts inside the fair band with a logic-solvable grade', () => {
  const r = acceptKaggleHard({ solve: uniqueSolve, er: 3.2, grade: { solvable: true, difficulty: 'hard', techniques: ['x_wing'] }, sourceId: 9, now: 'x' });
  assert.ok(r);
  assert.equal(r!.difficulty, 'hard');
  assert.equal(r!.er_rating, 3.2);
  assert.equal(r!.source_id, 9);
});

test('hard: rejects ER above the fair ceiling (obscure-technique zone)', () => {
  assert.equal(acceptKaggleHard({ solve: uniqueSolve, er: 4.6, grade: { solvable: true, difficulty: 'hard', techniques: ['coloring'] }, sourceId: 1, now: 'x' }), null);
});

test('hard: rejects when grader says it needs guessing', () => {
  assert.equal(acceptKaggleHard({ solve: uniqueSolve, er: 3.2, grade: { solvable: false, difficulty: null, techniques: [] }, sourceId: 1, now: 'x' }), null);
});
