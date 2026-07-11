import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Router snapshot contains only API Key data-plane operations', async () => {
  const spec = JSON.parse(await readFile('openapi/router-v2.json', 'utf8'));
  const operations = [
    ['/memory/ingest', 'post'],
    ['/memory/retrieval', 'post'],
    ['/memory/retrieval/hybrid', 'post'],
    ['/memory/ingest/jobs/{job_id}', 'get'],
  ];

  for (const [path, method] of operations) {
    assert.deepEqual(spec.paths[path][method].security, [{ ApiKeyAuth: [] }]);
  }

  assert.equal(Object.keys(spec.paths).some((path) => path.startsWith('/admin/')), false);
  assert.equal(
    Object.keys(spec.components.schemas).some((name) => name.startsWith('Admin')),
    false,
  );
});
