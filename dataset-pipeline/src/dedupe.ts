import { canonicalKey } from './grid.ts';

export function dedupeByPuzzle<T extends { puzzle: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = canonicalKey(row.puzzle);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}
