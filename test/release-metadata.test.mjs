import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('package and release workflow publish the scoped package publicly with provenance', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  const workflow = await readFile('.github/workflows/release.yml', 'utf8');

  assert.equal(packageJson.name, '@memaura/sdk');
  assert.equal(packageJson.publishConfig?.access, 'public');
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /npm publish --provenance --access public/);
});
