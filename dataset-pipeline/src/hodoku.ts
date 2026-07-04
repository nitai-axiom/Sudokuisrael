/**
 * HoDoKu hard-generation wrapper.
 *
 * ## Characterization findings (2026-06-29, Colima arm64 VM)
 *
 * ### CLI mechanism
 * - Entrypoint: java -jar /opt/hodoku.jar
 * - Generation mode: /s /sc <technique> /o stdout
 *   - /s = generate mode (no count arg; runs until stdin closed)
 *   - /sc <step> = constrain generated puzzles to include <step> in their path
 *   - /o stdout = write to console (not file)
 * - Termination: Main thread blocks on BufferedReader.readLine() from stdin.
 *   When stdin closes (EOF), it interrupts the generator thread and prints "Gesamt:" summary.
 *   REQUIRES docker run -i (--interactive) flag, otherwise stdin is /dev/null → 0 puzzles.
 *
 * ### Output format
 *   <81-char puzzle with '.' for blanks> # <technique-path>
 *
 * Technique-path: space-separated tokens:
 *   - 'x'    = arbitrary steps
 *   - 'ssts' = SSTS-level steps (basic techniques)
 *   - 's'    = singles only
 *   - 'bf2(N)' = X-Wing with N eliminations
 *   - 'sk(N)', 'w(N)', 'xyc(N)' etc. = other techniques with counts
 *
 * Same puzzle string appears multiple times (one line per technique path found).
 * Parser deduplicates by puzzle string, collecting all technique names per puzzle.
 *
 * ### Technique-forcing
 * YES — /sc bf2 forces X-Wing to appear in every generated puzzle's path.
 * We use /sc bf2,bf3,xy (X-Wing, Swordfish, XY-Wing) for intermediate-hard coverage.
 *
 * ### 180° symmetry support
 * NOT AVAILABLE via CLI. Confirmed by bytecode inspection: SearchForTypeThread.run()
 * calls generator.generateSudoku(false) — hardcoded asymmetric. No CLI flag exists.
 * Task 4's isSymmetric180 gate post-filters; we do nothing about symmetry here.
 *
 * ### Container-leak fix (OVERRIDE 1 / DP-2)
 * runContainer from docker.ts rejects on timeout (no partial output).
 * HoDoKu needs stdin kept open for a time budget, then closed to terminate cleanly.
 * We implement runHodokuGenerate() following the same named-container + force-stop
 * pattern as runContainer (no docker run --rm + SIGKILL leak), but with:
 *   1. docker run -i flag (interactive stdin)
 *   2. Resolve with accumulated stdout after sending EOF to stdin (clean exit, code 0)
 * We import withContainerName from docker.ts to share the name-injection helper.
 *
 * ### Timeout budget
 * Observed rate: ~200 X-Wing puzzles per 15 seconds on 2-CPU Colima VM.
 * Budget: max(60s floor, n * 2s per puzzle) — generous for container startup + slow puzzles.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { withContainerName } from './docker.ts';
import { normalizeBlanks } from './grid.ts';

// Flags confirmed from /h characterization and in-container generation testing (Task 2):
//   /s          = generate mode
//   /sc bf2,bf3,xy = force X-Wing, Swordfish, or XY-Wing in the solution path
//                   (intermediate techniques that define "hard" tier)
//   /o stdout   = write output to stdout (not to a file)
// Docker -i flag is REQUIRED so stdin stays open and the generator keeps running.
const HODOKU_IMAGE = 'sudoku-jars';
const HODOKU_BASE_ARGS = [
  'run', '--rm', '-i', '--network', 'none',
  HODOKU_IMAGE,
  'java', '-jar', '/opt/hodoku.jar',
  '/s', '/sc', 'bf2,bf3,xy', '/o', 'stdout',
];

// Match exactly 81 chars of digits or dots — HoDoKu uses '.' for blanks.
const PUZZLE_LINE_RE = /^([0-9.]{81}) # (.+)$/;

// Extract technique names from the path: match "word(N)" patterns, take the word part.
// e.g. "ssts bf2(6) x bf3(2) ssts" → ['bf2', 'bf3']
// 'x', 'ssts', 's' are path markers, not technique names — skip them.
const TECHNIQUE_NAME_RE = /\b([a-z][a-z0-9]*)\(\d+\)/g;

export type HodokuPuzzle = { puzzle: string; techniques: string[] };

export function parseHodokuOutput(raw: string): HodokuPuzzle[] {
  // Map from normalized puzzle string → merged techniques set
  const seen = new Map<string, Set<string>>();

  for (const lineRaw of raw.split('\n')) {
    const line = lineRaw.trim();
    const m = line.match(PUZZLE_LINE_RE);
    if (!m) continue;

    let puzzle: string;
    try {
      puzzle = normalizeBlanks(m[1]);
    } catch {
      continue; // skip malformed
    }

    const path = m[2];
    const techNames: string[] = [];
    let match: RegExpExecArray | null;
    TECHNIQUE_NAME_RE.lastIndex = 0;
    while ((match = TECHNIQUE_NAME_RE.exec(path)) !== null) {
      techNames.push(match[1]);
    }

    if (!seen.has(puzzle)) {
      seen.set(puzzle, new Set(techNames));
    } else {
      const existing = seen.get(puzzle)!;
      for (const t of techNames) existing.add(t);
    }
  }

  return Array.from(seen.entries()).map(([puzzle, techs]) => ({
    puzzle,
    techniques: Array.from(techs),
  }));
}

/**
 * Generate n hard puzzles using HoDoKu inside the trusted sudoku-jars container.
 *
 * HoDoKu's `/s` mode is an *indefinite* generator: it streams puzzles to stdout until
 * stdin closes. We drive it with three guarantees so it can never hang or leak a container:
 *   1. Early-resolve — parse stdout as it streams and stop the moment we have n unique
 *      puzzles (fast: a 5-puzzle smoke returns in seconds, not after a fixed budget).
 *   2. Budget cap — stop generating after `maxBudgetMs` even if fewer than n were collected
 *      (the pipeline over-generates across batches, so a short batch is fine, not an error).
 *   3. Hard backstop — an absolute timer that settles the promise no matter what, so a
 *      HoDoKu that never exits cleanly cannot hang us forever.
 *
 * Container-leak safety (OVERRIDE 1 / DP-2): the container is *named* and every settle path
 * runs `docker stop -t 0 <name>` (teardown). proc.kill only frees the local docker client;
 * the named `docker stop` is what actually reaps the container under Colima — never `--rm`.
 *
 * Not reusing runContainer: that helper rejects on timeout and discards stdout, which is
 * wrong for a streaming generator whose partial output is the desired result.
 */
