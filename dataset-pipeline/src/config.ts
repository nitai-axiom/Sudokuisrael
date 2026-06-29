import path from 'node:path';

export const TIERS = ['very_easy', 'easy', 'medium', 'hard'] as const;
export type Tier = typeof TIERS[number];

/** Lower tiers: generated via qqwing + Rust grader. Hard uses HoDoKu + serate instead. */
export const LOWER_TIERS = ['very_easy', 'easy', 'medium'] as const;
export type LowerTier = typeof LOWER_TIERS[number];

// Full-dataset targets (hard added in Plan 2). Lower three produced by Plan 1 pipeline.
export const TARGETS: Record<Tier, number> = {
  very_easy: 2000,
  easy: 3000,
  medium: 3000,
  hard: 2000,
};

// Hard is not qqwing-generated — QQWING_DIFFICULTY and EXPECTED_GRADE only cover lower tiers.
export const QQWING_DIFFICULTY: Record<LowerTier, 'simple' | 'easy' | 'intermediate'> = {
  very_easy: 'simple',
  easy: 'easy',
  medium: 'intermediate',
};

// The Rust grader difficulty a generated puzzle must report to be accepted into a tier.
// very_easy and easy are both singles-only ('easy' to the grader); they are split by
// the qqwing difficulty used to generate them. medium must genuinely require
// locked candidates / subsets ('medium').
// Hard is not Rust-graded — no entry here.
export const EXPECTED_GRADE: Record<LowerTier, 'easy' | 'medium'> = {
  very_easy: 'easy',
  easy: 'easy',
  medium: 'medium',
};

// ER (Estimation Rating) band for hard-tier puzzles (serate-scored).
export const ER_MIN = 3.4;
export const ER_MAX = 5.0;

export const MIN_CLUES = 17;
export const MIN_CLUES_SYMMETRIC = 18;

export const BATCH_SIZE = 200;        // puzzles per qqwing container invocation
export const SOLVE_TIMEOUT_MS = 30_000; // per-batch qqwing solve timeout guard (also the solve floor)

// serate observed ~155ms/puzzle on hard ER 3.4-5.0 (2-CPU Colima); 1s = ~6x headroom
export const SERATE_TIMEOUT_PER_PUZZLE_MS = 1_000;

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
