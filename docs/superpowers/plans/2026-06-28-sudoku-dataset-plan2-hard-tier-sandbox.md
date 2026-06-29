# Sudoku Dataset — Plan 2: Hard Tier (Sandbox + HoDoKu + serate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate the hard tier (2,000 puzzles, ER 3.4–5.0) using the untrusted HoDoKu (technique-targeted generation) and serate (ER rating) inside a no-network Docker sandbox, re-validate every survivor with the trusted qqwing container, and merge all four tiers into the final `sudoku_10000.json`.

**Architecture:** A multi-stage Docker image (`sudoku-jars`) fetches and SHA-256-verifies HoDoKu + SE *inside the build*, then runs them with `--network none`. The untrusted JARs never touch the host. The host (TS) orchestrates via `docker run`, reuses Plan 1's foundation (qqwing gate, dedupe, record, checkpoint, assemble), and adds the hard-tier pipeline. Trusted qqwing `count-solutions` is the independent uniqueness gate over HoDoKu's untrusted output; the ER band is the difficulty axis.

**Tech Stack:** Docker (multi-stage Debian + JRE), HoDoKu JAR, Sudoku Explainer / serate JAR, qqwing (trusted container from Plan 1), TypeScript host (Node built-in test runner, zero new deps).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-28-sudoku-10k-dataset-design.md` — authoritative.
- **Depends on Plan 1.** This plan consumes Plan 1's modules: `dataset-pipeline/src/{config,qqwing,grader,record,dedupe,checkpoint,assemble,grid}.ts`. **Do not start execution until Plan 1 is merged into the working tree.** (Writing this plan does not require Plan 1's code; executing it does.)
- **HARD SECURITY RULE — straight to the sandbox.** The untrusted HoDoKu/SE JARs **never touch the host**: not downloaded, stored, verified, or run on the host. The host only issues `docker build` / `docker run`. All acquisition, hash verification, CLI discovery, and execution happen *inside Docker*. There is no `sandbox/jars/` directory on the host and no host-side web research on these tools.
- **In-container acquisition + verify.** `sandbox/jars.Dockerfile` is multi-stage (network only at build). **HoDoKu**: download the JAR and `sha256sum -c` against the hash pinned in `dataset-pipeline/sandbox/jars.lock` (wrong hash → build fails). **serate (SE)**: **built from source** — `git clone` the pinned repo, `git checkout` the pinned **commit SHA** (the immutable integrity pin), `mvn package`. The runtime stage copies only the verified HoDoKu JAR + the freshly built serate JAR.
- **Offline runtime.** Every HoDoKu/serate/qqwing run uses `docker run --network none`. Only the checkpoint dir is bind-mounted (read-write) for text I/O.
- **Hard tier target:** 2,000 puzzles. **ER band:** keep `3.4 ≤ ER ≤ 5.0` only.
- **180° symmetry is enforced for hard** (owner decision). Every hard survivor must pass `isSymmetric180`. If HoDoKu's batch mode can generate symmetric directly, use that; if not, the symmetry gate post-filters (accept the lower yield — do not relax the gate).
- **The Rust grader is NOT used for the hard tier.** The `sudoku` crate's `StrategySolver` lacks wings/chains and cannot solve many ER 3.4–5.0 puzzles; using it would wrongly reject them. Hard-tier difficulty comes from the ER number; uniqueness from qqwing `count-solutions`; techniques from HoDoKu/serate output.
- **Record schema:** hard records set `er_rating` (number) and `fun_score: null`.
- **Characterization, not guessing.** HoDoKu and serate CLI flags + output formats are discovered by running `--help`/sample runs *inside the container*, captured to fixtures, and wrappers are written against the captured output (same pattern as Plan 1 Task 5). No flags are hardcoded from memory.
- **Commits:** one per task minimum; each task ends green.

---

### Task 1: Multi-stage `sudoku-jars` image — fetch + hash-verify HoDoKu & SE in-build

Builds the untrusted-tool image. The fetch stage downloads the JARs and verifies them against pinned hashes inside the build; the runtime stage carries only the verified JARs + a JRE. First acquisition records the hashes into a committed lock file. Nothing touches the host filesystem.

**Files:**
- Create: `dataset-pipeline/sandbox/jars.Dockerfile`
- Create: `dataset-pipeline/sandbox/jars.lock` (HoDoKu URL+SHA-256; serate repo+commit)
- Create: `dataset-pipeline/sandbox/build-jars.sh`

**Interfaces:**
- Produces (consumed by Tasks 2–4): a Docker image tagged `sudoku-jars` containing `/opt/hodoku.jar` and `/opt/serate.jar` (paths confirmed in Step 4), runnable with `docker run --network none sudoku-jars ...`.

- [ ] **Step 1: Pin sources (in a throwaway networked container)**

The sources:
- **HoDoKu** — `hodoku.sourceforge.net` (the project's release JAR). Pinned by URL + SHA-256.
- **serate (SE)** — built from source. The maintained **SukakuExplainer** fork on GitHub (`github.com/SudokuMonster/SukakuExplainer`, a Maven project) exposes the `diuf.sudoku.test.serate` batch-rating mode. Pinned by **repo URL + commit SHA** (the commit is the immutable integrity pin; building avoids trusting an opaque binary).

Discover the resolvable HoDoKu URL + its hash and the serate repo's current commit **inside a container**, never on the host:

```bash
docker run --rm --network bridge debian:bookworm-slim bash -c '
  set -e
  apt-get update >/dev/null && apt-get install -y --no-install-recommends curl ca-certificates git >/dev/null
  echo "=== HoDoKu ==="; curl -fsSLI <HODOKU_URL_CANDIDATE> | head -20 || true
  curl -fsSL -o /tmp/hodoku.jar <HODOKU_URL_CANDIDATE> && sha256sum /tmp/hodoku.jar
  echo "=== serate repo HEAD commit ==="; git ls-remote https://github.com/SudokuMonster/SukakuExplainer.git HEAD
