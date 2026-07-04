import fs from 'node:fs';
import path from 'node:path';
import { CHECKPOINT_DIR } from './config.ts';
import type { PuzzleRecord } from './record.ts';
import { dedupeByPuzzle } from './dedupe.ts';

// `key` is a checkpoint namespace (e.g. a tier name, or `kaggle-<tier>` so the Kaggle pipeline
// never shares checkpoint files with the generate-from-scratch 10k pipeline).
export function checkpointPath(key: string): string {
  return path.join(CHECKPOINT_DIR, `${key}.jsonl`);
}

export function loadCheckpoint(key: string): PuzzleRecord[] {
  const p = checkpointPath(key);
  if (!fs.existsSync(p)) return [];
  const rows = fs.readFileSync(p, 'utf8').split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as PuzzleRecord);
  return dedupeByPuzzle(rows);
}

export function appendCheckpoint(key: string, rows: PuzzleRecord[]): void {
  if (rows.length === 0) return;
  fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
  const text = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.appendFileSync(checkpointPath(key), text);
}

export function cursorPath(key: string): string {
  return path.join(CHECKPOINT_DIR, `${key}.cursor`);
}

export function loadCursor(key: string): number {
  const p = cursorPath(key);
  if (!fs.existsSync(p)) return 0;
  const n = Number(fs.readFileSync(p, 'utf8').trim());
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export function saveCursor(key: string, n: number): void {
  fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
  fs.writeFileSync(cursorPath(key), String(n));
}
