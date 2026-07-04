// Tests for the SudokuEngine. Run with: npm test
// Zero dependencies — Node's built-in test runner + type stripping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SudokuEngine } from '../lib/sudoku-engine.ts';

// A valid, fully-solved grid used as the answer key.
const SOLUTION =
  '534678912672195348198342567859761423426853791713924856961537284287419635345286179';
// Same grid with cells (0,0),(0,1),(0,2) blanked — solution there is 5,3,4.
const PUZZLE =
  '000678912672195348198342567859761423426853791713924856961537284287419635345286179';

// ── Characterization guards (document existing, correct behavior) ──────────────

test('places a correct digit', () => {
  const e = new SudokuEngine(PUZZLE, SOLUTION);
  const res = e.enterDigit(0, 0, 5); // solution is 5
  assert.equal(res.correct, true);
  assert.equal(res.mistake, false);
  assert.equal(e.getState().userGrid[0][0], 5);
});

test('a wrong digit counts as a mistake and is not placed', () => {
  const e = new SudokuEngine(PUZZLE, SOLUTION);
  const res = e.enterDigit(0, 0, 1); // wrong
  assert.equal(res.mistake, true);
  assert.equal(e.getState().mistakes, 1);
  assert.equal(e.getState().userGrid[0][0], 0); // not placed
});

test('game is over after maxMistakes wrong digits', () => {
  const e = new SudokuEngine(PUZZLE, SOLUTION);
  const max = e.getState().maxMistakes;
  for (let i = 0; i < max; i++) e.enterDigit(0, 0, 1); // wrong each time
  assert.equal(e.getState().isGameOver, true);
});

// ── ENG-2: bad input must be rejected, not silently become NaN ─────────────────

test('constructor rejects a grid with non-digit characters', () => {
  const bad =
    'X34678912672195348198342567859761423426853791713924856961537284287419635345286179';
  assert.throws(() => new SudokuEngine(bad, SOLUTION), /invalid/i);
});

// ── ENG-1: undoing the game-ending mistake must resume the timer ───────────────

test('undo after game-over resumes the timer', () => {
  const e = new SudokuEngine(PUZZLE, SOLUTION);
  e.startTimer();
  const max = e.getState().maxMistakes;
  for (let i = 0; i < max; i++) e.enterDigit(0, 0, 1); // wrong → game over

  assert.equal(e.getState().isGameOver, true);
  assert.equal(e.getState().timerRunning, false); // paused at game over

  e.undo(); // remove the final mistake

  assert.equal(e.getState().isGameOver, false);
  assert.equal(e.getState().timerRunning, true); // timer must be live again
});
