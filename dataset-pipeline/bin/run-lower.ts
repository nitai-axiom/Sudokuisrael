import { assembleLower } from '../src/assemble.ts';

const argv = process.argv.slice(2);
const ci = argv.indexOf('--count');
let target: number | undefined;
if (ci >= 0) {
  const n = Number(argv[ci + 1]);
  if (!Number.isInteger(n) || n <= 0) {
    console.error('error: --count requires a positive integer, e.g. --count 20');
    process.exit(1);
  }
  target = n;
}

assembleLower({ target }).then(
  (rows) => { process.stderr.write(`done: ${rows.length} records\n`); },
  (err) => { console.error(err); process.exit(1); },
);
