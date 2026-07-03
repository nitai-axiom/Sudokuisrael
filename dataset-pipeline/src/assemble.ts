import fs from 'node:fs';
import path from 'node:path';
import { LOWER_TIERS, TIERS, OUTPUT_LOWER, OUTPUT_150K, KAGGLE_TARGETS, type Tier } from './config.ts';
import { buildTier } from './pipeline.ts';
import { buildHardTier } from './hard-pipeline.ts';
import { buildKaggleTier } from './kaggle-pipeline.ts';
import { loadCandidates } from './kaggle-source.ts';
import { dedupeByPuzzle } from './dedupe.ts';
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

/**
 * Kaggle-sourced 150k build: consume the filtered candidate pools, validate/re-rate each tier
 * with the trusted graders (buildKaggleTier), assign sequential ids, write sudoku_150000.json.
 * `target` overrides the per-tier target (used by smoke runs, e.g. --count 25).
 */
export async function assembleKaggle(opts?: { target?: number; now?: () => string }): Promise<PuzzleRecord[]> {
  const candidates = await loadCandidates();
  const all: PuzzleRecord[] = [];
  for (const tier of TIERS) {
    const rows = await buildKaggleTier(tier, candidates[tier], {
      target: opts?.target ?? KAGGLE_TARGETS[tier], now: opts?.now,
    });
    all.push(...rows);
  }
  // Bands overlap, so a puzzle can be accepted by two tiers (rare, edge ER). Dedupe across
  // tiers before numbering — first tier in TIERS order wins (very_easy < … < hard).
  const withIds = assignIds(dedupeByPuzzle(all)); // dedupe, sort by tier, assign id 1..N
  fs.writeFileSync(OUTPUT_150K, JSON.stringify(withIds, null, 2));
  process.stderr.write(`wrote ${withIds.length} records → ${OUTPUT_150K}\n`);
  return withIds;
}
