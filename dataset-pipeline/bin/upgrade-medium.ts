// Upgrade the medium tier's fun-score mix: drop N score-3 puzzles and replace
// them with the same number of higher-variety (fun_score >= MIN_NEW_SCORE)
// medium puzzles. very_easy and easy are left untouched. Reuses the existing
// generation + uniqueness + grade + acceptance gates, and dedupes new puzzles
// against the entire current dataset.
//
// Usage: node dataset-pipeline/bin/upgrade-medium.ts [drop=800] [minNewScore=4]
import fs from 'node:fs';
import { OUTPUT_LOWER, BATCH_SIZE } from '../src/config.ts';
import { generate, solveAndCount } from '../src/qqwing.ts';
import { gradeBatch } from '../src/grader.ts';
import { acceptPuzzle } from '../src/pipeline.ts';
import { dropByFunScore } from '../src/rebalance.ts';
import { sortRecords } from '../src/assemble.ts';
import { canonicalKey } from '../src/grid.ts';
import { checkpointPath } from '../src/checkpoint.ts';
import type { PuzzleRecord } from '../src/record.ts';

const DROP = Number(process.argv[2] ?? 800);
const MIN_NEW_SCORE = Number(process.argv[3] ?? 4);

const all: PuzzleRecord[] = JSON.parse(fs.readFileSync(OUTPUT_LOWER, 'utf8'));
const veryEasy = all.filter((r) => r.difficulty === 'very_easy');
const easy = all.filter((r) => r.difficulty === 'easy');
const medium = all.filter((r) => r.difficulty === 'medium');
const targetMedium = medium.length;

const kept = dropByFunScore(medium, 3, DROP);
const need = targetMedium - kept.length;
process.stderr.write(
  `medium: ${medium.length} -> kept ${kept.length} after dropping ${need} score-3; ` +
  `need ${need} new with fun_score >= ${MIN_NEW_SCORE}\n`,
);

const seen = new Set(all.map((r) => canonicalKey(r.puzzle)));
const added: PuzzleRecord[] = [];
let rounds = 0;
while (added.length < need) {
  try {
    const batch = await generate('medium', BATCH_SIZE);
    const [solves, grades] = await Promise.all([solveAndCount(batch), gradeBatch(batch)]);
    if (solves.length !== batch.length || grades.length !== batch.length) {
      throw new Error(`wrapper length mismatch: ${batch.length}/${solves.length}/${grades.length}`);
    }
    for (let i = 0; i < batch.length; i++) {
      const rec = acceptPuzzle({ tier: 'medium', solve: solves[i], grade: grades[i], now: new Date().toISOString() });
      if (!rec) continue;
      if ((rec.fun_score ?? 0) < MIN_NEW_SCORE) continue;
      const key = canonicalKey(rec.puzzle);
      if (seen.has(key)) continue;
      seen.add(key);
      added.push(rec);
      if (added.length >= need) break;
    }
  } catch (e) {
    process.stderr.write(`\n  upgrade: batch failed (${(e as Error).message}); retrying\n`);
  }
  rounds++;
  process.stderr.write(`\r  upgrade-medium: +${added.length}/${need} (round ${rounds})   `);
}
process.stderr.write('\n');

const newMedium = [...kept, ...added];
const final = sortRecords([...veryEasy, ...easy, ...newMedium]);
fs.writeFileSync(OUTPUT_LOWER, JSON.stringify(final, null, 2));
// Keep the medium checkpoint consistent with the rebalanced set.
fs.writeFileSync(checkpointPath('medium'), newMedium.map((r) => JSON.stringify(r)).join('\n') + '\n');

process.stderr.write(
  `done: medium now ${newMedium.length} (kept ${kept.length} + added ${added.length}); total ${final.length} -> ${OUTPUT_LOWER}\n`,
);
