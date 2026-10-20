import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createCoverageMap } = require('istanbul-lib-coverage');
const reportPath = path.resolve('coverage/coverage-final.json');
const coverage = createCoverageMap(JSON.parse(fs.readFileSync(reportPath, 'utf8')));
const maintainedFiles = ['errors.ts', 'jobs.ts', 'memory.ts', 'v4.ts'];

for (const sourceName of maintainedFiles) {
  const suffix = `${path.sep}src${path.sep}${sourceName}`;
  const file = coverage.files().find((name) => name.endsWith(suffix));
  if (!file) throw new Error(`${path.join('src', sourceName)} coverage was not produced`);

  const summary = coverage.fileCoverageFor(file).toSummary();
  for (const metric of ['statements', 'branches', 'functions', 'lines']) {
    const percent = summary[metric].pct;
    if (percent !== 100) {
      throw new Error(`${path.join('src', sourceName)} ${metric} coverage is ${percent}%, expected 100%`);
    }
  }
}

console.log('Maintained runtime coverage: 100% statements, branches, functions, and lines');
