# Sudoku Dataset — Plan 1: Foundation + Lower Tiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the host-only foundation of the Sudoku dataset pipeline and produce the three lower tiers (very_easy / easy / medium = 8,000 puzzles) as a validated, deduped, fun-scored `sudoku_lower.json`, reusing every component the hard tier will later need.

**Architecture:** A TypeScript host pipeline orchestrates a *trusted qqwing Docker container* (distro-signed apt qqwing, run `--network none`) for generation and the uniqueness gate, and a new Rust `grade` subcommand (added to the existing `sudoku-generator`) for independent technique grading. The host runs pure-TS validation (symmetry, clue floor, dedupe, schema) and assembly. Per-tier checkpointing makes long runs resumable; over-generation loops until each tier has enough *survivors*.

**Tech Stack:** TypeScript (Node built-in test runner + type-stripping, zero new deps), Rust (existing `sudoku-generator`, `sudoku` v0.7 crate), Docker (Debian + apt qqwing), qqwing CLI.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-28-sudoku-10k-dataset-design.md` — authoritative.
- **Plan 1 scope:** lower tiers only (very_easy / easy / medium). The hard tier, the untrusted JAR container, and serate/ER rating are **Plan 2** — do not build them here.
- **Host language:** TypeScript, run via `node --test` with type-stripping. **Zero new runtime dependencies.** Use only `node:` built-ins (`node:child_process`, `node:crypto`, `node:fs`, `node:path`, `node:test`, `node:assert/strict`).
- **Tier targets (this plan):** very_easy 2,000 · easy 3,000 · medium 3,000.
- **qqwing difficulty map:** very_easy→`simple`, easy→`easy`, medium→`intermediate`.
- **Quality gates (every puzzle):** exactly one solution; pure-logic solvable (no guessing); 180° rotational symmetry; clue count ≥17 (≥18 for symmetric); deduped on the canonical puzzle string.
- **Blank cell convention:** puzzle/solution strings are 81 chars; internally normalize blanks to `'0'` (matches existing `puzzles.json` and the Rust generator). qqwing emits `'.'` for blanks — normalize on ingest.
- **Record schema:** `puzzle, solution, difficulty, techniques, givens, er_rating, fun_score, generated_at`. For lower tiers `er_rating` is `null`; `fun_score` is 0–5.
- **Trust:** qqwing runs only inside its container, `--network none` at run time. The host never downloads or runs untrusted code in this plan.
- **Commits:** one per task minimum; each task ends green.

---

### Task 1: Rust `grade` subcommand (independent technique grader)

Adds a stdin→stdout grading mode to the existing Rust binary. Reads one 81-char puzzle per line, emits one JSON line per puzzle reporting whether it is pure-logic solvable, its difficulty, and the techniques required. Reuses the existing `StrategySolver`, `all_strategies`, `grade_techniques`, and `classify_difficulty`.

**Files:**
- Modify: `sudoku-generator/src/main.rs` (add a `grade` mode + CLI flag)

**Interfaces:**
- Produces (CLI contract consumed by Task 4): `echo "<81-char puzzle>" | sudoku-generator --grade` prints one JSON object per input line to stdout:
  - solvable: `{"solvable":true,"difficulty":"easy","techniques":["naked_singles","hidden_singles"]}`
  - unsolvable by logic: `{"solvable":false,"difficulty":null,"techniques":[]}`
  - difficulty ∈ `"easy" | "medium" | "hard"`; techniques are the existing snake_case names.

- [ ] **Step 1: Write the failing test**

Add to the bottom of `sudoku-generator/src/main.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    // A puzzle solvable with only singles → easy.
    const EASY_PUZZLE: &str =
        "070000043040009610800634900094052000358460020000800530080070091902100005007040802";

    #[test]
    fn grade_line_reports_solvable_easy_or_harder() {
        let out = grade_line(EASY_PUZZLE);
        assert!(out.solvable, "expected a logic-solvable puzzle");
        assert!(!out.techniques.is_empty(), "expected at least one technique");
        assert!(matches!(out.difficulty.as_deref(), Some("easy") | Some("medium") | Some("hard")));
    }

    #[test]
    fn grade_line_rejects_garbage_length() {
        let out = grade_line("123");
        assert!(!out.solvable);
        assert_eq!(out.difficulty, None);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sudoku-generator && cargo test grade_line 2>&1 | tail -20`
Expected: FAIL — `cannot find function 'grade_line'` / `GradeOutput` not found.

- [ ] **Step 3: Write minimal implementation**

Add near the other types in `sudoku-generator/src/main.rs` (after `PuzzleRecord`):

```rust
#[derive(Serialize)]
struct GradeOutput {
    solvable: bool,
    difficulty: Option<String>,
    techniques: Vec<String>,
}

/// Grade a single 81-char puzzle line (blanks as '0' or '.').
fn grade_line(line: &str) -> GradeOutput {
    let trimmed = line.trim();
    if trimmed.len() != 81 {
        return GradeOutput { solvable: false, difficulty: None, techniques: vec![] };
    }
    // Normalize '.' → '0' for the sudoku crate.
    let normalized: String = trimmed.chars().map(|c| if c == '.' { '0' } else { c }).collect();
    let sudoku = match Sudoku::from_str_line(&normalized) {
        Ok(s) => s,
        Err(_) => return GradeOutput { solvable: false, difficulty: None, techniques: vec![] },
    };
    let solver = StrategySolver::from_sudoku(sudoku);
    match solver.solve(&all_strategies()) {
        Ok((solved, deductions)) => {
            // Confirm the strategies produced a *complete* solution (no backtracking).
            if solved.to_bytes().iter().any(|&b| b == 0) {
                return GradeOutput { solvable: false, difficulty: None, techniques: vec![] };
            }
            let (difficulty, techniques) = grade_techniques(&deductions);
            GradeOutput { solvable: true, difficulty: Some(difficulty.as_str().to_string()), techniques }
        }
        Err(_) => GradeOutput { solvable: false, difficulty: None, techniques: vec![] },
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sudoku-generator && cargo test grade_line 2>&1 | tail -20`
Expected: PASS (2 tests). If `EASY_PUZZLE` happens to grade harder than "easy", the test still passes (it accepts easy|medium|hard); it only asserts solvability + technique presence.

- [ ] **Step 5: Wire the `--grade` CLI flag**

In `struct Args`, add a flag:

```rust
    /// Grade puzzles read from stdin (one 81-char puzzle per line); print one JSON line each.
    #[arg(long, default_value_t = false)]
    grade: bool,
```

At the very top of `fn main()`, before the existing difficulty parsing, add the grade branch:

```rust
    let args = Args::parse();

    if args.grade {
        use std::io::BufRead;
        let stdin = std::io::stdin();
        let stdout = std::io::stdout();
        let mut out = stdout.lock();
        for line in stdin.lock().lines() {
            let line = match line { Ok(l) => l, Err(_) => continue };
            if line.trim().is_empty() { continue; }
            let graded = grade_line(&line);
            let json = serde_json::to_string(&graded).expect("serialize grade output");
            writeln!(out, "{json}").expect("write grade output");
        }
        return;
    }
```

(`writeln!` is available via the existing `use std::io::Write as IoWrite;` import.)

- [ ] **Step 6: Build and characterize the real CLI output**

Run:
```bash
cd sudoku-generator && cargo build --release 2>&1 | tail -3
echo "070000043040009610800634900094052000358460020000800530080070091902100005007040802" | ./target/release/sudoku-generator --grade
```
Expected: one JSON line, e.g. `{"solvable":true,"difficulty":"easy","techniques":["naked_singles","hidden_singles"]}`.
Save the exact line you observe into `dataset-pipeline/tests/fixtures/grade-easy.json` (created in Task 4) — it becomes the parser fixture. Note the absolute path to the built binary; Task 4 calls it.

- [ ] **Step 7: Commit**

```bash
git add sudoku-generator/src/main.rs
git commit -m "feat(generator): add --grade stdin mode for independent technique grading"
```

---

### Task 2: dataset-pipeline scaffolding + config + test wiring

Creates the new pipeline directory, its config module, and wires its tests into the repo's existing `npm test` so there is one test command.

**Files:**
- Create: `dataset-pipeline/src/config.ts`
- Create: `dataset-pipeline/tests/config.test.ts`
- Create: `dataset-pipeline/tests/fixtures/.gitkeep`
- Modify: `package.json` (extend the `test` glob)
- Modify: `.gitignore` (ignore pipeline working dirs + outputs)

**Interfaces:**
- Produces (consumed by Tasks 5–11):
  - `TIERS: readonly ["very_easy","easy","medium"]`
  - `TARGETS: Record<Tier, number>`
  - `QQWING_DIFFICULTY: Record<Tier, "simple"|"easy"|"intermediate">`
  - `EXPECTED_GRADE: Record<Tier, "easy"|"medium">` (the Rust grader difficulty a tier must match)
  - `MIN_CLUES: 17`, `MIN_CLUES_SYMMETRIC: 18`, `BATCH_SIZE: number`, `SOLVE_TIMEOUT_MS: number`
  - `QQWING_IMAGE: "qqwing-trusted"`, `GRADER_BIN: string` (path to the release binary), `WORK_DIR`, `CHECKPOINT_DIR`, `OUTPUT_LOWER` paths.
  - `type Tier = typeof TIERS[number]`

- [ ] **Step 1: Write the failing test**

Create `dataset-pipeline/tests/config.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIERS, TARGETS, QQWING_DIFFICULTY, EXPECTED_GRADE, MIN_CLUES, MIN_CLUES_SYMMETRIC } from '../src/config.ts';

test('lower tiers and targets are defined', () => {
  assert.deepEqual([...TIERS], ['very_easy', 'easy', 'medium']);
  assert.equal(TARGETS.very_easy, 2000);
  assert.equal(TARGETS.easy, 3000);
  assert.equal(TARGETS.medium, 3000);
});

test('qqwing difficulty + expected grade maps cover every tier', () => {
  for (const t of TIERS) {
    assert.ok(QQWING_DIFFICULTY[t], `missing qqwing difficulty for ${t}`);
    assert.ok(EXPECTED_GRADE[t], `missing expected grade for ${t}`);
  }
  assert.equal(QQWING_DIFFICULTY.medium, 'intermediate');
  assert.equal(EXPECTED_GRADE.medium, 'medium');
});

test('clue floors match the spec', () => {
  assert.equal(MIN_CLUES, 17);
  assert.equal(MIN_CLUES_SYMMETRIC, 18);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "dataset-pipeline/tests/config.test.ts"`
Expected: FAIL — cannot find module `../src/config.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `dataset-pipeline/src/config.ts`:

```ts
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
export const SOLVE_TIMEOUT_MS = 30_000; // per-batch qqwing solve timeout guard

export const QQWING_IMAGE = 'qqwing-trusted';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
export const GRADER_BIN = path.join(REPO_ROOT, 'sudoku-generator', 'target', 'release', 'sudoku-generator');
export const WORK_DIR = path.join(REPO_ROOT, 'dataset-pipeline', '.work');
export const CHECKPOINT_DIR = path.join(REPO_ROOT, 'dataset-pipeline', 'checkpoints');
export const OUTPUT_LOWER = path.join(REPO_ROOT, 'sudoku_lower.json');
```

- [ ] **Step 4: Wire tests into npm test + create fixtures dir**

```bash
mkdir -p dataset-pipeline/tests/fixtures && touch dataset-pipeline/tests/fixtures/.gitkeep
```

Edit `package.json` `scripts.test` to:

```json
    "test": "node --test \"tests/**/*.test.ts\" \"dataset-pipeline/tests/**/*.test.ts\""
```

Append to `.gitignore`:

```
dataset-pipeline/.work/
dataset-pipeline/checkpoints/
sudoku_lower.json
sudoku_10000.json
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test 2>&1 | tail -20`
Expected: PASS, including the existing engine tests and the 3 new config tests.

- [ ] **Step 6: Commit**

```bash
git add dataset-pipeline/src/config.ts dataset-pipeline/tests/config.test.ts dataset-pipeline/tests/fixtures/.gitkeep package.json .gitignore
git commit -m "feat(pipeline): scaffold dataset-pipeline with config + test wiring"
```

---

### Task 3: grid helpers (parse / normalize / canonical / symmetry / clue count)

Pure functions for grid string handling and two quality gates (symmetry, clue floor). No I/O. Fully unit-testable.

**Files:**
- Create: `dataset-pipeline/src/grid.ts`
- Create: `dataset-pipeline/tests/grid.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 7, 8, 10):
  - `normalizeBlanks(s: string): string` — `.`→`0`, trims; throws on non-81-length or invalid chars.
  - `clueCount(puzzle: string): number` — count of non-`0` cells.
  - `isSymmetric180(puzzle: string): boolean` — true iff the *given/blank pattern* is invariant under 180° rotation.
  - `canonicalKey(puzzle: string): string` — stable dedupe key (the normalized string; full transform-canonicalization is out of scope — see note).
  - `passesClueFloor(puzzle: string, symmetric: boolean): boolean`

- [ ] **Step 1: Write the failing test**

Create `dataset-pipeline/tests/grid.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBlanks, clueCount, isSymmetric180, canonicalKey, passesClueFloor } from '../src/grid.ts';

const SOLVED =
  '534678912672195348198342567859761423426853791713924856961537284287419635345286179';

test('normalizeBlanks turns dots into zeros and validates length', () => {
  const dotted = '.' + SOLVED.slice(1);
  assert.equal(normalizeBlanks(dotted)[0], '0');
  assert.equal(normalizeBlanks(dotted).length, 81);
  assert.throws(() => normalizeBlanks('123'));
  assert.throws(() => normalizeBlanks('x'.repeat(81)));
});

test('clueCount counts non-zero cells', () => {
  assert.equal(clueCount(SOLVED), 81);
  assert.equal(clueCount('0'.repeat(81)), 0);
});

test('isSymmetric180 detects rotational symmetry of the given pattern', () => {
  // A fully-given grid is trivially symmetric (every cell filled).
  assert.equal(isSymmetric180(SOLVED), true);
  // Asymmetric: only cell 0 filled, its 180° partner (cell 80) blank.
  const asym = '5' + '0'.repeat(80);
  assert.equal(isSymmetric180(asym), false);
  // Symmetric: cell 0 and cell 80 both filled, rest blank.
  const sym = '5' + '0'.repeat(79) + '9';
  assert.equal(isSymmetric180(sym), true);
});

test('canonicalKey is the normalized string', () => {
  const dotted = '.' + SOLVED.slice(1);
  assert.equal(canonicalKey(dotted), normalizeBlanks(dotted));
});

test('passesClueFloor enforces 17 / 18', () => {
  const make = (n: number) => '1'.repeat(n) + '0'.repeat(81 - n);
  assert.equal(passesClueFloor(make(17), false), true);
  assert.equal(passesClueFloor(make(16), false), false);
  assert.equal(passesClueFloor(make(18), true), true);
  assert.equal(passesClueFloor(make(17), true), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "dataset-pipeline/tests/grid.test.ts"`
Expected: FAIL — cannot find module `../src/grid.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `dataset-pipeline/src/grid.ts`:

```ts
import { MIN_CLUES, MIN_CLUES_SYMMETRIC } from './config.ts';

/** Normalize a grid string: trim, map '.' → '0', validate 81 chars of [0-9]. */
export function normalizeBlanks(s: string): string {
  const t = s.trim();
  const out = t.replace(/\./g, '0');
  if (out.length !== 81) throw new Error(`grid must be 81 chars, got ${out.length}`);
  if (!/^[0-9]{81}$/.test(out)) throw new Error('grid contains non-digit characters');
  return out;
}

export function clueCount(puzzle: string): number {
  let n = 0;
  for (const c of puzzle) if (c !== '0') n++;
  return n;
}

/** True iff the filled/blank pattern is invariant under 180° rotation. */
export function isSymmetric180(puzzle: string): boolean {
  for (let i = 0; i < 81; i++) {
    const filled = puzzle[i] !== '0';
    const partnerFilled = puzzle[80 - i] !== '0';
    if (filled !== partnerFilled) return false;
  }
  return true;
}

/**
 * Dedupe key. We dedupe on the exact normalized puzzle string. Full
 * transform-canonicalization (rotation/mirror/relabel) is intentionally out of
 * scope: qqwing's random generation makes exact-string collisions the realistic
 * duplicate, and string dedupe is O(1) per puzzle. (Revisit only if dup rates show
 * disguised duplicates.)
 */
export function canonicalKey(puzzle: string): string {
  return normalizeBlanks(puzzle);
}

export function passesClueFloor(puzzle: string, symmetric: boolean): boolean {
  const floor = symmetric ? MIN_CLUES_SYMMETRIC : MIN_CLUES;
  return clueCount(puzzle) >= floor;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "dataset-pipeline/tests/grid.test.ts"`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add dataset-pipeline/src/grid.ts dataset-pipeline/tests/grid.test.ts
git commit -m "feat(pipeline): grid helpers — normalize, clue count, 180 symmetry, dedupe key"
```

---

### Task 4: Rust grader wrapper (host → `--grade` subprocess)

Wraps the Task 1 binary. Streams a batch of puzzles to one `sudoku-generator --grade` process and parses the per-line JSON. Built against the fixture captured in Task 1 Step 6.

**Files:**
- Create: `dataset-pipeline/src/grader.ts`
- Create: `dataset-pipeline/tests/grader.test.ts`
- Create: `dataset-pipeline/tests/fixtures/grade-easy.json` (from Task 1 Step 6)

**Interfaces:**
- Consumes: `GRADER_BIN` from config; the `--grade` CLI contract from Task 1.
- Produces (consumed by Task 10):
  - `type Grade = { solvable: boolean; difficulty: 'easy'|'medium'|'hard'|null; techniques: string[] }`
  - `parseGradeLine(line: string): Grade`
  - `async gradeBatch(puzzles: string[]): Promise<Grade[]>` — returns one Grade per input, in order.

- [ ] **Step 1: Write the failing test**

Create `dataset-pipeline/tests/grader.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGradeLine } from '../src/grader.ts';

test('parseGradeLine reads a solvable easy grade', () => {
  const g = parseGradeLine('{"solvable":true,"difficulty":"easy","techniques":["naked_singles","hidden_singles"]}');
  assert.equal(g.solvable, true);
  assert.equal(g.difficulty, 'easy');
  assert.deepEqual(g.techniques, ['naked_singles', 'hidden_singles']);
});

test('parseGradeLine reads an unsolvable grade', () => {
  const g = parseGradeLine('{"solvable":false,"difficulty":null,"techniques":[]}');
  assert.equal(g.solvable, false);
  assert.equal(g.difficulty, null);
  assert.deepEqual(g.techniques, []);
});

test('parseGradeLine throws on malformed JSON', () => {
  assert.throws(() => parseGradeLine('not json'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "dataset-pipeline/tests/grader.test.ts"`
Expected: FAIL — cannot find module `../src/grader.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `dataset-pipeline/src/grader.ts`:

```ts
import { spawn } from 'node:child_process';
import { GRADER_BIN } from './config.ts';

export type Grade = {
  solvable: boolean;
  difficulty: 'easy' | 'medium' | 'hard' | null;
  techniques: string[];
};

export function parseGradeLine(line: string): Grade {
  const o = JSON.parse(line);
  return {
    solvable: Boolean(o.solvable),
    difficulty: o.difficulty ?? null,
    techniques: Array.isArray(o.techniques) ? o.techniques : [],
  };
}

/** Grade a batch: one process, puzzles on stdin (one per line), JSON lines on stdout. */
export function gradeBatch(puzzles: string[]): Promise<Grade[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn(GRADER_BIN, ['--grade'], { stdio: ['pipe', 'pipe', 'inherit'] });
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`grader exited ${code}`));
      const lines = out.split('\n').filter((l) => l.trim().length > 0);
      try {
        resolve(lines.map(parseGradeLine));
      } catch (e) {
        reject(e);
      }
    });
    proc.stdin.write(puzzles.join('\n') + '\n');
    proc.stdin.end();
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "dataset-pipeline/tests/grader.test.ts"`
Expected: PASS (3 tests).

- [ ] **Step 5: Integration smoke (real binary)**

Confirm the binary from Task 1 exists and round-trips through `gradeBatch`:

```bash
node --input-type=module -e '
import { gradeBatch } from "./dataset-pipeline/src/grader.ts";
const p = "070000043040009610800634900094052000358460020000800530080070091902100005007040802";
const [g] = await gradeBatch([p]);
console.log(JSON.stringify(g));
'
```
Expected: a JSON Grade with `solvable:true` and a non-empty `techniques` array. If `GRADER_BIN` is missing, re-run Task 1 Step 6 (`cargo build --release`).

- [ ] **Step 6: Commit**

```bash
git add dataset-pipeline/src/grader.ts dataset-pipeline/tests/grader.test.ts dataset-pipeline/tests/fixtures/grade-easy.json
git commit -m "feat(pipeline): host wrapper for the Rust --grade subcommand"
```

---

### Task 5: Trusted qqwing container + qqwing wrappers (generate + solve/count)

Builds the trusted qqwing Docker image and the TS wrappers that generate puzzles and run the uniqueness gate. The exact qqwing stdout format is captured from the real tool (characterization), then parsed.

**Files:**
- Create: `dataset-pipeline/sandbox/qqwing.Dockerfile`
- Create: `dataset-pipeline/sandbox/build-qqwing.sh`
- Create: `dataset-pipeline/src/qqwing.ts`
- Create: `dataset-pipeline/tests/qqwing.test.ts`
- Create: `dataset-pipeline/tests/fixtures/qqwing-solve.txt` (captured real output)

**Interfaces:**
- Consumes: `QQWING_IMAGE`, `QQWING_DIFFICULTY`, `WORK_DIR`, `SOLVE_TIMEOUT_MS`, `BATCH_SIZE` from config.
- Produces (consumed by Task 10):
  - `async generate(tier: Tier, n: number): Promise<string[]>` — n normalized 81-char puzzle strings.
  - `type SolveResult = { puzzle: string; solution: string | null; solutionCount: number }`
  - `parseSolveOutput(raw: string, puzzles: string[]): SolveResult[]` — pairs each input puzzle with its solution + count.
  - `async solveAndCount(puzzles: string[]): Promise<SolveResult[]>` — batch uniqueness gate, with timeout.

- [ ] **Step 1: Author the Dockerfile and build script**

Create `dataset-pipeline/sandbox/qqwing.Dockerfile`:

```dockerfile
# Trusted qqwing: distro-signed apt package. Network used ONLY at build time.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends qqwing \
    && rm -rf /var/lib/apt/lists/*
ENTRYPOINT []
```

Create `dataset-pipeline/sandbox/build-qqwing.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
docker build -f qqwing.Dockerfile -t qqwing-trusted .
echo "built qqwing-trusted; verifying:"
docker run --rm --network none qqwing-trusted qqwing --version
```

- [ ] **Step 2: Build the image and characterize qqwing output**

```bash
chmod +x dataset-pipeline/sandbox/build-qqwing.sh
./dataset-pipeline/sandbox/build-qqwing.sh
# Characterize GENERATE output:
docker run --rm --network none qqwing-trusted qqwing --generate 2 --difficulty easy --symmetry rotate180 --one-line
# Characterize SOLVE + COUNT output for two known puzzles (one unique):
printf '070000043040009610800634900094052000358460020000800530080070091902100005007040802\n' \
  | docker run --rm -i --network none qqwing-trusted qqwing --solve --count-solutions --one-line | tee dataset-pipeline/tests/fixtures/qqwing-solve.txt
```
Observe and record:
- Does `--generate ... --one-line` print ONLY 81-char lines (dots for blanks), or extra stat lines? Note it.
- Does `--solve --count-solutions --one-line` print the solution line, and where does the count appear (e.g. a line like `1 solution` or `Solution count: 1`)? The saved `qqwing-solve.txt` is the ground truth for Step 4's parser.

> If qqwing emits stat lines mixed with puzzle lines, filter to lines matching `^[0-9.]{81}$` for puzzles and parse the count from the line containing the word `solution`. Adjust the regexes in Step 4 to match the captured fixture exactly.

- [ ] **Step 3: Write the failing test (parser against captured fixture)**

Create `dataset-pipeline/tests/qqwing.test.ts` (adjust the literal `raw` string to match your captured `qqwing-solve.txt`; the example below assumes qqwing prints the 81-digit solution line followed by a `N solution(s)` line per puzzle):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSolveOutput } from '../src/qqwing.ts';

test('parseSolveOutput pairs each puzzle with its solution and count', () => {
  const puzzles = ['070000043040009610800634900094052000358460020000800530080070091902100005007040802'];
  // NOTE: replace this with the exact contents of tests/fixtures/qqwing-solve.txt.
  const raw =
    '276158943541329618839674952694712385358469127127835536...REPLACE_WITH_REAL_81...\n' +
    '1 solution\n';
  const results = parseSolveOutput(raw, puzzles);
  assert.equal(results.length, 1);
  assert.equal(results[0].solutionCount, 1);
  assert.equal(results[0].solution?.length, 81);
});

test('parseSolveOutput flags non-unique puzzles', () => {
  const puzzles = ['0'.repeat(81)];
  const raw = '0 solutions\n'; // or whatever qqwing prints for an empty/under-constrained grid
  const results = parseSolveOutput(raw, puzzles);
  assert.equal(results[0].solutionCount, 0);
});
```

> The two `raw` literals MUST be edited to match the real captured output before this test is meaningful. This is a characterization test: the fixture is ground truth.

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test "dataset-pipeline/tests/qqwing.test.ts"`
Expected: FAIL — cannot find module `../src/qqwing.ts`.

- [ ] **Step 5: Write minimal implementation**

Create `dataset-pipeline/src/qqwing.ts`. The parser below assumes: qqwing prints, per input puzzle, an 81-digit solution line (when uniquely solvable) and a line containing the solution count with the word "solution". **Verify against your fixture and adjust the two regexes if needed.**

```ts
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { QQWING_IMAGE, QQWING_DIFFICULTY, WORK_DIR, SOLVE_TIMEOUT_MS, type Tier } from './config.ts';
import { normalizeBlanks } from './grid.ts';

const PUZZLE_LINE = /^[0-9.]{81}$/;
const COUNT_LINE = /(\d+)\s+solution/i;

export type SolveResult = { puzzle: string; solution: string | null; solutionCount: number };

function dockerRun(args: string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('docker', args, { stdio: ['pipe', 'pipe', 'inherit'] });
    let out = '';
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('qqwing docker timeout')); }, SOLVE_TIMEOUT_MS);
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`docker qqwing exited ${code}`));
      resolve(out);
    });
    if (stdin !== undefined) { proc.stdin.write(stdin); proc.stdin.end(); }
  });
}

/** Generate n puzzles for a tier via the trusted qqwing container. */
export async function generate(tier: Tier, n: number): Promise<string[]> {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const diff = QQWING_DIFFICULTY[tier];
  const raw = await dockerRun([
    'run', '--rm', '--network', 'none', QQWING_IMAGE,
    'qqwing', '--generate', String(n), '--difficulty', diff, '--symmetry', 'rotate180', '--one-line',
  ]);
  return raw.split('\n').map((l) => l.trim()).filter((l) => PUZZLE_LINE.test(l)).map(normalizeBlanks);
}

/**
 * Parse qqwing --solve --count-solutions --one-line output. qqwing processes
 * puzzles in input order; per puzzle it prints (when solvable) the solution line
 * and a line containing the solution count. We walk the output, attributing each
 * solution/count to the next input puzzle in order.
 */
export function parseSolveOutput(raw: string, puzzles: string[]): SolveResult[] {
  const results: SolveResult[] = puzzles.map((p) => ({ puzzle: p, solution: null, solutionCount: 0 }));
  let idx = 0;
  let pendingSolution: string | null = null;
  for (const lineRaw of raw.split('\n')) {
    const line = lineRaw.trim();
    if (PUZZLE_LINE.test(line) && /^[0-9]{81}$/.test(line)) {
      pendingSolution = line; // a fully-solved grid
      continue;
    }
    const m = line.match(COUNT_LINE);
    if (m && idx < results.length) {
      results[idx].solutionCount = Number(m[1]);
      results[idx].solution = results[idx].solutionCount === 1 ? pendingSolution : null;
      pendingSolution = null;
      idx++;
    }
  }
  return results;
}

/** Batch uniqueness gate via the trusted qqwing container, with a timeout guard. */
export async function solveAndCount(puzzles: string[]): Promise<SolveResult[]> {
  if (puzzles.length === 0) return [];
  const raw = await dockerRun([
    'run', '--rm', '-i', '--network', 'none', QQWING_IMAGE,
    'qqwing', '--solve', '--count-solutions', '--one-line',
  ], puzzles.join('\n') + '\n');
  return parseSolveOutput(raw, puzzles);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test "dataset-pipeline/tests/qqwing.test.ts"`
Expected: PASS once the `raw` literals + regexes match the captured fixture. If FAIL, diff your fixture against the regexes and fix `PUZZLE_LINE`/`COUNT_LINE`.

- [ ] **Step 7: Integration smoke (real container)**

```bash
node --input-type=module -e '
import { generate, solveAndCount } from "./dataset-pipeline/src/qqwing.ts";
const ps = await generate("easy", 3);
console.log("generated", ps.length, "len", ps[0]?.length);
const r = await solveAndCount(ps);
console.log("counts", r.map(x => x.solutionCount), "sol0len", r[0]?.solution?.length);
'
```
Expected: 3 puzzles of length 81; counts all `1`; each solution length 81.

- [ ] **Step 8: Commit**

```bash
git add dataset-pipeline/sandbox/ dataset-pipeline/src/qqwing.ts dataset-pipeline/tests/qqwing.test.ts dataset-pipeline/tests/fixtures/qqwing-solve.txt
git commit -m "feat(pipeline): trusted qqwing container + generate/solve-count wrappers"
```

---

### Task 6: fun-score

Computes the lower-tier fun-score from a Grade. Reject (score `null`) if not pure-logic solvable; otherwise score = distinct technique count clamped to 0–5.

**Files:**
- Create: `dataset-pipeline/src/funscore.ts`
- Create: `dataset-pipeline/tests/funscore.test.ts`

**Interfaces:**
- Consumes: `Grade` from grader.ts (Task 4).
- Produces (consumed by Tasks 8, 10): `funScore(grade: Grade): number | null` — `null` means reject; else 0–5.

- [ ] **Step 1: Write the failing test**

Create `dataset-pipeline/tests/funscore.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { funScore } from '../src/funscore.ts';

test('unsolvable puzzles are rejected (null)', () => {
  assert.equal(funScore({ solvable: false, difficulty: null, techniques: [] }), null);
});

test('score equals distinct technique count', () => {
  assert.equal(funScore({ solvable: true, difficulty: 'easy', techniques: ['naked_singles', 'hidden_singles'] }), 2);
});

test('score is clamped to 5', () => {
  const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  assert.equal(funScore({ solvable: true, difficulty: 'medium', techniques: many }), 5);
});

test('deduplicates technique names before counting', () => {
  assert.equal(funScore({ solvable: true, difficulty: 'easy', techniques: ['naked_singles', 'naked_singles'] }), 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "dataset-pipeline/tests/funscore.test.ts"`
Expected: FAIL — cannot find module `../src/funscore.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `dataset-pipeline/src/funscore.ts`:

```ts
import type { Grade } from './grader.ts';

/** Lower-tier fun-score: null = reject (needs guessing); otherwise 0–5 technique variety. */
export function funScore(grade: Grade): number | null {
  if (!grade.solvable) return null;
  const distinct = new Set(grade.techniques).size;
  return Math.min(5, distinct);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "dataset-pipeline/tests/funscore.test.ts"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add dataset-pipeline/src/funscore.ts dataset-pipeline/tests/funscore.test.ts
git commit -m "feat(pipeline): fun-score from technique variety"
```

---

### Task 7: dedupe

Deduplicates an array of records by canonical key, preserving first occurrence and order.

**Files:**
- Create: `dataset-pipeline/src/dedupe.ts`
- Create: `dataset-pipeline/tests/dedupe.test.ts`

**Interfaces:**
- Consumes: `canonicalKey` from grid.ts (Task 3).
- Produces (consumed by Tasks 9, 10): `dedupeByPuzzle<T extends { puzzle: string }>(rows: T[]): T[]`.

- [ ] **Step 1: Write the failing test**

Create `dataset-pipeline/tests/dedupe.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeByPuzzle } from '../src/dedupe.ts';

const A = '1'.repeat(17) + '0'.repeat(64);
const B = '2'.repeat(17) + '0'.repeat(64);

test('removes duplicate puzzle strings, keeping first', () => {
  const rows = [{ puzzle: A, tag: 1 }, { puzzle: B, tag: 2 }, { puzzle: A, tag: 3 }];
  const out = dedupeByPuzzle(rows);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((r) => r.tag), [1, 2]);
});

test('treats dotted and zero blanks as the same puzzle', () => {
  const dotted = A.replace(/0/g, '.');
  const out = dedupeByPuzzle([{ puzzle: A }, { puzzle: dotted }]);
  assert.equal(out.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "dataset-pipeline/tests/dedupe.test.ts"`
Expected: FAIL — cannot find module `../src/dedupe.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `dataset-pipeline/src/dedupe.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "dataset-pipeline/tests/dedupe.test.ts"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add dataset-pipeline/src/dedupe.ts dataset-pipeline/tests/dedupe.test.ts
git commit -m "feat(pipeline): dedupe records by canonical puzzle key"
```

---

### Task 8: record builder + schema validation

Builds a `PuzzleRecord` matching the spec schema and validates it. The single place record shape is defined.

**Files:**
- Create: `dataset-pipeline/src/record.ts`
- Create: `dataset-pipeline/tests/record.test.ts`

**Interfaces:**
- Consumes: `Tier` from config; `Grade` from grader; `clueCount`, `normalizeBlanks` from grid.
- Produces (consumed by Tasks 10, 11):
  - `type PuzzleRecord = { puzzle: string; solution: string; difficulty: Tier; techniques: string[]; givens: number; er_rating: number | null; fun_score: number | null; generated_at: string }`
  - `buildRecord(args: { puzzle: string; solution: string; tier: Tier; grade: Grade; funScore: number | null; now: string }): PuzzleRecord`
  - `validateRecord(r: PuzzleRecord): string[]` — array of problems (empty = valid).

- [ ] **Step 1: Write the failing test**

Create `dataset-pipeline/tests/record.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecord, validateRecord } from '../src/record.ts';

const PUZZLE = '1'.repeat(24) + '0'.repeat(57);
const SOLUTION = '123456789'.repeat(9);
const grade = { solvable: true, difficulty: 'easy' as const, techniques: ['naked_singles'] };

test('buildRecord fills schema fields', () => {
  const r = buildRecord({ puzzle: PUZZLE, solution: SOLUTION, tier: 'easy', grade, funScore: 1, now: '2026-06-28T00:00:00Z' });
  assert.equal(r.difficulty, 'easy');
  assert.equal(r.givens, 24);
  assert.equal(r.er_rating, null);
  assert.equal(r.fun_score, 1);
  assert.deepEqual(r.techniques, ['naked_singles']);
  assert.equal(r.generated_at, '2026-06-28T00:00:00Z');
});

test('validateRecord accepts a good record', () => {
  const r = buildRecord({ puzzle: PUZZLE, solution: SOLUTION, tier: 'easy', grade, funScore: 1, now: '2026-06-28T00:00:00Z' });
  assert.deepEqual(validateRecord(r), []);
});

test('validateRecord rejects bad lengths and empty techniques', () => {
  const r = buildRecord({ puzzle: PUZZLE, solution: SOLUTION, tier: 'easy', grade, funScore: 1, now: '2026-06-28T00:00:00Z' });
  assert.ok(validateRecord({ ...r, puzzle: '123' }).length > 0);
  assert.ok(validateRecord({ ...r, solution: '123' }).length > 0);
  assert.ok(validateRecord({ ...r, techniques: [] }).length > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "dataset-pipeline/tests/record.test.ts"`
Expected: FAIL — cannot find module `../src/record.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `dataset-pipeline/src/record.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "dataset-pipeline/tests/record.test.ts"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add dataset-pipeline/src/record.ts dataset-pipeline/tests/record.test.ts
git commit -m "feat(pipeline): record builder + schema validation"
```

---

### Task 9: checkpoint store

Per-tier append-only JSONL checkpoints, so a crash resumes from the last saved survivor. Loads existing survivors and dedupes on load.

**Files:**
- Create: `dataset-pipeline/src/checkpoint.ts`
- Create: `dataset-pipeline/tests/checkpoint.test.ts`

**Interfaces:**
- Consumes: `CHECKPOINT_DIR`, `Tier` from config; `PuzzleRecord` from record; `dedupeByPuzzle` from dedupe.
- Produces (consumed by Task 10):
  - `loadCheckpoint(tier: Tier): PuzzleRecord[]`
  - `appendCheckpoint(tier: Tier, rows: PuzzleRecord[]): void`
  - `checkpointPath(tier: Tier): string`

- [ ] **Step 1: Write the failing test**

Create `dataset-pipeline/tests/checkpoint.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadCheckpoint, appendCheckpoint, checkpointPath } from '../src/checkpoint.ts';

const rec = (puzzle: string) => ({
  puzzle, solution: '123456789'.repeat(9), difficulty: 'easy' as const,
  techniques: ['naked_singles'], givens: 81, er_rating: null, fun_score: 1,
  generated_at: '2026-06-28T00:00:00Z',
});

test('append then load round-trips and dedupes', () => {
  const p = checkpointPath('easy');
  fs.rmSync(p, { force: true });
  const A = '1'.repeat(81), B = '2'.repeat(81);
  appendCheckpoint('easy', [rec(A)]);
  appendCheckpoint('easy', [rec(B), rec(A)]); // A duplicated
  const loaded = loadCheckpoint('easy');
  assert.equal(loaded.length, 2);
  fs.rmSync(p, { force: true });
});

test('loadCheckpoint returns [] when file missing', () => {
  const p = checkpointPath('medium');
  fs.rmSync(p, { force: true });
  assert.deepEqual(loadCheckpoint('medium'), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "dataset-pipeline/tests/checkpoint.test.ts"`
Expected: FAIL — cannot find module `../src/checkpoint.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `dataset-pipeline/src/checkpoint.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { CHECKPOINT_DIR, type Tier } from './config.ts';
import type { PuzzleRecord } from './record.ts';
import { dedupeByPuzzle } from './dedupe.ts';

export function checkpointPath(tier: Tier): string {
  return path.join(CHECKPOINT_DIR, `${tier}.jsonl`);
}

export function loadCheckpoint(tier: Tier): PuzzleRecord[] {
  const p = checkpointPath(tier);
  if (!fs.existsSync(p)) return [];
  const rows = fs.readFileSync(p, 'utf8').split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as PuzzleRecord);
  return dedupeByPuzzle(rows);
}

export function appendCheckpoint(tier: Tier, rows: PuzzleRecord[]): void {
  if (rows.length === 0) return;
  fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
  const text = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.appendFileSync(checkpointPath(tier), text);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "dataset-pipeline/tests/checkpoint.test.ts"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add dataset-pipeline/src/checkpoint.ts dataset-pipeline/tests/checkpoint.test.ts
git commit -m "feat(pipeline): per-tier JSONL checkpoint store"
```

---

### Task 10: tier pipeline (over-generation driver)

Ties the pieces together for ONE tier: generate a batch → uniqueness gate → grade → apply all quality gates → build records → dedupe vs existing → checkpoint, looping until the tier has enough survivors. This is the heart of the build.

**Files:**
- Create: `dataset-pipeline/src/pipeline.ts`
- Create: `dataset-pipeline/tests/pipeline.test.ts`

**Interfaces:**
- Consumes: everything above (`generate`/`solveAndCount`, `gradeBatch`, `funScore`, `buildRecord`/`validateRecord`, `isSymmetric180`/`passesClueFloor`, checkpoint fns, config maps).
- Produces (consumed by Task 11):
  - `acceptPuzzle(args): PuzzleRecord | null` — pure gate function (testable without Docker): applies uniqueness, symmetry, clue floor, grade-match, fun-score, schema. Returns the record or `null` (rejected).
  - `async buildTier(tier: Tier, opts?: { target?: number; now?: () => string }): Promise<PuzzleRecord[]>` — the over-generation loop; resumes from checkpoint.

- [ ] **Step 1: Write the failing test (pure gate logic, no Docker)**

Create `dataset-pipeline/tests/pipeline.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptPuzzle } from '../src/pipeline.ts';

// 18-clue, 180-symmetric blank pattern (cells i and 80-i filled together).
const SYM_PUZZLE = (() => {
  const a = Array(81).fill('0');
  for (let i = 0; i < 9; i++) { a[i] = '1'; a[80 - i] = '1'; }
  return a.join('');
})();
const SOLUTION = '123456789'.repeat(9);
const okSolve = { puzzle: SYM_PUZZLE, solution: SOLUTION, solutionCount: 1 };
const easyGrade = { solvable: true, difficulty: 'easy' as const, techniques: ['naked_singles', 'hidden_singles'] };

test('accepts a unique, symmetric, logic-solvable easy puzzle', () => {
  const r = acceptPuzzle({ tier: 'easy', solve: okSolve, grade: easyGrade, now: '2026-06-28T00:00:00Z' });
  assert.ok(r);
  assert.equal(r!.difficulty, 'easy');
  assert.equal(r!.fun_score, 2);
});

test('rejects non-unique puzzles', () => {
  const r = acceptPuzzle({ tier: 'easy', solve: { ...okSolve, solutionCount: 2, solution: null }, grade: easyGrade, now: 'x' });
  assert.equal(r, null);
});

test('rejects when grader difficulty does not match the tier', () => {
  // medium tier requires grader 'medium'; an 'easy' grade is a mislabeled trivial medium.
  const r = acceptPuzzle({ tier: 'medium', solve: okSolve, grade: easyGrade, now: 'x' });
  assert.equal(r, null);
});

test('rejects asymmetric puzzles', () => {
  const asym = '1' + '0'.repeat(80);
  const r = acceptPuzzle({ tier: 'easy', solve: { puzzle: asym, solution: SOLUTION, solutionCount: 1 }, grade: easyGrade, now: 'x' });
  assert.equal(r, null);
});

test('rejects puzzles that need guessing', () => {
  const r = acceptPuzzle({ tier: 'easy', solve: okSolve, grade: { solvable: false, difficulty: null, techniques: [] }, now: 'x' });
  assert.equal(r, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "dataset-pipeline/tests/pipeline.test.ts"`
Expected: FAIL — cannot find module `../src/pipeline.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `dataset-pipeline/src/pipeline.ts`:

```ts
import { TARGETS, EXPECTED_GRADE, BATCH_SIZE, type Tier } from './config.ts';
import { isSymmetric180, passesClueFloor } from './grid.ts';
import { generate, solveAndCount, type SolveResult } from './qqwing.ts';
import { gradeBatch, type Grade } from './grader.ts';
import { funScore } from './funscore.ts';
import { buildRecord, validateRecord, type PuzzleRecord } from './record.ts';
import { loadCheckpoint, appendCheckpoint } from './checkpoint.ts';
import { dedupeByPuzzle } from './dedupe.ts';

/** Pure acceptance gate for one candidate. Returns the record or null (rejected). */
export function acceptPuzzle(args: {
  tier: Tier; solve: SolveResult; grade: Grade; now: string;
}): PuzzleRecord | null {
  const { tier, solve, grade, now } = args;

  // 1. Unique solution (the mandatory gate).
  if (solve.solutionCount !== 1 || !solve.solution) return null;

  // 2. 180° rotational symmetry of the givens.
  if (!isSymmetric180(solve.puzzle)) return null;

  // 3. Clue floor (always symmetric here → 18).
  if (!passesClueFloor(solve.puzzle, true)) return null;

  // 4. Pure-logic solvable + fun-score.
  const score = funScore(grade);
  if (score === null) return null;

  // 5. Grade matches the tier (real difficulty, not mislabeled).
  if (grade.difficulty !== EXPECTED_GRADE[tier]) return null;

  // 6. Build + validate the record.
  const record = buildRecord({ puzzle: solve.puzzle, solution: solve.solution, tier, grade, funScore: score, now });
  if (validateRecord(record).length > 0) return null;

  return record;
}

/** Over-generation loop for one tier; resumes from checkpoint until target survivors. */
export async function buildTier(tier: Tier, opts?: { target?: number; now?: () => string }): Promise<PuzzleRecord[]> {
  const target = opts?.target ?? TARGETS[tier];
  const now = opts?.now ?? (() => new Date().toISOString());

  let survivors = loadCheckpoint(tier);
  let rounds = 0;
  while (survivors.length < target) {
    const need = target - survivors.length;
    const puzzles = await generate(tier, Math.min(BATCH_SIZE, Math.max(need, 50)));
    const [solves, grades] = await Promise.all([solveAndCount(puzzles), gradeBatch(puzzles)]);

    const accepted: PuzzleRecord[] = [];
    for (let i = 0; i < puzzles.length; i++) {
      const r = acceptPuzzle({ tier, solve: solves[i], grade: grades[i], now: now() });
      if (r) accepted.push(r);
    }
    const fresh = dedupeByPuzzle([...survivors, ...accepted]).slice(survivors.length);
    appendCheckpoint(tier, fresh);
    survivors = survivors.concat(fresh);

    rounds++;
    process.stderr.write(`\r  ${tier}: ${survivors.length}/${target} (round ${rounds})`);
    if (rounds > 100_000) throw new Error(`${tier}: gave up after ${rounds} rounds`);
  }
  process.stderr.write('\n');
  return survivors.slice(0, target);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "dataset-pipeline/tests/pipeline.test.ts"`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add dataset-pipeline/src/pipeline.ts dataset-pipeline/tests/pipeline.test.ts
git commit -m "feat(pipeline): per-tier over-generation driver + pure acceptance gate"
```

---

### Task 11: assemble + CLI entry + smoke run

The top-level command: build all lower tiers, merge, sort, write `sudoku_lower.json`. Includes a tiny smoke run to prove the whole chain end-to-end.

**Files:**
- Create: `dataset-pipeline/src/assemble.ts`
- Create: `dataset-pipeline/bin/run-lower.ts`
- Create: `dataset-pipeline/tests/assemble.test.ts`

**Interfaces:**
- Consumes: `TIERS`, `OUTPUT_LOWER` from config; `buildTier` from pipeline; `PuzzleRecord` from record.
- Produces:
  - `sortRecords(rows: PuzzleRecord[]): PuzzleRecord[]` — orders by tier (very_easy→medium) then givens descending (more clues = gentler first).
  - `async assembleLower(opts?): Promise<PuzzleRecord[]>` — builds all tiers, sorts, writes `OUTPUT_LOWER`.
  - CLI: `node dataset-pipeline/bin/run-lower.ts [--count N]` — N overrides per-tier target for a smoke run.

- [ ] **Step 1: Write the failing test**

Create `dataset-pipeline/tests/assemble.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortRecords } from '../src/assemble.ts';

const rec = (difficulty: any, givens: number) => ({
  puzzle: '1'.repeat(givens) + '0'.repeat(81 - givens), solution: '123456789'.repeat(9),
  difficulty, techniques: ['naked_singles'], givens, er_rating: null, fun_score: 1,
  generated_at: '2026-06-28T00:00:00Z',
});

test('sorts by tier order then givens descending', () => {
  const rows = [rec('medium', 30), rec('very_easy', 40), rec('very_easy', 45), rec('easy', 35)];
  const out = sortRecords(rows);
  assert.deepEqual(out.map((r) => r.difficulty), ['very_easy', 'very_easy', 'easy', 'medium']);
  assert.deepEqual(out.slice(0, 2).map((r) => r.givens), [45, 40]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "dataset-pipeline/tests/assemble.test.ts"`
Expected: FAIL — cannot find module `../src/assemble.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `dataset-pipeline/src/assemble.ts`:

```ts
import fs from 'node:fs';
import { TIERS, OUTPUT_LOWER, type Tier } from './config.ts';
import { buildTier } from './pipeline.ts';
import type { PuzzleRecord } from './record.ts';

const TIER_ORDER: Record<Tier, number> = { very_easy: 0, easy: 1, medium: 2 };

export function sortRecords(rows: PuzzleRecord[]): PuzzleRecord[] {
  return [...rows].sort((a, b) => {
    const t = TIER_ORDER[a.difficulty] - TIER_ORDER[b.difficulty];
    if (t !== 0) return t;
    return b.givens - a.givens; // more givens first → gentler opening within a tier
  });
}

export async function assembleLower(opts?: { target?: number; now?: () => string }): Promise<PuzzleRecord[]> {
  const all: PuzzleRecord[] = [];
  for (const tier of TIERS) {
    const rows = await buildTier(tier, { target: opts?.target, now: opts?.now });
    all.push(...rows);
  }
  const sorted = sortRecords(all);
  fs.writeFileSync(OUTPUT_LOWER, JSON.stringify(sorted, null, 2));
  process.stderr.write(`wrote ${sorted.length} records → ${OUTPUT_LOWER}\n`);
  return sorted;
}
```

Create `dataset-pipeline/bin/run-lower.ts`:

```ts
import { assembleLower } from '../src/assemble.ts';

const argv = process.argv.slice(2);
const ci = argv.indexOf('--count');
const target = ci >= 0 ? Number(argv[ci + 1]) : undefined;

assembleLower({ target }).then(
  (rows) => { process.stderr.write(`done: ${rows.length} records\n`); },
  (err) => { console.error(err); process.exit(1); },
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "dataset-pipeline/tests/assemble.test.ts"`
Expected: PASS (1 test).

- [ ] **Step 5: Full unit suite green**

Run: `npm test 2>&1 | tail -15`
Expected: all suites pass (engine + every dataset-pipeline test).

- [ ] **Step 6: End-to-end smoke run (real Docker + Rust)**

Run: `node dataset-pipeline/bin/run-lower.ts --count 20 2>&1 | tail -20`
Expected: progress lines for each tier reaching `20/20`, then `wrote 60 records → .../sudoku_lower.json`. Inspect:

```bash
node -e 'const j=require("./sudoku_lower.json"); console.log("total", j.length); console.log("by tier", j.reduce((m,r)=>((m[r.difficulty]=(m[r.difficulty]||0)+1),m),{})); console.log("sample", JSON.stringify(j[0]))'
```
Expected: total 60; 20 per tier; sample record has 81-char puzzle/solution, `er_rating:null`, `fun_score` 0–5, non-empty techniques.

> If a tier stalls (never reaches the count), the likely cause is the grade-match gate (Task 10 gate 5) being too strict for qqwing's difficulty mapping — capture the actual `grade.difficulty` distribution for that tier and reconcile `EXPECTED_GRADE`/`QQWING_DIFFICULTY` in `config.ts`. This is the one place real qqwing↔grader behavior must be reconciled; do it with observed data, then re-run.

- [ ] **Step 7: Commit**

```bash
git add dataset-pipeline/src/assemble.ts dataset-pipeline/bin/run-lower.ts dataset-pipeline/tests/assemble.test.ts
git commit -m "feat(pipeline): assemble lower tiers + run-lower CLI + smoke run"
```

---

### Task 12: docs + README

Update the project docs per the team protocol and add a pipeline README.

**Files:**
- Create: `dataset-pipeline/README.md`
- Modify: `docs/CHANGELOG.md`, `docs/STATUS.md`, `docs/ARCHITECTURE.md`

- [ ] **Step 1: Write the pipeline README**

Create `dataset-pipeline/README.md` documenting: prerequisites (Docker running, `cargo build --release` in `sudoku-generator/`), one-time `./sandbox/build-qqwing.sh`, the smoke run `node bin/run-lower.ts --count 20`, the full run `node bin/run-lower.ts`, where output lands (`sudoku_lower.json`), how checkpoints work (`dataset-pipeline/checkpoints/<tier>.jsonl`, delete to restart a tier), and that the hard tier is Plan 2.

- [ ] **Step 2: Update team docs**

- `docs/CHANGELOG.md`: add a dated entry — "Built dataset pipeline foundation + lower tiers (Plan 1): trusted qqwing container, Rust `--grade` mode, TS validation/assembly, produces `sudoku_lower.json`."
- `docs/STATUS.md`: note Plan 1 done; lower-tier dataset generatable; Plan 2 (hard tier sandbox) next.
- `docs/ARCHITECTURE.md`: add `dataset-pipeline/` to the project tree and a one-line description of the two-zone generation flow.

- [ ] **Step 3: Commit**

```bash
git add dataset-pipeline/README.md docs/CHANGELOG.md docs/STATUS.md docs/ARCHITECTURE.md
git commit -m "docs: dataset-pipeline README + protocol doc updates for Plan 1"
```

---

## Self-Review

**Spec coverage (lower-tier scope):**
- Two trust zones / trusted qqwing container → Tasks 5 (+ Plan 2 for untrusted JARs). ✓
- Stage 1 generate lower tiers (qqwing, rotate180, tier map) → Task 5 + config Task 2. ✓
- Uniqueness gate (count-solutions, timeout) → Task 5 (`solveAndCount`, `SOLVE_TIMEOUT_MS`). ✓
- Fun-score (0 guesses + 0–5 variety) → Tasks 1 (grader), 6 (funScore), 10 (gate). ✓
- Quality gates (unique, symmetry, clue floor, dedupe) → Tasks 3, 7, 10. ✓
- Record schema (+er_rating null, +fun_score) → Task 8. ✓
- Checkpointing + over-generation → Tasks 9, 10. ✓
- Assembly/sort/output → Task 11. ✓
- Rust grader reuse → Task 1. ✓
- Hard tier / serate / ER rating → **deferred to Plan 2** (out of scope, stated). ✓

**Placeholder scan:** The only intentional "fill from reality" points are the qqwing output fixture/regexes (Task 5 Steps 2–6) and the `EXPECTED_GRADE`/`QQWING_DIFFICULTY` reconciliation (Task 11 Step 6). Both are characterization-against-real-tool steps with concrete capture commands and a defined resolution path — not vague TODOs. No other placeholders.

**Type consistency:** `Tier`, `Grade`, `SolveResult`, `PuzzleRecord` are each defined once (config/grader/qqwing/record) and imported elsewhere. `gradeBatch`/`parseGradeLine`, `generate`/`solveAndCount`/`parseSolveOutput`, `funScore`, `dedupeByPuzzle`, `buildRecord`/`validateRecord`, `loadCheckpoint`/`appendCheckpoint`/`checkpointPath`, `acceptPuzzle`/`buildTier`, `sortRecords`/`assembleLower` — names match across producer and consumer tasks. ✓

**Scope:** Single coherent plan producing working software (`sudoku_lower.json`). Hard tier correctly split into Plan 2.
