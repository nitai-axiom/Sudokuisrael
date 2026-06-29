import type { Tier } from './config.ts';
import type { Grade } from './grader.ts';
import { clueCount, normalizeBlanks } from './grid.ts';

export type PuzzleRecord = {
  puzzle: string;
  solution: string;
  difficulty: Tier;
  techniques: string[];
  givens: number;
  er_rating: number | null;
  fun_score: number | null;
  generated_at: string;
};

export function buildRecord(args: {
  puzzle: string; solution: string; tier: Tier; grade: Grade; funScore: number | null; now: string;
}): PuzzleRecord {
  const puzzle = normalizeBlanks(args.puzzle);
  const solution = normalizeBlanks(args.solution);
  return {
    puzzle,
    solution,
    difficulty: args.tier,
    techniques: args.grade.techniques,
    givens: clueCount(puzzle),
    er_rating: null,            // lower tiers carry no ER rating (Plan 2 sets it for hard)
    fun_score: args.funScore,
    generated_at: args.now,
  };
}

export function validateRecord(r: PuzzleRecord): string[] {
  const problems: string[] = [];
  if (!/^[0-9]{81}$/.test(r.puzzle)) problems.push('puzzle must be 81 digits');
  if (!/^[1-9]{81}$/.test(r.solution)) problems.push('solution must be 81 non-zero digits');
  if (r.techniques.length === 0) problems.push('techniques must be non-empty');
  if (r.fun_score !== null && (r.fun_score < 0 || r.fun_score > 5)) problems.push('fun_score out of range');
  if (r.givens < 17) problems.push('givens below clue floor');
  return problems;
}
