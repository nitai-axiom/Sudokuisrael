# Dataset Pipeline — Sudoku Lower Tiers (Plan 1)

This pipeline generates the lower three difficulty tiers of the Sudoku dataset: **very_easy** (2,000 puzzles), **easy** (3,000 puzzles), and **medium** (3,000 puzzles). It produces **8,000 total records** in JSON Lines format (`sudoku_lower.json`).

## What It Produces

Each generated puzzle is a JSON record with:
```json
{
  "puzzle": "...",           // 81-char string (0 = blank, 1–9 = given)
  "solution": "...",         // 81-char string (1–9, fully solved)
  "difficulty": "very_easy", // one of: very_easy, easy, medium
  "techniques": [            // solving techniques required (from Rust grader)
    "single", "pointing_pair", ...
  ],
  "givens": 23,              // number of clues
  "er_rating": null,         // null for lower tiers (Plan 2 adds ER rating for hard)
  "fun_score": 3,            // 0–5 score (0 = guesses required, 1–5 = variety)
  "generated_at": "2026-06-28T10:45:30Z"
}
```

## Prerequisites

Before running the pipeline, you must:

1. **Docker is running** — the pipeline invokes a trusted qqwing container (`--network none`, read-only).
2. **Rust release build ready:**
   ```bash
   cd sudoku-generator
   cargo build --release
   ```
3. **Build the trusted qqwing Docker image** (one-time):
   ```bash
   ./dataset-pipeline/sandbox/build-qqwing.sh
   ```
   This builds `qqwing-trusted` from `dataset-pipeline/sandbox/qqwing.Dockerfile` (Debian Bookworm + apt qqwing 1.3.4). The image is signed by the Debian release team and cannot be modified at runtime.

## Smoke Run

Verify the setup works with a small batch:

```bash
node dataset-pipeline/bin/run-lower.ts --count 20
```

This generates 20 puzzles per tier (60 total, ~40 seconds). Output goes to `sudoku_lower.json`. Check for errors in stderr and verify the JSON is valid:

```bash
cat sudoku_lower.json | jq '.[] | select(.difficulty == "easy") | .techniques' | head -1
```

## Full Run

Generate the complete dataset:

```bash
node dataset-pipeline/bin/run-lower.ts
```

This produces:
- very_easy: 2,000 puzzles
- easy: 3,000 puzzles
- medium: 3,000 puzzles
- **Total: 8,000 records** (runtime: ~4–6 hours depending on CPU and Docker overhead)

Output → `sudoku_lower.json` (git-ignored).

## Output & Checkpoints

### Where output lands
- **Final dataset:** `sudoku_lower.json` in the repo root (JSON Lines format, one record per line).
- **Resumable checkpoints:** `dataset-pipeline/checkpoints/<tier>.jsonl` (one per tier: `very_easy.jsonl`, `easy.jsonl`, `medium.jsonl`).

### How checkpoints work
- As each batch completes, it's appended to the tier's checkpoint file.
- On restart, the pipeline loads all records from each checkpoint and resumes from where it left off.
- This allows safe recovery from network/Docker/process interruptions without re-generating puzzles.
- The pipeline over-generates slightly; once enough survivors reach the target for a tier, that tier is done.

### To restart a tier
Delete its checkpoint file:
```bash
rm dataset-pipeline/checkpoints/medium.jsonl
node dataset-pipeline/bin/run-lower.ts
```
This tier will re-generate from scratch; other tiers resume from their checkpoints.

## Architecture: Two-Zone Trust Model

The pipeline uses two independent zones to isolate puzzle generation from grading:

1. **Trusted Zone (qqwing container)**
   - Docker image: `qqwing-trusted` (Debian-provided qqwing 1.3.4, immutable).
   - Role: Generate random puzzles, solve them, count solutions (uniqueness gate).
   - Network: `--network none` (no outbound access).
   - Invoked via TypeScript wrappers: `generate(tier, count)` and `solveAndCount(puzzles)`.
   - Output format: English sentences ("The solution to the puzzle is unique." / "There are N solutions.").

2. **Host Zone (TypeScript orchestrator + Rust grader)**
   - Runs all quality gates: 180° rotational symmetry, clue floor (≥17, ≥18 symmetric), deduplication, schema validation.
   - Invokes the Rust grader binary (`sudoku-generator --grade`) for technique identification and fun-score calculation.
   - Assembles final records, sorts, and writes JSON Lines output.

This split ensures that puzzle generation is **provably isolated** (qqwing cannot leak or bias data), while technique grading (which requires the full Rust ecosystem) runs where we can trust the implementation.

## Quality Gates

The pipeline applies these filters in order:

1. **Uniqueness:** qqwing's `count-solutions` must return exactly 1 solution.
2. **Rotational symmetry:** Puzzle must be unchanged under 180° rotation (rejects ~30% of puzzles).
3. **Clue floor:** ≥17 givens (standard minimum). If rotationally symmetric: ≥18 (to maintain some difficulty variance).
4. **Deduplication:** Canonical puzzle string (as-is, no rotation) must not have been seen before.
5. **Schema validation:** all required fields present, types correct, no NaN/null in puzzle string.

## Next Steps (Plan 2)

This pipeline produces the **lower three tiers only**. Plan 2 adds:

- **Hard tier generation** (serate → ER rating assignment).
- **Untrusted sandbox container** for running the unsafe serate JAR.
- Full 10k dataset (hard tier is larger and slower to rate).

## Troubleshooting

| Issue | Check |
|-------|-------|
| `qqwing-trusted` image not found | Run `./dataset-pipeline/sandbox/build-qqwing.sh` |
| `sudoku-generator --grade` binary not found | Run `cd sudoku-generator && cargo build --release` in repo root |
| Docker connection error | Ensure Docker daemon is running (`docker ps`) |
| Checkpoint file corrupted | Delete it (`rm dataset-pipeline/checkpoints/<tier>.jsonl`) and resume |
| Output file is empty | Check stderr for errors; smoke run with `--count 5` first |
