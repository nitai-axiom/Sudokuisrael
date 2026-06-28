import { assembleLower } from '../src/assemble.ts';

const argv = process.argv.slice(2);
const ci = argv.indexOf('--count');
const target = ci >= 0 ? Number(argv[ci + 1]) : undefined;

assembleLower({ target }).then(
  (rows) => { process.stderr.write(`done: ${rows.length} records\n`); },
  (err) => { console.error(err); process.exit(1); },
);
