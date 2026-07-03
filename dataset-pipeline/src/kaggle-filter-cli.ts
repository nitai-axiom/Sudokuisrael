import fs from 'node:fs';
import readline from 'node:readline';
import { KAGGLE_TARGETS, TIERS, type Tier } from './config.ts';
import { parseKaggleLine, prefilterTiers } from './kaggle-filter.ts';

export type CandidateOut = { tier: Tier; sourceId: number; puzzle: string };

/**
 * Pure core: bucket lines into tiers up to per-tier caps. A single row is emitted to EVERY
 * matching tier that still has cap headroom (bands overlap by design), so one puzzle can be a
 * candidate for more than one tier.
 */
export function filterLines(lines: Iterable<string>, caps: Record<Tier, number>): CandidateOut[] {
  const counts: Record<string, number> = { very_easy: 0, easy: 0, medium: 0, hard: 0 };
  const out: CandidateOut[] = [];
  for (const line of lines) {
    const row = parseKaggleLine(line);
    if (!row) continue;
    for (const tier of prefilterTiers(row.clues, row.difficulty)) {
      if (counts[tier] >= caps[tier]) continue;
      counts[tier]++;
      out.push({ tier, sourceId: row.sourceId, puzzle: row.puzzle });
    }
    if (TIERS.every((t) => counts[t] >= caps[t])) break; // all tiers full → stop early
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const inPath = argv[argv.indexOf('--in') + 1];
  const outPath = argv[argv.indexOf('--out') + 1];
  const factor = Number(argv[argv.indexOf('--oversample') + 1]) || 3;
  const caps = Object.fromEntries(TIERS.map((t) => [t, Math.ceil(KAGGLE_TARGETS[t] * factor)])) as Record<Tier, number>;

  const rl = readline.createInterface({ input: fs.createReadStream(inPath), crlfDelay: Infinity });
  const counts: Record<string, number> = { very_easy: 0, easy: 0, medium: 0, hard: 0 };
  const ws = fs.createWriteStream(outPath);
  for await (const line of rl) {
    const remaining = { very_easy: caps.very_easy - counts.very_easy, easy: caps.easy - counts.easy, medium: caps.medium - counts.medium, hard: caps.hard - counts.hard } as Record<Tier, number>;
    for (const c of filterLines([line], remaining)) { counts[c.tier]++; ws.write(JSON.stringify(c) + '\n'); }
    if (TIERS.every((t) => counts[t] >= caps[t])) break;
  }
  ws.end();
  process.stderr.write(`filter done: ${JSON.stringify(counts)}\n`);
}

if (import.meta.filename === process.argv[1] || process.argv[1]?.endsWith('kaggle-filter-cli.ts')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