'
```

Record into `dataset-pipeline/sandbox/jars.lock`:

```
# jars.lock — pinned untrusted-tool artifacts (acquired + verified in-container, never on host)
# HoDoKu: downloaded JAR, integrity = SHA-256
HODOKU_URL=<resolved url>
HODOKU_SHA256=<sha256>
# serate: built from source, integrity = pinned commit SHA
SERATE_REPO=https://github.com/SudokuMonster/SukakuExplainer.git
SERATE_COMMIT=<full 40-char commit sha from git ls-remote>
```

- [ ] **Step 2: Write the multi-stage Dockerfile**

Create `dataset-pipeline/sandbox/jars.Dockerfile`. HoDoKu is downloaded + `sha256sum -c`-verified; serate is cloned at the pinned commit and built with Maven — all in network-enabled build stages. The runtime stage has no network and only the artifacts.

```dockerfile
# ---- hodoku fetch stage: download + verify hash ----
FROM debian:bookworm-slim AS hodoku
ARG HODOKU_URL
ARG HODOKU_SHA256
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /opt
RUN curl -fsSL -o hodoku.jar "$HODOKU_URL" \
 && echo "${HODOKU_SHA256}  hodoku.jar" | sha256sum -c -

# ---- serate build stage: clone pinned commit + maven package ----
FROM maven:3-eclipse-temurin-17 AS serate
ARG SERATE_REPO
ARG SERATE_COMMIT
WORKDIR /src
RUN git clone "$SERATE_REPO" . \
 && git checkout "$SERATE_COMMIT" \
 && git rev-parse HEAD | grep -q "^${SERATE_COMMIT}" \
 && mvn -q -DskipTests package
# Copy the built jar to a stable name (confirm the produced artifact name from target/ — adjust glob if needed).
RUN cp "$(ls target/*.jar | grep -v -E 'original|sources|javadoc' | head -1)" /serate.jar

