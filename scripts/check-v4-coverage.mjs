import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createCoverageMap } = require('istanbul-lib-coverage');
const reportPath = path.resolve('coverage/coverage-final.json');
const coverage = createCoverageMap(JSON.parse(fs.readFileSync(reportPath, 'utf8')));
const file = coverage.files().find((name) => name.endsWith(`${path.sep}src${path.sep}v4.ts`));
if (!file) throw new Error('V4 source coverage was not produced');

const summary = coverage.fileCoverageFor(file).toSummary();
for (const metric of ['statements', 'branches', 'functions', 'lines']) {
  const percent = summary[metric].pct;
  if (percent !== 100) throw new Error(`src/v4.ts ${metric} coverage is ${percent}%, expected 100%`);
}
console.log('src/v4.ts coverage: 100% statements, branches, functions, and lines');
