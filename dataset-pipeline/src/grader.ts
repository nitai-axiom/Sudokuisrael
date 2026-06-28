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
