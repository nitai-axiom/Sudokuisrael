import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import {
  QQWING_IMAGE, QQWING_DIFFICULTY, WORK_DIR,
  SOLVE_TIMEOUT_MS, GEN_TIMEOUT_PER_PUZZLE_MS, GEN_TIMEOUT_FLOOR_MS, SOLVE_TIMEOUT_PER_PUZZLE_MS,
  type LowerTier,
} from './config.ts';
import { normalizeBlanks } from './grid.ts';

/** Wall-clock budget for generating n puzzles in one container. */
export function genTimeoutMs(n: number): number {
  return Math.max(GEN_TIMEOUT_FLOOR_MS, n * GEN_TIMEOUT_PER_PUZZLE_MS);
}

/** Wall-clock guard for solving n puzzles (early-resolve usually returns far sooner). */
export function solveTimeoutMs(n: number): number {
  return Math.max(SOLVE_TIMEOUT_MS, n * SOLVE_TIMEOUT_PER_PUZZLE_MS);
}

// Real qqwing --solve --count-solutions --one-line output format (characterised 2026-06-28):
//   Unique puzzle:       "<81-digit solution>\nThe solution to the puzzle is unique.\n"
//   Multiple solutions:  "<81-digit first solution>\nThere are N solutions to the puzzle.\n"
//   Impossible puzzle:   "Puzzle is not possible.\n"
//
// --generate --one-line: emits ONLY 81-char lines using digits and dots (no stat lines).

const PUZZLE_LINE = /^[0-9.]{81}$/;
const SOLUTION_LINE = /^[0-9]{81}$/;

// Count matchers for the three qqwing status lines:
const COUNT_UNIQUE = /^The solution to the puzzle is unique\.$/i;
const COUNT_MULTIPLE = /^There are (\d+) solutions to the puzzle\.$/i;
const COUNT_IMPOSSIBLE = /^Puzzle is not possible\.$/i;

// A "result line" is one that terminates a per-puzzle block (appears exactly once per input).
const RESULT_LINE = /^(The solution to the puzzle is unique\.|There are \d+ solutions to the puzzle\.|Puzzle is not possible\.)$/i;

export type SolveResult = { puzzle: string; solution: string | null; solutionCount: number };

/**
 * Splice `--name <name>` immediately after the first 'run' element in a docker args array.
 * If no 'run' element is found, prepends '--name <name>' to the array (fallback).
 * Exported for unit testing.
 */
export function withContainerName(args: string[], name: string): string[] {
  const i = args.indexOf('run');
  if (i === -1) return ['--name', name, ...args];
  return [...args.slice(0, i + 1), '--name', name, ...args.slice(i + 1)];
}

/**
 * Run a docker container, optionally piping stdin.
 * On macOS Docker Desktop, the container's close event can be delayed by 30-120 seconds after
 * stdout is fully received. To avoid the SOLVE_TIMEOUT_MS being triggered by this slow shutdown,
 * the optional `expectedResultLines` parameter resolves the promise as soon as that many "result
 * lines" have been seen in stdout, then kills the container — avoiding the wait for container exit.
 */
