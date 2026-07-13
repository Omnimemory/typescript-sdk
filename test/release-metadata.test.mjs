import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('package and release workflow publish the scoped package publicly with provenance', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  const workflow = await readFile('.github/workflows/release.yml', 'utf8');

  assert.equal(packageJson.name, '@memaura/sdk');
  assert.equal(packageJson.version, '0.0.1');
  assert.equal(packageJson.publishConfig?.access, 'public');
  assert.match(workflow, /resume_publish/);
  assert.match(workflow, /contents:\s*write/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /environment:\s*\n\s*name:\s*npm/);
  assert.match(workflow, /NODE_AUTH_TOKEN:\s*\$\{\{ secrets\.NPM_TOKEN \}\}/);
  assert.match(workflow, /npm publish --provenance --access public/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /--verify-tag/);
});

test('CI verifies every supported runtime while generating contracts on Node 20', async () => {
  const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
  const verifyJob = workflow.slice(workflow.indexOf('  verify:'));

  assert.match(workflow, /generate:[\s\S]*node-version: 20/);
  assert.match(verifyJob, /needs: generate/);
  assert.match(verifyJob, /node: \[18, 20, 22, 24, 26\]/);
  assert.doesNotMatch(verifyJob, /npm run check:generated/);
});
