/**
 * serate ER-rating wrapper (in-container).
 *
 * ## Characterization findings (2026-06-29, Colima arm64 VM)
 *
 * ### CLI invocation
 * - Class: diuf.sudoku.test.serate (via -cp, NOT -jar, though -jar also works since Main-Class is set)
 * - Full command: java -Xrs -Xmx500m -cp /opt/serate.jar diuf.sudoku.test.serate --format=%r --input=/work/serate-in.txt
 * - serate version: 1.18.1
 *
 * ### Input format
 * - File at /work/serate-in.txt (bind-mounted from WORK_DIR)
 * - One 81-char digit string per line (0 for blanks, NOT dots)
 *
 * ### Output format (--format=%r)
 * - One floating-point ER number per line (e.g. "3.2")
 * - No prefix or suffix — the entire line is the ER value
 * - Output order == input order (confirmed on 3-puzzle batch)
 * - 0.0 = processing error; 20.0 = valid but unsolvable
 * - stderr receives usage/man/status info; stdout receives ratings
 *
 * ### Container-leak fix (OVERRIDE 1 / DP-2)
 * serate is a finite, one-shot operation (rate a batch then exit), making it a
 * perfect fit for runContainer from docker.ts. runContainer names the container
 * and force-reaps it with `docker stop -t 0` on every settle (success/error/timeout).
 * No SIGKILL loop is written here.
 *
 * ### Timeout budget
 * Hard puzzles can be slow. We scale per-puzzle: max(SOLVE_TIMEOUT_MS, n * SERATE_TIMEOUT_PER_PUZZLE_MS).
 * At 200 puzzles: ~200s budget (vs ~31s observed), giving ~6x headroom on 2-CPU Colima VM.
 */

import fs from 'node:fs';
import path from 'node:path';
import { runContainer } from './docker.ts';
import { WORK_DIR, SOLVE_TIMEOUT_MS, SERATE_TIMEOUT_PER_PUZZLE_MS } from './config.ts';

// One floating-point number per output line from serate --format=%r.
const ER_RE = /^(\d+(?:\.\d+)?)$/;

export type Rating = { puzzle: string; er: number | null };

/**
 * Parse serate --format=%r stdout into one Rating per input puzzle.
 * Output order == input order. Missing or unparseable lines → null ER.
 */
export function parseSerateOutput(raw: string, puzzles: string[]): Rating[] {
  if (puzzles.length === 0) return [];
  const lines = raw.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  return puzzles.map((puzzle, i) => {
    const line = lines[i] ?? '';
    const m = line.match(ER_RE);
    return { puzzle, er: m ? Number(m[1]) : null };
  });
}

/**
 * Rate a batch of puzzles using serate inside the sudoku-jars container.
 *
 * - Writes puzzles to WORK_DIR/serate-in.txt (bind-mounted to /work).
 * - Uses --format=%r so each output line is a bare ER float.
 * - rate([]) short-circuits and resolves [] without launching a container.
 * - Timeout: max(SOLVE_TIMEOUT_MS, puzzles.length * SERATE_TIMEOUT_PER_PUZZLE_MS) — scales per-puzzle.
 */
export async function rate(puzzles: string[]): Promise<Rating[]> {
  if (puzzles.length === 0) return [];

  fs.mkdirSync(WORK_DIR, { recursive: true });
  const inPath = path.join(WORK_DIR, 'serate-in.txt');
  // serate expects 81-char digit strings (0 for blanks, not dots)
  fs.writeFileSync(inPath, puzzles.join('\n') + '\n');

  const args = [
    'run', '--rm', '--network', 'none',
    '-v', `${WORK_DIR}:/work`,
    'sudoku-jars',
    'java', '-Xrs', '-Xmx500m', '-cp', '/opt/serate.jar',
    'diuf.sudoku.test.serate',
    '--format=%r',
    '--input=/work/serate-in.txt',
  ];

  const timeoutMs = Math.max(SOLVE_TIMEOUT_MS, puzzles.length * SERATE_TIMEOUT_PER_PUZZLE_MS);
  const raw = await runContainer(args, { timeoutMs });
  return parseSerateOutput(raw, puzzles);
}
