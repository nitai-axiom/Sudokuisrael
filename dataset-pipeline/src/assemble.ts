import fs from 'node:fs';
import path from 'node:path';
import { LOWER_TIERS, OUTPUT_LOWER, type Tier } from './config.ts';
import { buildTier } from './pipeline.ts';
import { buildHardTier } from './hard-pipeline.ts';
import type { PuzzleRecord } from './record.ts';

export const OUTPUT_FULL = path.join(path.dirname(OUTPUT_LOWER), 'sudoku_10000.json');

const TIER_ORDER: Record<Tier, number> = { very_easy: 0, easy: 1, medium: 2, hard: 3 };

export function sortRecords(rows: PuzzleRecord[]): PuzzleRecord[] {
  return [...rows].sort((a, b) => {
    const t = TIER_ORDER[a.difficulty] - TIER_ORDER[b.difficulty];
    if (t !== 0) return t;
    return b.givens - a.givens; // more givens first → gentler opening within a tier
  });
}

export function assignIds(rows: PuzzleRecord[]): PuzzleRecord[] {
  return sortRecords(rows).map((r, i) => ({ ...r, id: i + 1 }));
}

export async function assembleLower(opts?: { target?: number; now?: () => string }): Promise<PuzzleRecord[]> {
  const all: PuzzleRecord[] = [];
  for (const tier of LOWER_TIERS) {
    const rows = await buildTier(tier, { target: opts?.target, now: opts?.now });
    all.push(...rows);
  }
  const sorted = sortRecords(all);
  fs.writeFileSync(OUTPUT_LOWER, JSON.stringify(sorted, null, 2));
  process.stderr.write(`wrote ${sorted.length} records → ${OUTPUT_LOWER}\n`);
  return sorted;
}

export async function assembleAll(opts?: { target?: number; now?: () => string }): Promise<PuzzleRecord[]> {
  const all: PuzzleRecord[] = [];
  for (const tier of LOWER_TIERS) {
    all.push(...await buildTier(tier, { target: opts?.target, now: opts?.now }));
  }
  all.push(...await buildHardTier({ target: opts?.target, now: opts?.now }));
  const sorted = sortRecords(all);
  fs.writeFileSync(OUTPUT_FULL, JSON.stringify(sorted, null, 2));
  process.stderr.write(`wrote ${sorted.length} records → ${OUTPUT_FULL}\n`);
  return sorted;
}
