import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseSolveOutput, genTimeoutMs, solveTimeoutMs } from '../src/qqwing.ts';

// Ground truth: real captured qqwing output (tests/fixtures/qqwing-solve.txt)
// qqwing --solve --count-solutions --one-line format:
//   unique puzzle:     "<81-digit solution>\nThe solution to the puzzle is unique.\n"
//   multiple solution: "<81-digit first solution>\nThere are N solutions to the puzzle.\n"
//   impossible:        "Puzzle is not possible.\n"

const FIXTURE_DIR = path.join(import.meta.dirname, 'fixtures');

test('parseSolveOutput pairs each puzzle with its solution and count', () => {
  const puzzles = ['070000043040009610800634900094052000358460020000800530080070091902100005007040802'];
  // Exact contents of tests/fixtures/qqwing-solve.txt (captured from real qqwing):
  const raw = fs.readFileSync(path.join(FIXTURE_DIR, 'qqwing-solve.txt'), 'utf8');
  const results = parseSolveOutput(raw, puzzles);
  assert.equal(results.length, 1);
  assert.equal(results[0].solutionCount, 1);
  assert.equal(results[0].solution?.length, 81);
  // Verify it's all digits
  assert.match(results[0].solution ?? '', /^[0-9]{81}$/);
});

test('parseSolveOutput flags non-unique puzzles (multiple solutions)', () => {
  // Known non-unique puzzle (last clue removed to give 2 solutions)
  const puzzles = ['070000043040009610800634900094052000358460020000800530080070091902100005000040802'];
  // qqwing prints: "<81-digit first solution>\nThere are 2 solutions to the puzzle.\n"
  const raw =
    '679518243543729618821634957794352186358461729216897534485276391962183475137945862\n' +
    'There are 2 solutions to the puzzle.\n';
  const results = parseSolveOutput(raw, puzzles);
  assert.equal(results.length, 1);
  assert.equal(results[0].solutionCount, 2);
  // solution should be null for non-unique puzzles
  assert.equal(results[0].solution, null);
});

test('parseSolveOutput flags impossible puzzles (0 solutions)', () => {
  // Impossible puzzle: two 1s in same row
  const puzzles = ['110000000000000000000000000000000000000000000000000000000000000000000000000000000'];
  // qqwing prints: "Puzzle is not possible.\n"
  const raw = 'Puzzle is not possible.\n';
  const results = parseSolveOutput(raw, puzzles);
  assert.equal(results.length, 1);
  assert.equal(results[0].solutionCount, 0);
  assert.equal(results[0].solution, null);
});

test('parseSolveOutput handles mixed unique + impossible batch', () => {
  const puzzles = [
    '070000043040009610800634900094052000358460020000800530080070091902100005007040802',
    '110000000000000000000000000000000000000000000000000000000000000000000000000000000',
  ];
  const raw =
    '679518243543729618821634957794352186358461729216897534485276391962183475137945862\n' +
    'The solution to the puzzle is unique.\n' +
    'Puzzle is not possible.\n';
  const results = parseSolveOutput(raw, puzzles);
  assert.equal(results.length, 2);
  assert.equal(results[0].solutionCount, 1);
  assert.equal(results[0].solution?.length, 81);
  assert.equal(results[1].solutionCount, 0);
  assert.equal(results[1].solution, null);
});

// ---------------------------------------------------------------------------
// Timeout helper pure-function tests (no Docker)
// ---------------------------------------------------------------------------

test('genTimeoutMs: floor honored for small n', () => {
  assert.equal(genTimeoutMs(1), 60_000);
});

test('genTimeoutMs: scales for large n', () => {
  assert.equal(genTimeoutMs(200), 400_000);
});

test('solveTimeoutMs: floor honored for small n', () => {
  assert.equal(solveTimeoutMs(1), 30_000);
});

test('solveTimeoutMs: scales for large n', () => {
  assert.equal(solveTimeoutMs(200), 200_000);
});
