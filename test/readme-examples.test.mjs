import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { Memory } from '../dist/index.js';

test('English README documents the public API Key Memory workflow', async () => {
  const readme = await readFile('README.md', 'utf8');

  assert.match(readme, /npm install @memaura\/sdk/);
  assert.match(readme, /new Memory\(/);
  assert.match(readme, /memory\.add\(/);
  assert.match(readme, /memory\.searchHybrid\(/);
  assert.match(readme, /memory\.jobs\.wait\(/);
  assert.match(readme, /does not provide account, billing, login, or admin APIs/i);

  const memory = new Memory({ apiKey: 'qbk_example', endpoint: 'http://127.0.0.1:3000' });
  assert.equal(typeof memory.add, 'function');
  assert.equal(typeof memory.search, 'function');
  assert.equal(typeof memory.searchHybrid, 'function');
  assert.equal(typeof memory.jobs.wait, 'function');
});
