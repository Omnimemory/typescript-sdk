import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

test('ESM package export exposes Memory', async () => {
  const sdk = await import('../dist/index.js');

  assert.equal(typeof sdk.Memory, 'function');
});

test('CJS package export exposes Memory', () => {
  const require = createRequire(import.meta.url);
  const sdk = require('../dist/index.cjs');

  assert.equal(typeof sdk.Memory, 'function');
});
