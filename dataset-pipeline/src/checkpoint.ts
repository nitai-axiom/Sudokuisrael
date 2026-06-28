import fs from 'node:fs';
import path from 'node:path';
import { CHECKPOINT_DIR, type Tier } from './config.ts';
import type { PuzzleRecord } from './record.ts';
import { dedupeByPuzzle } from './dedupe.ts';

export function checkpointPath(tier: Tier): string {
  return path.join(CHECKPOINT_DIR, `${tier}.jsonl`);
}

export function loadCheckpoint(tier: Tier): PuzzleRecord[] {
  const p = checkpointPath(tier);
  if (!fs.existsSync(p)) return [];
  const rows = fs.readFileSync(p, 'utf8').split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as PuzzleRecord);
  return dedupeByPuzzle(rows);
}

export function appendCheckpoint(tier: Tier, rows: PuzzleRecord[]): void {
  if (rows.length === 0) return;
  fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
  const text = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.appendFileSync(checkpointPath(tier), text);
}
