import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withContainerName } from '../src/docker.ts';

// ---------------------------------------------------------------------------
// withContainerName: pure helper — no Docker required
// ---------------------------------------------------------------------------

test('withContainerName splices --name after "run" in normal docker args', () => {
  const result = withContainerName(['run', '--rm', 'sudoku-jars', 'java'], 'sandbox-x');
  assert.deepEqual(result, ['run', '--name', 'sandbox-x', '--rm', 'sudoku-jars', 'java']);
});

test('withContainerName prepends --name when no "run" element present', () => {
  const result = withContainerName(['qqwing'], 'sandbox-x');
  assert.deepEqual(result, ['--name', 'sandbox-x', 'qqwing']);
});

test('withContainerName does not mutate the input array', () => {
  const args = ['run', '--rm', 'sudoku-jars', 'java'];
  const original = [...args];
  withContainerName(args, 'sandbox-x');
  assert.deepEqual(args, original);
});
