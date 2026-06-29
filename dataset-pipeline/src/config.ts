import path from 'node:path';

export const TIERS = ['very_easy', 'easy', 'medium'] as const;
export type Tier = typeof TIERS[number];

// Full-dataset targets (hard added in Plan 2). This plan produces the lower three.
export const TARGETS: Record<Tier, number> = {
  very_easy: 2000,
  easy: 3000,
  medium: 3000,
};

export const QQWING_DIFFICULTY: Record<Tier, 'simple' | 'easy' | 'intermediate'> = {
  very_easy: 'simple',
  easy: 'easy',
  medium: 'intermediate',
};

// The Rust grader difficulty a generated puzzle must report to be accepted into a tier.
// very_easy and easy are both singles-only ('easy' to the grader); they are split by
// the qqwing difficulty used to generate them. medium must genuinely require
// locked candidates / subsets ('medium').
export const EXPECTED_GRADE: Record<Tier, 'easy' | 'medium'> = {
  very_easy: 'easy',
  easy: 'easy',
  medium: 'medium',
};

export const MIN_CLUES = 17;
export const MIN_CLUES_SYMMETRIC = 18;

export const BATCH_SIZE = 200;        // puzzles per qqwing container invocation
export const SOLVE_TIMEOUT_MS = 30_000; // per-batch qqwing solve timeout guard (also the solve floor)

// Per-puzzle docker time budgets (qqwing rejection-samples difficulty; generation dominates).
export const GEN_TIMEOUT_PER_PUZZLE_MS = 2_000;   // generous vs observed ~0.5s/puzzle for 'simple'
export const GEN_TIMEOUT_FLOOR_MS = 60_000;       // minimum, covers container cold start + small batches
export const SOLVE_TIMEOUT_PER_PUZZLE_MS = 1_000; // solve early-resolves; this is only the hang guard

export const MAX_CONSECUTIVE_BATCH_FAILURES = 5;

export const QQWING_IMAGE = 'qqwing-trusted';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
export const GRADER_BIN = path.join(REPO_ROOT, 'sudoku-generator', 'target', 'release', 'sudoku-generator');
export const WORK_DIR = path.join(REPO_ROOT, 'dataset-pipeline', '.work');
export const CHECKPOINT_DIR = path.join(REPO_ROOT, 'dataset-pipeline', 'checkpoints');
export const OUTPUT_LOWER = path.join(REPO_ROOT, 'sudoku_lower.json');
