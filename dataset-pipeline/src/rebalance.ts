import type { PuzzleRecord } from './record.ts';

/**
 * Drop up to `drop` records whose fun_score === score, keeping every other
 * record in its original order. Used to thin an over-represented fun-score
 * bucket (e.g. trim score-3 mediums to make room for higher-variety puzzles).
 */
export function dropByFunScore(rows: PuzzleRecord[], score: number, drop: number): PuzzleRecord[] {
  let remaining = drop;
  const out: PuzzleRecord[] = [];
  for (const r of rows) {
    if (remaining > 0 && r.fun_score === score) {
      remaining--;
      continue;
    }
    out.push(r);
  }
  return out;
}
