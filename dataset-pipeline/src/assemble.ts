import fs from 'node:fs';
import { LOWER_TIERS, OUTPUT_LOWER, type Tier } from './config.ts';
import { buildTier } from './pipeline.ts';
import type { PuzzleRecord } from './record.ts';

const TIER_ORDER: Record<Tier, number> = { very_easy: 0, easy: 1, medium: 2, hard: 3 };

export function sortRecords(rows: PuzzleRecord[]): PuzzleRecord[] {
  return [...rows].sort((a, b) => {
    const t = TIER_ORDER[a.difficulty] - TIER_ORDER[b.difficulty];
    if (t !== 0) return t;
    return b.givens - a.givens; // more givens first → gentler opening within a tier
  });
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