export async function generateHard(n: number, opts?: { maxBudgetMs?: number }): Promise<HodokuPuzzle[]> {
  // Budget cap: 30s floor + 0.5s per puzzle. Early-resolve usually returns far sooner.
  // On the Colima 2-CPU VM HoDoKu emits ~14 X-Wing puzzles/s once warmed up.
  const maxBudgetMs = opts?.maxBudgetMs ?? Math.max(30_000, n * 500);
  const GRACE_MS = 15_000; // absolute backstop beyond the budget cap

  const containerName = 'hodoku-' + randomUUID();
  const args = withContainerName(HODOKU_BASE_ARGS, containerName);

  const raw = await new Promise<string>((resolve, reject) => {
    const proc = spawn('docker', args, { stdio: ['pipe', 'pipe', 'inherit'] });
    let out = '';
    let settled = false;

    function teardown() {
      try {
        spawn('docker', ['stop', '-t', '0', containerName], { stdio: 'ignore' }).unref();
      } catch { /* ignore */ }
    }

    function finish(err?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(budgetTimer);
      clearTimeout(backstopTimer);
      teardown();
      proc.kill('SIGKILL'); // free the local client; teardown() reaps the container
      if (err) reject(err);
      else resolve(out);
    }

    proc.stdout.on('data', (d: Buffer) => {
      out += d.toString();
      // Early-resolve once we have collected enough unique puzzles.
      if (!settled && parseHodokuOutput(out).length >= n) finish();
    });
    // spawn failure (e.g. docker not found) is a real error; the pipeline retries.
    proc.on('error', (e: Error) => finish(e));
    // We intentionally kill the container, so a non-zero/null close after we settle is expected.
    // A close before we settle means HoDoKu exited on its own — resolve with what we have.
    proc.on('close', () => finish());

    const budgetTimer = setTimeout(() => finish(), maxBudgetMs);
    const backstopTimer = setTimeout(() => finish(), maxBudgetMs + GRACE_MS);
  });

  return parseHodokuOutput(raw).slice(0, n);
}
