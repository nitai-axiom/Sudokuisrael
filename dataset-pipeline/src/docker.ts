import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

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

export type RunContainerOpts = {
  timeoutMs: number;        // wall-clock guard; on expiry: teardown + reject('docker timeout')
  stdin?: string;           // if provided, written to the container's stdin then closed
  containerName?: string;   // override the generated name (testability); default `sandbox-<uuid>`
};

/**
 * Run `docker <args>` capturing stdout. `args` is everything after `docker`
 * (e.g. ['run','--rm','--network','none','sudoku-jars','java',...]).
 * - names the container so it can be force-reaped;
 * - on EVERY settle (success, error, timeout) runs `docker stop -t 0 <name>` (detached, unref'd);
 * - resolves stdout on clean exit (code 0); rejects on non-zero/null exit or timeout;
 * - inherits stderr to the parent (stdio ['pipe', 'pipe', 'inherit']).
 */
export function runContainer(args: string[], opts: RunContainerOpts): Promise<string> {
  return new Promise((resolve, reject) => {
    const containerName = opts.containerName ?? ('sandbox-' + randomUUID());
    const namedArgs = withContainerName(args, containerName);
    const proc = spawn('docker', namedArgs, { stdio: ['pipe', 'pipe', 'inherit'] });
    let out = '';
    let settled = false;

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
      () => done(new Error('docker timeout')),
      opts.timeoutMs,
    );

    proc.stdout.on('data', (d: Buffer) => {
      out += d.toString();
    });

    proc.on('error', (e: Error) => done(e));
    proc.on('close', (code: number | null) => {
      // Only code 0 is a clean natural success. null means killed by an external signal (e.g. OOM)
      // and must be treated as an error. SIGKILL (code 137 / null) after early-resolve is already
      // settled and is skipped by the settled guard.
      if (!settled) {
        if (code === 0) done();
        else done(new Error(`docker exited ${code ?? 'null (signal kill)'}`));
      }
    });

    if (opts.stdin !== undefined) { proc.stdin.write(opts.stdin); proc.stdin.end(); }
  });
}
