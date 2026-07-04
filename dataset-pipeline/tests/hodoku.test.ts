import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHodokuOutput } from '../src/hodoku.ts';

// Real output format captured 2026-06-29 (see tests/fixtures/hodoku-generate.txt for full context):
//   <81-char-puzzle-with-dots> # <technique-path>
// Multiple lines for the same puzzle are normal; parser dedupes by puzzle string.
// Technique-path: space-separated tokens: 'x' | 'ssts' | 's' | 'technique(count)'

const FIXTURE_RAW = `\
Jun 29, 2026 8:52:11 AM sudoku.Main main
CONFIG: java.io.tmpdir=/tmp
HoDoKu - v2.2.0 - Build 116

Writing output to console
Starting search for:
   X-Wing (0, -)
..3...62..........8..9..1......41.3..4.7.9..89..5......72.....451.6..2.......8... # ssts bf2(6) s
9..71.....4.........58.................6.2.4.8.13..6..1.345...87...8..32......... # ssts bf2(1) x
..8.572...5.4...7.........583....6.9.12........42..3.....8.....9..61......6.248.. # ssts bf2(4) x bf2(2) x
5...6......71.2..89......3..6....5.......394174..........98.....78..........452.. # ssts bf2(2) x
..3.89..............7...1.69..3..5...7...5.19.8.....6..5..6743..3.5.....4.61..... # x bf2(2) s
9..71.....4.........58.................6.2.4.8.13..6..1.345...87...8..32......... # x bf2(2) x
Gesamt: 300 Sudoku erzeugt (6 Treffer)
`;

test('parseHodokuOutput extracts 81-char puzzles and strips log noise', () => {
  const out = parseHodokuOutput(FIXTURE_RAW);
  assert.ok(out.length >= 1, 'must return at least one puzzle');
  for (const p of out) {
    assert.equal(p.puzzle.length, 81, `puzzle must be 81 chars, got ${p.puzzle.length}`);
    assert.ok(/^[0-9]{81}$/.test(p.puzzle), 'puzzle must contain only digits (dots normalized to 0)');
  }
});

test('parseHodokuOutput deduplicates repeated puzzle strings', () => {
  const out = parseHodokuOutput(FIXTURE_RAW);
  // 9..71... appears twice with different paths; should appear once in output
  const puzzles = out.map((p) => p.puzzle);
  const unique = new Set(puzzles);
  assert.equal(puzzles.length, unique.size, 'no duplicate puzzle strings in output');
});

test('parseHodokuOutput extracts technique names from path', () => {
  const out = parseHodokuOutput(FIXTURE_RAW);
  // First puzzle: "ssts bf2(6) s" → should contain 'bf2'
  const first = out[0];
  assert.ok(first.techniques.length > 0, 'first puzzle should have at least one technique');
  assert.ok(
    first.techniques.includes('bf2'),
    `expected bf2 in techniques, got: ${JSON.stringify(first.techniques)}`,
  );
});

test('parseHodokuOutput handles empty/garbage input gracefully', () => {
  assert.deepEqual(parseHodokuOutput(''), []);
  assert.deepEqual(parseHodokuOutput('CONFIG: nothing here\nGesamt: 0 Sudoku erzeugt\n'), []);
});
