import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { acceptKaggleLower, acceptKaggleHard, buildKaggleTier, type Candidate } from '../src/kaggle-pipeline.ts';
import { checkpointPath, cursorPath } from '../src/checkpoint.ts';
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

test('hard: accepts inside the fair band [3.4, 4.5]', () => {
  const r = acceptKaggleHard({ solve: uniqueSolve, er: 4.0, grade: { solvable: true, difficulty: 'hard', techniques: ['x_wing'] }, sourceId: 9, now: 'x' });
  assert.ok(r);
  assert.equal(r!.difficulty, 'hard');
  assert.equal(r!.er_rating, 4.0);
  assert.equal(r!.source_id, 9);
});

test('hard: rejects ER above the fair ceiling (>4.5 = coloring/deep-chains)', () => {
  assert.equal(acceptKaggleHard({ solve: uniqueSolve, er: 4.6, grade: { solvable: true, difficulty: 'hard', techniques: ['coloring'] }, sourceId: 1, now: 'x' }), null);
});

test('hard: rejects ER below the floor (<3.4 belongs in medium)', () => {
  assert.equal(acceptKaggleHard({ solve: uniqueSolve, er: 3.0, grade: { solvable: true, difficulty: 'medium', techniques: ['naked_pair'] }, sourceId: 1, now: 'x' }), null);
});

test('hard: accepts a serate-fair puzzle even when the Rust grader returns null (band is the no-guessing gate)', () => {
  // The Rust grader cannot solve X-Wing+ and returns null there; serate ER in the fair band
  // already proves the puzzle is logically solvable, so hard does NOT gate on grade.solvable.
  const r = acceptKaggleHard({ solve: uniqueSolve, er: 4.0, grade: { solvable: false, difficulty: null, techniques: [] }, sourceId: 5, now: 'x' });
  assert.ok(r);
  assert.equal(r!.difficulty, 'hard');
  assert.deepEqual(r!.techniques, ['x_wing']); // fallback tag when grader gave none
});

const SOLc = Array.from({ length: 81 }, (_, i) => String((i % 9) + 1)).join('');
function puz(n: number) { return String(n % 10).repeat(56) + SOLc.slice(56); } // 81 chars, distinct per n (0-9)
function cleanMedium() { fs.rmSync(checkpointPath('medium'), { force: true }); fs.rmSync(cursorPath('medium'), { force: true }); }
const fakeSolve = async (ps: string[]): Promise<SolveResult[]> => ps.map((p) => ({ puzzle: p, solution: SOLc, solutionCount: 1 }));
const fakeGrade = async (ps: string[]): Promise<Grade[]> => ps.map(() => ({ solvable: true, difficulty: 'medium', techniques: ['naked_pair'] }));

test('buildKaggleTier collects target survivors from finite candidates (medium, injected fakes)', async () => {
  cleanMedium();
  const cands: Candidate[] = Array.from({ length: 10 }, (_, i) => ({ sourceId: i, puzzle: puz(i) }));
  const rows = await buildKaggleTier('medium', cands, { target: 3, now: () => 'x', solveAndCount: fakeSolve, gradeBatch: fakeGrade });
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.difficulty === 'medium'));
  cleanMedium();
});

test('buildKaggleTier stops when candidates run out (returns < target, no throw)', async () => {
  cleanMedium();
  const cands: Candidate[] = [{ sourceId: 0, puzzle: puz(0) }];
  const rows = await buildKaggleTier('medium', cands, { target: 100, now: () => 'x', solveAndCount: fakeSolve, gradeBatch: fakeGrade });
  assert.ok(rows.length <= 1);
  cleanMedium();
});