function dockerRun(args: string[], timeoutMs: number, stdin?: string, expectedResultLines?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const containerName = 'qqwing-' + randomUUID();
    const namedArgs = withContainerName(args, containerName);
    const proc = spawn('docker', namedArgs, { stdio: ['pipe', 'pipe', 'inherit'] });
    let out = '';
    let settled = false;
    let resultLineCount = 0;

    function teardown() {
      try { spawn('docker', ['stop', '-t', '0', containerName], { stdio: 'ignore' }).unref(); } catch { /* ignore */ }
    }

    function done(err?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      teardown();
      if (err) { proc.kill('SIGKILL'); reject(err); }
      else resolve(out);
    }

    const timer = setTimeout(
      () => done(new Error('qqwing docker timeout')),
      timeoutMs,
    );

    proc.stdout.on('data', (d: Buffer) => {
      out += d.toString();
      // Early-resolve once we have all expected per-puzzle result lines.
      // Recount over the full accumulated buffer so chunk-split sentences are still counted.
      if (expectedResultLines !== undefined) {
        resultLineCount = 0;
        for (const line of out.split('\n')) {
          if (RESULT_LINE.test(line.trim())) resultLineCount++;
        }
        if (resultLineCount >= expectedResultLines) {
          // Kill the container; its slow shutdown won't block us
          proc.kill('SIGKILL');
          done();
        }
      }
    });

    proc.on('error', (e: Error) => done(e));
    proc.on('close', (code: number | null) => {
      // Only code 0 is a clean natural success. null means killed by an external signal (e.g. OOM)
      // and must be treated as an error. SIGKILL (code 137 / null) after early-resolve is already
      // settled and is skipped by the settled guard.
      if (!settled) {
        if (code === 0) done();
        else done(new Error(`docker qqwing exited ${code ?? 'null (signal kill)'}`));
      }
    });

    if (stdin !== undefined) { proc.stdin.write(stdin); proc.stdin.end(); }
  });
}

/** Generate n puzzles for a lower tier via the trusted qqwing container. Hard uses generateHard() instead. */
export async function generate(tier: LowerTier, n: number): Promise<string[]> {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const diff = QQWING_DIFFICULTY[tier];
  const raw = await dockerRun([
    'run', '--rm', '--network', 'none', QQWING_IMAGE,
    'qqwing', '--generate', String(n), '--difficulty', diff, '--symmetry', 'rotate180', '--one-line',
  ], genTimeoutMs(n));
  return raw.split('\n').map((l) => l.trim()).filter((l) => PUZZLE_LINE.test(l)).map(normalizeBlanks);
}

/**
 * Parse qqwing --solve --count-solutions --one-line output.
 *
 * Real format (characterised from qqwing 1.3.4):
 *   Per puzzle, qqwing emits:
 *     - If unique:    "<81-digit solution>\nThe solution to the puzzle is unique.\n"
 *     - If multiple:  "<81-digit first solution>\nThere are N solutions to the puzzle.\n"
 *     - If impossible: "Puzzle is not possible.\n"
 *
 * We walk lines in order, attributing each result to the next input puzzle.
 * A pending solution line (all digits, len 81) is held until the status line arrives.
 * solutionCount is set to 1 for unique, N for multiple, 0 for impossible.
 * solution is the 81-digit string only when solutionCount === 1 (unique).
 */
export function parseSolveOutput(raw: string, puzzles: string[]): SolveResult[] {
  const results: SolveResult[] = puzzles.map((p) => ({ puzzle: p, solution: null, solutionCount: 0 }));
  let idx = 0;
  let pendingSolution: string | null = null;

  for (const lineRaw of raw.split('\n')) {
    const line = lineRaw.trim();
    if (!line) continue;

    if (SOLUTION_LINE.test(line)) {
      // This is an 81-digit fully-solved grid line
      pendingSolution = line;
      continue;
    }

    if (COUNT_UNIQUE.test(line)) {
      if (idx < results.length) {
        results[idx].solutionCount = 1;
        results[idx].solution = pendingSolution;
        pendingSolution = null;
        idx++;
      }
      continue;
    }

    const multipleMatch = line.match(COUNT_MULTIPLE);
    if (multipleMatch) {
      if (idx < results.length) {
        results[idx].solutionCount = Number(multipleMatch[1]);
        results[idx].solution = null; // non-unique: don't trust the one solution printed
        pendingSolution = null;
        idx++;
      }
      continue;
    }

    if (COUNT_IMPOSSIBLE.test(line)) {
      if (idx < results.length) {
        results[idx].solutionCount = 0;
        results[idx].solution = null;
        pendingSolution = null;
        idx++;
      }
      continue;
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
  ], solveTimeoutMs(puzzles.length), puzzles.join('\n') + '\n', puzzles.length);
  return parseSolveOutput(raw, puzzles);
}
