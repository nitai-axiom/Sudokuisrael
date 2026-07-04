import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadCandidates } from '../src/kaggle-source.ts';

test('loadCandidates groups candidate JSONL by tier (injected path, tolerates blank lines)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaggle-cand-'));
  const p = path.join(dir, 'c.jsonl');
  fs.writeFileSync(p, [
    JSON.stringify({ tier: 'very_easy', sourceId: 1, puzzle: '0'.repeat(81) }),
    JSON.stringify({ tier: 'hard', sourceId: 2, puzzle: '1'.repeat(81) }),
    JSON.stringify({ tier: 'very_easy', sourceId: 3, puzzle: '2'.repeat(81) }),
    '', // blank line must be tolerated
  ].join('\n') + '\n');

  const byTier = await loadCandidates(p);

  assert.equal(byTier.very_easy.length, 2);
  assert.equal(byTier.hard.length, 1);
  assert.equal(byTier.easy.length, 0);
  assert.equal(byTier.medium.length, 0);
  assert.equal(byTier.very_easy[0].sourceId, 1);
  assert.equal(byTier.very_easy[0].puzzle, '0'.repeat(81));

  fs.rmSync(dir, { recursive: true, force: true });
});
