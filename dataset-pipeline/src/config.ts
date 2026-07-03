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

// ── Kaggle-sourced 150k dataset ─────────────────────────────────────────────
export const KAGGLE_TARGETS: Record<Tier, number> = {
  very_easy: 30000,
  easy: 45000,
  medium: 45000,
  hard: 30000,
};

export type PrefilterBand = { cluesMin: number; cluesMax: number; kdMin: number; kdMax: number };

// Coarse pre-filter on Kaggle's own columns. prefilterTiers() returns EVERY matching tier.
// Design (tuned by calibration 2026-07-03):
//  - very_easy vs easy are made DISJOINT by clue count (25-26 vs 23-24). Both are Rust-"easy",
//    so if their bands overlapped a puzzle would be accepted by both and the cross-tier dedup
//    would starve `easy` (observed: easy fell to 27/50 in a smoke). Disjoint bands fix that.
//  - medium and hard intentionally SHARE a band (same clues, hard's difficulty ⊂ medium's).
//    They are separated by the GRADERS, not the band: medium keeps Rust-"medium" (ER≲3.4),
//    hard keeps serate ER 3.4-4.5 (Rust returns null there). A puzzle is accepted by at most
//    one of them; the rare ER≈3.4 edge is caught by cross-tier dedup.
//  - low tiers (diff 0-1) never collide with mid tiers (diff 1-3) because they are disjoint by
//    difficulty.
export const KAGGLE_PREFILTER: Record<Tier, PrefilterBand> = {
  very_easy: { cluesMin: 25, cluesMax: 26, kdMin: 0,   kdMax: 0   },
  easy:      { cluesMin: 23, cluesMax: 24, kdMin: 0,   kdMax: 1.0 },
  medium:    { cluesMin: 22, cluesMax: 26, kdMin: 1.0, kdMax: 3.0 },
  hard:      { cluesMin: 22, cluesMax: 26, kdMin: 1.0, kdMax: 2.5 },
};

// Fair-hard serate ER band for the Kaggle hard tier.
// Owner decision 2026-07-03 ("allow slightly harder for volume"): 3.4–4.5 = wings/fish and
// light patterns — pure logic, no guessing — while excluding the ER>4.5 coloring/deep-chain
// ("not fun") zone. serate returns an ER in this range ONLY if it solved the puzzle logically,
// so the band itself is the no-guessing guarantee (no Rust solvable-gate needed for hard).
export const HARD_ER_MIN_FAIR = 3.4;
export const HARD_ER_MAX_FAIR = 4.5;

export const OUTPUT_150K = path.join(REPO_ROOT, 'sudoku_150000.json');
export const CALIBRATION_N = 500; // candidates per tier sampled by --calibrate

// Kaggle fetch (in-sandbox)
export const KAGGLE_IMAGE = 'sudoku-kaggle';
export const KAGGLE_DATASET = 'radcliffe/3-million-sudoku-puzzles-with-ratings';
export const KAGGLE_CSV_NAME = 'sudoku-3m.csv';
export const KAGGLE_VOLUME = 'kaggle-csv';
