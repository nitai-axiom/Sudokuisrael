import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { KAGGLE_IMAGE, KAGGLE_VOLUME, KAGGLE_CSV_NAME, KAGGLE_DATASET, WORK_DIR, type Tier } from './config.ts';
import type { Candidate } from './kaggle-pipeline.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const SRC_DIR = path.join(REPO_ROOT, 'dataset-pipeline', 'src');
const CANDIDATES_PATH = path.join(WORK_DIR, 'kaggle-candidates.jsonl');
const DOWNLOAD_URL = `https://www.kaggle.com/api/v1/datasets/download/${KAGGLE_DATASET}`;

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit' });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

/**
 * Download + unzip the 536 MB CSV into the kaggle-csv Docker VOLUME (network on),
 * then structurally verify it (network none). The raw file never touches the host FS.
 *
 * Auth: KGAT_ access tokens use a Bearer header (characterized 2026-07-03 — NOT user:key).
 * The token is passed THROUGH from the host env (`-e KAGGLE_API_TOKEN` with no value), so it
 * is never baked into an image and never appears in the docker argv.
 */
export async function fetchKaggleCsv(): Promise<void> {
  if (!process.env.KAGGLE_API_TOKEN) {
    throw new Error('set KAGGLE_API_TOKEN (e.g. export KAGGLE_API_TOKEN=$(cat ~/.kaggle/access_token))');
  }
  await run('docker', ['run', '--rm', '-e', 'KAGGLE_API_TOKEN', '-v', `${KAGGLE_VOLUME}:/data`, KAGGLE_IMAGE,
    'sh', '-c',
    `set -e; ` +
    `curl -sS -L -H "Authorization: Bearer $KAGGLE_API_TOKEN" --retry 2 --max-time 900 ` +
    `-o /data/ds.zip "${DOWNLOAD_URL}"; ` +
    `unzip -o /data/ds.zip -d /data; rm -f /data/ds.zip; ` +
    `sha256sum /data/${KAGGLE_CSV_NAME} | tee /data/${KAGGLE_CSV_NAME}.sha256`]);
  // Structural gate (offline): header must be exactly the 5 expected columns.
  await run('docker', ['run', '--rm', '--network', 'none', '-v', `${KAGGLE_VOLUME}:/data:ro`, KAGGLE_IMAGE,
    'sh', '-c', `head -1 /data/${KAGGLE_CSV_NAME} | grep -qx 'id,puzzle,solution,clues,difficulty'`]);
}

/**
 * Run the pure filter CLI inside a --network none container. Reads the CSV from the volume,
 * mounts the repo src read-only, and writes the small candidate JSONL to the host WORK_DIR.
 * Only the selected candidates (81-char strings + source id) cross back to the host.
 */
export async function runFilter(oversample = 3): Promise<void> {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  await run('docker', ['run', '--rm', '--network', 'none',
    '-v', `${KAGGLE_VOLUME}:/data:ro`, '-v', `${SRC_DIR}:/src:ro`, '-v', `${WORK_DIR}:/out`,
    KAGGLE_IMAGE, 'node', '/src/kaggle-filter-cli.ts',
    '--in', `/data/${KAGGLE_CSV_NAME}`, '--out', '/out/kaggle-candidates.jsonl', '--oversample', String(oversample)]);
}

/** Load the candidate JSONL (host WORK_DIR), grouped by tier. Path is injectable for testing. */
export async function loadCandidates(candidatesPath: string = CANDIDATES_PATH): Promise<Record<Tier, Candidate[]>> {
  const byTier: Record<Tier, Candidate[]> = { very_easy: [], easy: [], medium: [], hard: [] };
  const rl = readline.createInterface({ input: fs.createReadStream(candidatesPath), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const o = JSON.parse(line) as { tier: Tier; sourceId: number; puzzle: string };
    byTier[o.tier].push({ sourceId: o.sourceId, puzzle: o.puzzle });
  }
  return byTier;
}