# ---- runtime stage: JRE + artifacts only, no network at run ----
FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends default-jre-headless && rm -rf /var/lib/apt/lists/*
WORKDIR /opt
COPY --from=hodoku /opt/hodoku.jar /opt/hodoku.jar
COPY --from=serate /serate.jar /opt/serate.jar
ENTRYPOINT []
```

Create `dataset-pipeline/sandbox/build-jars.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck disable=SC1091
source ./jars.lock
docker build -f jars.Dockerfile \
  --build-arg HODOKU_URL="$HODOKU_URL" --build-arg HODOKU_SHA256="$HODOKU_SHA256" \
  --build-arg SERATE_REPO="$SERATE_REPO" --build-arg SERATE_COMMIT="$SERATE_COMMIT" \
  -t sudoku-jars .
echo "built sudoku-jars; contents:"
docker run --rm --network none sudoku-jars ls -la /opt
```

- [ ] **Step 3: Build the image (verifies hash + pinned commit)**

```bash
chmod +x dataset-pipeline/sandbox/build-jars.sh
./dataset-pipeline/sandbox/build-jars.sh
```
Expected: build succeeds; the HoDoKu `sha256sum -c` prints `hodoku.jar: OK`; the serate stage checks out the pinned commit (the `git rev-parse | grep` line fails the build if the commit drifts) and Maven produces a jar; final `ls -la /opt` lists `hodoku.jar` + `serate.jar`. A hash mismatch or commit drift must fail the build (that is the security gate working). If the Maven artifact name differs, adjust the `cp "$(ls target/*.jar ...)"` glob to the real built jar.

- [ ] **Step 4: Confirm Java can load each JAR offline**

```bash
docker run --rm --network none sudoku-jars java -jar /opt/hodoku.jar --help 2>&1 | head -40
docker run --rm --network none sudoku-jars sh -c 'java -jar /opt/serate.jar 2>&1 | head -40 || java -cp /opt/serate.jar diuf.sudoku.test.serate 2>&1 | head -40'
```
Record whatever usage text each prints — it is the ground truth for Tasks 2 and 3. (If a JAR needs a different entrypoint/class, note it; Tasks 2–3 wrappers use what you observe here.)

- [ ] **Step 5: Commit**

```bash
git add dataset-pipeline/sandbox/jars.Dockerfile dataset-pipeline/sandbox/jars.lock dataset-pipeline/sandbox/build-jars.sh
git commit -m "feat(sandbox): multi-stage sudoku-jars image — in-build fetch + sha256 verify of HoDoKu/SE"
```

---

### Task 2: HoDoKu hard-generation wrapper (technique-targeted, in-container)

Discovers HoDoKu's batch-generation CLI from its real `--help` (captured in Task 1 Step 4) and wraps it: generate a batch of hard puzzles that require an intermediate technique (X-Wing / Swordfish / wing / subset), plus whatever technique info HoDoKu emits.

**Files:**
- Create: `dataset-pipeline/src/hodoku.ts`
- Create: `dataset-pipeline/tests/hodoku.test.ts`
- Create: `dataset-pipeline/tests/fixtures/hodoku-generate.txt` (captured real output)

**Interfaces:**
- Consumes: `WORK_DIR` from config; the `sudoku-jars` image.
- Produces (consumed by Task 4):
  - `type HodokuPuzzle = { puzzle: string; techniques: string[] }`
  - `parseHodokuOutput(raw: string): HodokuPuzzle[]`
  - `async generateHard(n: number): Promise<HodokuPuzzle[]>`

- [ ] **Step 1: Characterize HoDoKu generation (inside the container)**

From Task 1 Step 4's help text, identify the batch flags. HoDoKu's command-line uses slash-style options (e.g. `/bs`, `/sc`, `/c`); confirm the real ones from the captured help. Run a small generation and capture output:

```bash
mkdir -p dataset-pipeline/tests/fixtures
docker run --rm --network none sudoku-jars java -jar /opt/hodoku.jar <BATCH_GEN_FLAGS_FROM_HELP> 2>&1 \
  | tee dataset-pipeline/tests/fixtures/hodoku-generate.txt
```
Determine and note in a comment at the top of the fixture file: the output shape (one 81-char puzzle per line? dots or zeros for blanks? a trailing rating/technique column?), and the exact flag that forces a target technique (e.g. an X-Wing). If HoDoKu cannot force a technique in batch mode, note that — Task 4 then relies on the serate ER band alone to define "hard" and HoDoKu just generates difficult puzzles.

> **Symmetry (decided — enforced):** 180° symmetry is required for hard. Check whether HoDoKu can generate symmetric directly. If it can, enable that flag (better yield). If it cannot, do nothing here — the `isSymmetric180` gate in Task 4's `acceptHard` post-filters and we accept the lower yield (the checkpoint makes the longer run fine). Never relax the symmetry gate.

- [ ] **Step 2: Write the failing test (parser against captured fixture)**

Create `dataset-pipeline/tests/hodoku.test.ts` (edit the `raw` literal to match your captured fixture):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHodokuOutput } from '../src/hodoku.ts';

test('parseHodokuOutput extracts 81-char puzzles', () => {
  // REPLACE with the real shape from tests/fixtures/hodoku-generate.txt
  const raw = '..REPLACE_WITH_81_CHARS..\n..REPLACE_WITH_81_CHARS..\n';
  const out = parseHodokuOutput(raw);
  assert.ok(out.length >= 1);
  assert.equal(out[0].puzzle.length, 81);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test "dataset-pipeline/tests/hodoku.test.ts"`
Expected: FAIL — cannot find module `../src/hodoku.ts`.

- [ ] **Step 4: Write minimal implementation**

Create `dataset-pipeline/src/hodoku.ts` (set `HODOKU_GEN_ARGS` to the flags confirmed in Step 1; adjust `PUZZLE_RE`/technique parsing to the captured fixture):

```ts
import { spawn } from 'node:child_process';
import { normalizeBlanks } from './grid.ts';

// Flags confirmed from HoDoKu --help in Task 1/2 characterization.
const HODOKU_GEN_ARGS = ['java', '-jar', '/opt/hodoku.jar', /* <BATCH_GEN_FLAGS> */];
const PUZZLE_RE = /[0-9.]{81}/;

export type HodokuPuzzle = { puzzle: string; techniques: string[] };

export function parseHodokuOutput(raw: string): HodokuPuzzle[] {
  const out: HodokuPuzzle[] = [];
  for (const lineRaw of raw.split('\n')) {
    const line = lineRaw.trim();
    const m = line.match(PUZZLE_RE);
    if (!m) continue;
    out.push({ puzzle: normalizeBlanks(m[0]), techniques: [] }); // techniques filled if HoDoKu emits them
  }
  return out;
}

