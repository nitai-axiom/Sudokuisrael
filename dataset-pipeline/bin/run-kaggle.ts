import fs from 'node:fs';
import { CALIBRATION_N, HARD_ER_MIN_FAIR, HARD_ER_MAX_FAIR, KAGGLE_TARGETS, TIERS, type LowerTier } from '../src/config.ts';
import { loadCandidates } from '../src/kaggle-source.ts';
import { solveAndCount } from '../src/qqwing.ts';
import { gradeBatch } from '../src/grader.ts';
import { rate } from '../src/serate.ts';
import { acceptKaggleLower, acceptKaggleHard } from '../src/kaggle-pipeline.ts';
import { checkpointPath, cursorPath } from '../src/checkpoint.ts';
import { assembleKaggle } from '../src/assemble.ts';
import type { PuzzleRecord } from '../src/record.ts';

const argv = process.argv.slice(2);
const calibrate = argv.includes('--calibrate');
const ci = argv.indexOf('--count');
const target = ci >= 0 ? Number(argv[ci + 1]) : undefined;

// --fresh: clear the namespaced Kaggle checkpoints before building. REQUIRED after any change to
// the pre-filter bands / ER band / oversample, since a stale cursor+checkpoint would otherwise
// resume against a different candidate list and silently bias the result.
if (argv.includes('--fresh')) {
  for (const t of TIERS) {
    fs.rmSync(checkpointPath(`kaggle-${t}`), { force: true });
    fs.rmSync(cursorPath(`kaggle-${t}`), { force: true });
  }
  process.stderr.write('cleared kaggle checkpoints (--fresh)\n');
}

/**
 * Calibration gate: run up to CALIBRATION_N candidates/tier through the REAL accept gates
 * (qqwing uniqueness + Rust grader + serate for hard) and report the acceptance rate, grade
 * spread, serate ER distribution for hard, and sample accepted puzzles. Writes nothing.
 * The owner reviews this before the full run; bands get tuned here if needed.
 */
async function calibrateRun() {
  const cands = await loadCandidates();
  process.stderr.write(`\n=== CALIBRATION — up to ${CALIBRATION_N} candidates/tier through the real graders ===\n\n`);
  for (const tier of TIERS) {
    const sample = cands[tier].slice(0, CALIBRATION_N);
    const puzzles = sample.map((c) => c.puzzle);
    if (puzzles.length === 0) { process.stderr.write(`${tier.toUpperCase()}: NO candidates\n\n`); continue; }

    const solves = await solveAndCount(puzzles);
    const grades = await gradeBatch(puzzles);
    const ratings = tier === 'hard' ? await rate(puzzles) : puzzles.map((p) => ({ puzzle: p, er: null as number | null }));

    const unique = solves.filter((s) => s.solutionCount === 1).length;
    const gradeHist: Record<string, number> = {};
    for (const g of grades) { const k = String(g.difficulty); gradeHist[k] = (gradeHist[k] ?? 0) + 1; }

    const accepted: PuzzleRecord[] = [];
    for (let i = 0; i < puzzles.length; i++) {
      const r = tier === 'hard'
        ? acceptKaggleHard({ solve: solves[i], er: ratings[i]?.er ?? null, grade: grades[i], sourceId: sample[i].sourceId, now: 'cal' })
        : acceptKaggleLower({ tier: tier as LowerTier, solve: solves[i], grade: grades[i], sourceId: sample[i].sourceId, now: 'cal' });
      if (r) accepted.push(r);
    }
    const rate_ = accepted.length / puzzles.length;
    const needX = rate_ > 0 ? (1 / rate_).toFixed(1) : '∞';

    let erLine = '';
    if (tier === 'hard') {
      const ers = ratings.map((r) => r.er).filter((e): e is number => e !== null).sort((a, b) => a - b);
      const inBand = ers.filter((e) => e >= HARD_ER_MIN_FAIR && e <= HARD_ER_MAX_FAIR).length;
      const below = ers.filter((e) => e < HARD_ER_MIN_FAIR).length;
      const above = ers.filter((e) => e > HARD_ER_MAX_FAIR).length;
      const med = ers[Math.floor(ers.length / 2)];
      erLine = `\n    serate ER: median ${med?.toFixed(2)} | fair [${HARD_ER_MIN_FAIR}-${HARD_ER_MAX_FAIR}]: ${inBand} | too easy(<${HARD_ER_MIN_FAIR}): ${below} | too obscure(>${HARD_ER_MAX_FAIR}): ${above}`;
    }

    process.stderr.write(
      `${tier.toUpperCase()}: sampled ${puzzles.length} | unique ${unique} | rust-grades ${JSON.stringify(gradeHist)}\n` +
      `    ACCEPTED ${accepted.length}/${puzzles.length} (${(rate_ * 100).toFixed(1)}%) → need ~${needX}x oversample to reach ${KAGGLE_TARGETS[tier]}${erLine}\n` +
      `    sample accepted:\n`,
    );
    for (const r of accepted.slice(0, 6)) {
      process.stderr.write(`      [${r.givens} givens]${tier === 'hard' ? ` ER=${r.er_rating}` : ''} ${r.puzzle}\n`);
    }
    process.stderr.write('\n');
  }
  process.stderr.write('=== Review ACCEPTED rate + sample puzzles. Approve, or tune bands (config.ts) and re-run. ===\n');
}

(calibrate
  ? calibrateRun()
  : assembleKaggle({ target }).then((r) => { process.stderr.write(`done: ${r.length} records\n`); })
).catch((e) => { console.error(e); process.exit(1); });
