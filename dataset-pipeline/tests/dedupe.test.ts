import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeByPuzzle } from '../src/dedupe.ts';

const A = '1'.repeat(17) + '0'.repeat(64);
const B = '2'.repeat(17) + '0'.repeat(64);

test('removes duplicate puzzle strings, keeping first', () => {
  const rows = [{ puzzle: A, tag: 1 }, { puzzle: B, tag: 2 }, { puzzle: A, tag: 3 }];
  const out = dedupeByPuzzle(rows);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((r) => r.tag), [1, 2]);
});

test('treats dotted and zero blanks as the same puzzle', () => {
  const dotted = A.replace(/0/g, '.');
  const out = dedupeByPuzzle([{ puzzle: A }, { puzzle: dotted }]);
  assert.equal(out.length, 1);
});