function dockerRun(args: string[], n: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('docker', ['run', '--rm', '--network', 'none', 'sudoku-jars', ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => code === 0 ? resolve(out) : reject(new Error(`hodoku exited ${code}`)));
  });
}

export async function generateHard(n: number): Promise<HodokuPuzzle[]> {
  // If the batch count is a flag, inject n into HODOKU_GEN_ARGS here.
  const raw = await dockerRun(HODOKU_GEN_ARGS, n);
  return parseHodokuOutput(raw).slice(0, n);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test "dataset-pipeline/tests/hodoku.test.ts"`
Expected: PASS once `raw`/`PUZZLE_RE` match the fixture.

- [ ] **Step 6: Integration smoke (real container)**

```bash
node --input-type=module -e '
import { generateHard } from "./dataset-pipeline/src/hodoku.ts";
const ps = await generateHard(5);
console.log("got", ps.length, "len", ps[0]?.puzzle.length);
'
```
Expected: ≥1 puzzle of length 81.

- [ ] **Step 7: Commit**

```bash
git add dataset-pipeline/src/hodoku.ts dataset-pipeline/tests/hodoku.test.ts dataset-pipeline/tests/fixtures/hodoku-generate.txt
git commit -m "feat(pipeline): HoDoKu hard-generation wrapper (in-sandbox, characterized)"
```

---

### Task 3: serate ER-rating wrapper (in-container)

Discovers serate's real CLI from Task 1 Step 4 and wraps it: feed a batch of puzzles, get one ER number per puzzle.

**Files:**
- Create: `dataset-pipeline/src/serate.ts`
- Create: `dataset-pipeline/tests/serate.test.ts`
- Create: `dataset-pipeline/tests/fixtures/serate-out.txt` (captured real output)

**Interfaces:**
- Consumes: `WORK_DIR`, `SOLVE_TIMEOUT_MS` from config; the `sudoku-jars` image.
- Produces (consumed by Task 4):
  - `type Rating = { puzzle: string; er: number | null }`
  - `parseSerateOutput(raw: string, puzzles: string[]): Rating[]`
  - `async rate(puzzles: string[]): Promise<Rating[]>`

- [ ] **Step 1: Characterize serate (inside the container)**

Using the entrypoint/class confirmed in Task 1 Step 4, rate a small known batch. serate's conventional invocation is roughly `java -Xrs -Xmx1g -cp /opt/serate.jar diuf.sudoku.test.serate --input <file> --output <file> --format "%r"` — **confirm the real class, flags, input format (81-char lines), and the ER token in the output** from the help/sample run, then:

```bash
WORK=$(mktemp -d)
printf '<81-char-hard-puzzle-1>\n<81-char-hard-puzzle-2>\n' > "$WORK/in.txt"
docker run --rm --network none -v "$WORK":/work sudoku-jars \
  sh -c 'java -Xrs -Xmx1g -cp /opt/serate.jar <SERATE_CLASS> <SERATE_FLAGS> /work/in.txt 2>&1' \
  | tee dataset-pipeline/tests/fixtures/serate-out.txt
```
Note in a fixture comment: where the ER number appears (e.g. a per-line `4.2` token, or `Rating: 4.2`), and whether output order matches input order. That is the ground truth for Step 4's parser.

- [ ] **Step 2: Write the failing test**

Create `dataset-pipeline/tests/serate.test.ts` (edit `raw` to match the fixture):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSerateOutput } from '../src/serate.ts';

test('parseSerateOutput pairs each puzzle with its ER number', () => {
  const puzzles = ['1'.repeat(81), '2'.repeat(81)];
  const raw = '4.2\n3.6\n'; // REPLACE with the real serate output shape
  const out = parseSerateOutput(raw, puzzles);
  assert.equal(out.length, 2);
  assert.equal(out[0].er, 4.2);
  assert.equal(out[1].er, 3.6);
});

test('parseSerateOutput yields null ER for unparseable lines', () => {
  const out = parseSerateOutput('ERROR\n', ['1'.repeat(81)]);
  assert.equal(out[0].er, null);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test "dataset-pipeline/tests/serate.test.ts"`
Expected: FAIL — cannot find module `../src/serate.ts`.

- [ ] **Step 4: Write minimal implementation**

Create `dataset-pipeline/src/serate.ts` (set `SERATE_ARGS`/`ER_RE` to the characterized reality):

```ts
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { WORK_DIR, SOLVE_TIMEOUT_MS } from './config.ts';

const ER_RE = /(\d+\.\d+)/; // a per-line ER token; adjust to the captured fixture

export type Rating = { puzzle: string; er: number | null };

export function parseSerateOutput(raw: string, puzzles: string[]): Rating[] {
  const lines = raw.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  return puzzles.map((p, i) => {
    const m = (lines[i] ?? '').match(ER_RE);
    return { puzzle: p, er: m ? Number(m[1]) : null };
  });
}

export function rate(puzzles: string[]): Promise<Rating[]> {
  return new Promise((resolve, reject) => {
    if (puzzles.length === 0) return resolve([]);
    fs.mkdirSync(WORK_DIR, { recursive: true });
    const inPath = path.join(WORK_DIR, 'serate-in.txt');
    fs.writeFileSync(inPath, puzzles.join('\n') + '\n');
    const args = [
      'run', '--rm', '--network', 'none', '-v', `${WORK_DIR}:/work`, 'sudoku-jars',
      'sh', '-c', `java -Xrs -Xmx1g -cp /opt/serate.jar <SERATE_CLASS> <SERATE_FLAGS> /work/serate-in.txt`,
    ];
    const proc = spawn('docker', args, { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('serate timeout')); }, SOLVE_TIMEOUT_MS * 4);
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
    proc.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(parseSerateOutput(out, puzzles)) : reject(new Error(`serate exited ${code}`)); });
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test "dataset-pipeline/tests/serate.test.ts"`
Expected: PASS once `raw`/`ER_RE` match the fixture.

- [ ] **Step 6: Integration smoke (real container)**

```bash
node --input-type=module -e '
import { generateHard } from "./dataset-pipeline/src/hodoku.ts";
import { rate } from "./dataset-pipeline/src/serate.ts";
const ps = (await generateHard(3)).map(p => p.puzzle);
const r = await rate(ps);
console.log(r.map(x => x.er));
'
```
Expected: an array of ER numbers (or nulls), one per puzzle.

- [ ] **Step 7: Commit**

```bash
git add dataset-pipeline/src/serate.ts dataset-pipeline/tests/serate.test.ts dataset-pipeline/tests/fixtures/serate-out.txt
git commit -m "feat(pipeline): serate ER-rating wrapper (in-sandbox, characterized)"
```

---

### Task 4: Hard-tier config + pipeline (ER filter + trusted qqwing gate)

Adds the hard tier to config and builds its over-generation pipeline: HoDoKu generate → serate rate → ER filter → trusted qqwing uniqueness gate → symmetry/clue gates → record (with `er_rating`) → dedupe → checkpoint, until 2,000 survivors.

**Files:**
- Modify: `dataset-pipeline/src/config.ts` (add `hard` to tiers + ER band)
- Modify: `dataset-pipeline/src/record.ts` (accept `erRating`)
- Create: `dataset-pipeline/src/hard-pipeline.ts`
- Create: `dataset-pipeline/tests/hard-pipeline.test.ts`

**Interfaces:**
- Consumes: `generateHard` (Task 2), `rate` (Task 3), `solveAndCount` (Plan 1 qqwing.ts), `isSymmetric180`/`passesClueFloor` (Plan 1 grid.ts), `buildRecord`/`validateRecord` (Plan 1 record.ts, modified), checkpoint + dedupe (Plan 1).
- Produces (consumed by Task 5):
  - `ER_MIN = 3.4`, `ER_MAX = 5.0` (config)
  - `acceptHard(args): PuzzleRecord | null` — pure gate.
  - `async buildHardTier(opts?): Promise<PuzzleRecord[]>`

- [ ] **Step 1: Extend config + record (write failing test first)**

Create `dataset-pipeline/tests/hard-pipeline.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptHard } from '../src/hard-pipeline.ts';
import { ER_MIN, ER_MAX } from '../src/config.ts';

const SYM = (() => { const a = Array(81).fill('0'); for (let i=0;i<10;i++){a[i]='1';a[80-i]='1';} return a.join(''); })();
const SOL = '123456789'.repeat(9);

test('ER band constants', () => { assert.equal(ER_MIN, 3.4); assert.equal(ER_MAX, 5.0); });

test('accepts a unique, symmetric, in-band hard puzzle', () => {
  const r = acceptHard({ solve: { puzzle: SYM, solution: SOL, solutionCount: 1 }, er: 4.2, techniques: ['x_wing'], now: 't' });
  assert.ok(r);
  assert.equal(r!.difficulty, 'hard');
  assert.equal(r!.er_rating, 4.2);
  assert.equal(r!.fun_score, null);
});

test('rejects out-of-band ER', () => {
  assert.equal(acceptHard({ solve: { puzzle: SYM, solution: SOL, solutionCount: 1 }, er: 6.5, techniques: ['x_wing'], now: 't' }), null);
  assert.equal(acceptHard({ solve: { puzzle: SYM, solution: SOL, solutionCount: 1 }, er: 3.0, techniques: ['x_wing'], now: 't' }), null);
});

test('rejects non-unique', () => {
  assert.equal(acceptHard({ solve: { puzzle: SYM, solution: null, solutionCount: 2 }, er: 4.2, techniques: ['x_wing'], now: 't' }), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "dataset-pipeline/tests/hard-pipeline.test.ts"`
Expected: FAIL — cannot find `../src/hard-pipeline.ts` / `ER_MIN`.

- [ ] **Step 3: Implement config + record changes**

In `dataset-pipeline/src/config.ts`, add `'hard'` to `TIERS` and the ER band. Change:

```ts
export const TIERS = ['very_easy', 'easy', 'medium', 'hard'] as const;
```

and append:

```ts
export const ER_MIN = 3.4;
export const ER_MAX = 5.0;
```

(`TARGETS.hard` is already 2,000. `QQWING_DIFFICULTY` / `EXPECTED_GRADE` intentionally have no `hard` entry — hard is not qqwing-generated or Rust-graded. Guard any code that iterates `QQWING_DIFFICULTY` to skip `hard`.)

In `dataset-pipeline/src/record.ts`, extend `buildRecord` to accept an optional `erRating`:

```ts
export function buildRecord(args: {
  puzzle: string; solution: string; tier: Tier; grade: { techniques: string[] };
  funScore: number | null; erRating?: number | null; now: string;
}): PuzzleRecord {
  const puzzle = normalizeBlanks(args.puzzle);
  const solution = normalizeBlanks(args.solution);
  return {
    puzzle, solution, difficulty: args.tier, techniques: args.grade.techniques,
    givens: clueCount(puzzle), er_rating: args.erRating ?? null,
    fun_score: args.funScore, generated_at: args.now,
  };
}
```

> Note: this widens `grade` to `{ techniques: string[] }` so hard (no full `Grade`) can pass a techniques list. Plan 1 callers pass a full `Grade`, which still satisfies the narrower shape — no Plan 1 change needed. Re-run Plan 1's `record.test.ts` after this edit to confirm.

- [ ] **Step 4: Implement the hard pipeline**

Create `dataset-pipeline/src/hard-pipeline.ts`:

```ts
import { TARGETS, ER_MIN, ER_MAX, BATCH_SIZE } from './config.ts';
import { isSymmetric180, passesClueFloor } from './grid.ts';
import { solveAndCount, type SolveResult } from './qqwing.ts';
import { generateHard } from './hodoku.ts';
import { rate } from './serate.ts';
import { buildRecord, validateRecord, type PuzzleRecord } from './record.ts';
import { loadCheckpoint, appendCheckpoint } from './checkpoint.ts';
import { dedupeByPuzzle } from './dedupe.ts';

/** Pure acceptance gate for one hard candidate. */
export function acceptHard(args: {
  solve: SolveResult; er: number | null; techniques: string[]; now: string;
}): PuzzleRecord | null {
  const { solve, er, techniques, now } = args;
  if (solve.solutionCount !== 1 || !solve.solution) return null;          // trusted uniqueness gate
  if (er === null || er < ER_MIN || er > ER_MAX) return null;             // ER band
  if (!isSymmetric180(solve.puzzle)) return null;                        // symmetry (see Task 2 note)
  if (!passesClueFloor(solve.puzzle, true)) return null;                  // clue floor
  const tech = techniques.length > 0 ? techniques : ['x_wing'];          // fallback technique tag
  const record = buildRecord({ puzzle: solve.puzzle, solution: solve.solution, tier: 'hard', grade: { techniques: tech }, funScore: null, erRating: er, now });
  if (validateRecord(record).length > 0) return null;
  return record;
}

export async function buildHardTier(opts?: { target?: number; now?: () => string }): Promise<PuzzleRecord[]> {
  const target = opts?.target ?? TARGETS.hard;
  const now = opts?.now ?? (() => new Date().toISOString());

  let survivors = loadCheckpoint('hard');
  let rounds = 0;
  while (survivors.length < target) {
    const batch = await generateHard(BATCH_SIZE);
    const puzzles = batch.map((b) => b.puzzle);
    const [solves, ratings] = await Promise.all([solveAndCount(puzzles), rate(puzzles)]);

    const accepted: PuzzleRecord[] = [];
    for (let i = 0; i < puzzles.length; i++) {
      const r = acceptHard({ solve: solves[i], er: ratings[i]?.er ?? null, techniques: batch[i].techniques, now: now() });
      if (r) accepted.push(r);
    }
    const fresh = dedupeByPuzzle([...survivors, ...accepted]).slice(survivors.length);
    appendCheckpoint('hard', fresh);
    survivors = survivors.concat(fresh);

    rounds++;
    process.stderr.write(`\r  hard: ${survivors.length}/${target} (round ${rounds})`);
    if (rounds > 100_000) throw new Error(`hard: gave up after ${rounds} rounds`);
  }
  process.stderr.write('\n');
  return survivors.slice(0, target);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test "dataset-pipeline/tests/hard-pipeline.test.ts" "dataset-pipeline/tests/record.test.ts"`
Expected: PASS (hard-pipeline 4 tests + Plan 1's record tests still green).

- [ ] **Step 6: Commit**

```bash
git add dataset-pipeline/src/config.ts dataset-pipeline/src/record.ts dataset-pipeline/src/hard-pipeline.ts dataset-pipeline/tests/hard-pipeline.test.ts
git commit -m "feat(pipeline): hard-tier pipeline — ER filter + trusted qqwing uniqueness gate"
```

---

### Task 5: Assemble all four tiers → `sudoku_10000.json`

Extends Plan 1's assembly to include the hard tier and write the final dataset.

**Files:**
- Modify: `dataset-pipeline/src/assemble.ts` (include hard; final output path)
- Create: `dataset-pipeline/bin/run-all.ts`
- Modify: `dataset-pipeline/tests/assemble.test.ts` (hard in sort order)

**Interfaces:**
- Consumes: `buildTier` (Plan 1 lower tiers), `buildHardTier` (Task 4), `sortRecords`, `OUTPUT` path.
- Produces: `sudoku_10000.json`; CLI `node dataset-pipeline/bin/run-all.ts [--count N]`.

- [ ] **Step 1: Add the failing test for hard in sort order**

Append to `dataset-pipeline/tests/assemble.test.ts`:

```ts
import { sortRecords as sortAll } from '../src/assemble.ts';

test('hard sorts last after very_easy/easy/medium', () => {
  const rec = (difficulty: any, givens: number) => ({
    puzzle: '1'.repeat(givens) + '0'.repeat(81 - givens), solution: '123456789'.repeat(9),
    difficulty, techniques: ['x_wing'], givens, er_rating: difficulty === 'hard' ? 4.2 : null,
    fun_score: difficulty === 'hard' ? null : 1, generated_at: 't',
  });
  const out = sortAll([rec('hard', 24), rec('very_easy', 40), rec('medium', 30)]);
  assert.deepEqual(out.map((r) => r.difficulty), ['very_easy', 'medium', 'hard']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "dataset-pipeline/tests/assemble.test.ts"`
Expected: FAIL — `hard` missing from `TIER_ORDER` (undefined sort key).

- [ ] **Step 3: Implement assembly changes**

In `dataset-pipeline/src/assemble.ts`:
- Add `hard: 3` to `TIER_ORDER`.
- Add the final output constant and a four-tier assembler. Add near the top:

```ts
import path from 'node:path';
import { buildHardTier } from './hard-pipeline.ts';
const OUTPUT_FULL = path.join(path.dirname(OUTPUT_LOWER), 'sudoku_10000.json');
```

and add:

```ts
export async function assembleAll(opts?: { target?: number; now?: () => string }): Promise<PuzzleRecord[]> {
  const all: PuzzleRecord[] = [];
  for (const tier of ['very_easy', 'easy', 'medium'] as const) {
    all.push(...await buildTier(tier, { target: opts?.target, now: opts?.now }));
  }
  all.push(...await buildHardTier({ target: opts?.target, now: opts?.now }));
  const sorted = sortRecords(all);
  fs.writeFileSync(OUTPUT_FULL, JSON.stringify(sorted, null, 2));
  process.stderr.write(`wrote ${sorted.length} records → ${OUTPUT_FULL}\n`);
  return sorted;
}
```

Update `TIER_ORDER`'s type to include `hard` (it already keys on `Tier`, which now includes `hard` from Task 4 — no change needed beyond the `hard: 3` entry).

Create `dataset-pipeline/bin/run-all.ts`:

```ts
import { assembleAll } from '../src/assemble.ts';

const argv = process.argv.slice(2);
const ci = argv.indexOf('--count');
const target = ci >= 0 ? Number(argv[ci + 1]) : undefined;

assembleAll({ target }).then(
  (rows) => { process.stderr.write(`done: ${rows.length} records\n`); },
  (err) => { console.error(err); process.exit(1); },
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -15`
Expected: all suites green (Plan 1 + Plan 2).

- [ ] **Step 5: End-to-end smoke run (all four tiers)**

Pre-req: `qqwing-trusted` and `sudoku-jars` images built; `sudoku-generator` release binary built (Plan 1).

Run: `node dataset-pipeline/bin/run-all.ts --count 10 2>&1 | tail -25`
Expected: progress for all four tiers reaching `10/10`, then `wrote 40 records → .../sudoku_10000.json`. Inspect:

```bash
node -e 'const j=require("./sudoku_10000.json"); console.log("total", j.length); const by=j.reduce((m,r)=>((m[r.difficulty]=(m[r.difficulty]||0)+1),m),{}); console.log(by); const h=j.find(r=>r.difficulty==="hard"); console.log("hard sample er", h?.er_rating, "fun", h?.fun_score)'
```
Expected: total 40; 10 per tier; hard sample has `er_rating` in [3.4,5.0] and `fun_score:null`.

> If the hard tier yields very slowly, the bottleneck is serate (it is CPU-heavy). Lower `BATCH_SIZE` is fine; the checkpoint makes the full 2,000 run resumable. If symmetry was found unsupported in Task 2, this is where the owner decision on the symmetry gate takes effect.

- [ ] **Step 6: Commit**

```bash
git add dataset-pipeline/src/assemble.ts dataset-pipeline/bin/run-all.ts dataset-pipeline/tests/assemble.test.ts
git commit -m "feat(pipeline): assemble all four tiers → sudoku_10000.json"
```

---

### Task 6: Full run + docs

Run the real 10,000-puzzle build and update docs.

**Files:**
- Modify: `dataset-pipeline/README.md`, `docs/CHANGELOG.md`, `docs/STATUS.md`, `docs/BUGS.md` (if any tool quirks found)

- [ ] **Step 1: Full build**

Run: `node dataset-pipeline/bin/run-all.ts 2>&1 | tail -30`
Expected: each tier reaches its target (2,000 / 3,000 / 3,000 / 2,000), final `wrote 10000 records → sudoku_10000.json`. This is long-running; checkpoints make it resumable (re-run the same command to resume). Verify counts:

```bash
node -e 'const j=require("./sudoku_10000.json"); console.log(j.length, j.reduce((m,r)=>((m[r.difficulty]=(m[r.difficulty]||0)+1),m),{}))'
```
Expected: `10000 { very_easy: 2000, easy: 3000, medium: 3000, hard: 2000 }`.

- [ ] **Step 2: Update docs**

- `dataset-pipeline/README.md`: add the hard-tier prerequisites (`./sandbox/build-jars.sh`), the `run-all.ts` command, serate's cost note, and the resume behavior.
- `docs/CHANGELOG.md`: dated entry — "Plan 2: hard tier via sandboxed HoDoKu + serate (in-container fetch/verify), trusted qqwing gate; full `sudoku_10000.json` (10k) produced."
- `docs/STATUS.md`: dataset complete; note the dedupe/yield stats observed.
- `docs/BUGS.md`: record any HoDoKu/serate quirks discovered during characterization (e.g. symmetry limitation, output-format oddities).

- [ ] **Step 3: Commit**

```bash
git add dataset-pipeline/README.md docs/CHANGELOG.md docs/STATUS.md docs/BUGS.md
git commit -m "docs: Plan 2 complete — full 10k dataset; tool quirks recorded"
```

---

## Self-Review

**Spec coverage (hard-tier scope):**
- Untrusted JAR sandbox, in-container fetch + `sha256sum -c` verify, never on host → Task 1. ✓
- HoDoKu technique-targeted hard generation → Task 2 (characterized). ✓
- serate ER rating, keep ER 3.4–5.0 → Tasks 3, 4. ✓
- Trusted qqwing `count-solutions` re-validation of untrusted output → Task 4 (`acceptHard` via Plan 1 `solveAndCount`). ✓
- Quality gates on hard (unique, symmetry, clue floor, dedupe) → Task 4. ✓
- Record schema `er_rating` set, `fun_score:null` → Tasks 4 (record change). ✓
- Checkpoint + over-generation → Task 4. ✓
- Merge all four tiers → `sudoku_10000.json` → Task 5. ✓
- Full run + docs → Task 6. ✓
- Timeout guard on the gate → inherited from Plan 1 `solveAndCount`; serate has its own timeout (Task 3). ✓

**Placeholder scan:** Intentional "fill from reality" points are all characterization-against-the-real-tool (in-container): HoDoKu flags/output (Task 2), serate class/flags/output (Task 3), and the JAR URLs/hashes (Task 1). Each has a concrete in-container capture command and a defined resolution path. The `<...>` tokens (`HODOKU_GEN_ARGS`, `SERATE_CLASS`, etc.) are explicitly flagged to be set from those captures — not left vague. No accidental TODOs.

**Type consistency:** `HodokuPuzzle`, `Rating`, `SolveResult`, `PuzzleRecord`, `Tier` defined once and imported. `generateHard`/`parseHodokuOutput`, `rate`/`parseSerateOutput`, `acceptHard`/`buildHardTier`, `assembleAll`/`sortRecords` match across producer/consumer. `buildRecord`'s widened `grade: { techniques: string[] }` is satisfied by Plan 1's `Grade` (structural compatibility) — Plan 1 callers unchanged. ✓

**Cross-plan dependency:** Every Plan 1 import (`config`, `qqwing.solveAndCount`, `grid`, `record`, `checkpoint`, `dedupe`, `assemble.buildTier/sortRecords`) is listed; execution is gated on Plan 1 being merged. ✓

**Owner decisions locked (2026-06-29):**
- **180° symmetry enforced for hard.** If HoDoKu can't generate symmetric natively, the `isSymmetric180` gate post-filters and we accept lower yield; the gate is never relaxed.
- **serate built from source in-container.** Pinned by repo + commit SHA, Maven build in a dedicated build stage (Task 1). No release-JAR download for serate.

**Remaining characterization (mechanical, no owner decision needed):**
- Exact HoDoKu batch/forced-technique flags and output format → Task 2 (in-container `--help`).
- Exact serate class/flags/output token + the Maven artifact name → Tasks 1 & 3 (in-container).
