import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MemAuraApiError,
  MemAuraNetworkError,
  MemAuraTimeoutError,
  MemAuraValidationError,
  Memory,
} from '../dist/index.js';

const memory = () => new Memory({ apiKey: 'qbk_test', endpoint: 'https://example.test' });

test('Memory validates constructor, add, search, and job inputs', async () => {
  assert.ok(new Memory({ apiKey: 'key' }));
  assert.throws(
    () => new Memory({ apiKey: 'key', endpoint: 'relative' }),
    (error) => error instanceof MemAuraValidationError && error.message.includes('absolute URL'),
  );
  for (const timeoutMs of [0, Number.NaN]) {
    assert.throws(() => new Memory({ apiKey: 'key', timeoutMs }), MemAuraValidationError);
  }

  const client = memory();
  await assert.rejects(client.add({ turns: [{ content: ' ', role: 'user' }] }), MemAuraValidationError);
  for (const limit of [0, 1.5]) {
    await assert.rejects(client.search({ query: 'q', limit }), MemAuraValidationError);
  }
  assert.throws(() => client.jobs.get(' '), MemAuraValidationError);
  await assert.rejects(client.jobs.wait(' '), MemAuraValidationError);
  await assert.rejects(client.jobs.wait('j', { intervalMs: Number.NaN }), MemAuraValidationError);
  await assert.rejects(client.jobs.wait('j', { timeoutMs: 0 }), MemAuraValidationError);
});

test('Job operations cover abort, callback abort, timeout wrapping, and passthrough errors', async () => {
  const client = memory();
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(client.jobs.wait('j', { signal: aborted.signal }), MemAuraNetworkError);

  client.jobs.getJobStatus = async () => ({ jobId: 'j', status: 'queued' });
  const duringSleep = new AbortController();
  const waiting = client.jobs.wait('j', {
    intervalMs: 100,
    timeoutMs: 1_000,
    signal: duringSleep.signal,
  });
  setTimeout(() => duringSleep.abort(), 5);
  await assert.rejects(waiting, MemAuraNetworkError);

  client.jobs.getJobStatus = async () => {
    throw new MemAuraTimeoutError('request timeout');
  };
  await assert.rejects(
    client.jobs.wait('j', { intervalMs: 1, timeoutMs: 100 }),
    (error) => error instanceof MemAuraTimeoutError && error.message.includes('ingest job j'),
  );

  const sentinel = new Error('sentinel');
  client.jobs.getJobStatus = async () => { throw sentinel; };
  await assert.rejects(client.jobs.wait('j', { intervalMs: 1, timeoutMs: 100 }), sentinel);
});

test('Job wait covers deadline checks deterministically', async () => {
  const client = memory();
  const originalNow = Date.now;
  try {
    let values = [0, 0, 10];
    Date.now = () => values.shift() ?? 10;
    client.jobs.getJobStatus = async () => ({ jobId: 'j', status: 'queued' });
    await assert.rejects(client.jobs.wait('j', { intervalMs: 1, timeoutMs: 5 }), MemAuraTimeoutError);

    values = [0, 0, 0, 10];
    Date.now = () => values.shift() ?? 10;
    await assert.rejects(client.jobs.wait('j', { intervalMs: 1, timeoutMs: 5 }), MemAuraTimeoutError);
  } finally {
    Date.now = originalNow;
  }
});

test('Job sleep observes an abort that races the poll completion', async () => {
  const client = memory();
  client.jobs.getJobStatus = async () => ({ jobId: 'j', status: 'queued' });
  let reads = 0;
  const racingSignal = {
    get aborted() {
      reads += 1;
      return reads >= 2;
    },
    addEventListener() {},
  };
  await assert.rejects(
    client.jobs.wait('j', { intervalMs: 10, timeoutMs: 100, signal: racingSignal }),
    MemAuraNetworkError,
  );
});

test('Memory request maps every transport and envelope failure', async () => {
  const client = memory();

  await assert.rejects(
    client.request(async () => ({ error: { message: 'bad' }, response: new Response('', { status: 418 }) })),
    (error) => error instanceof MemAuraApiError && error.status === 418,
  );
  await assert.rejects(client.request(async () => ({})), MemAuraNetworkError);
  for (const envelope of [
    { success: false, message: 'no', code: 400, data: { error: 'bad', detail: { field: 'x' } } },
    { success: true, data: null },
    { success: true },
  ]) {
    await assert.rejects(client.request(async () => ({ data: envelope })), MemAuraApiError);
  }

  for (const error of [new MemAuraApiError('api'), new MemAuraNetworkError('net'), new MemAuraTimeoutError('time')]) {
    await assert.rejects(client.request(async () => { throw error; }), error);
  }
  await assert.rejects(client.request(async () => { throw new Error('offline'); }), MemAuraNetworkError);

  await assert.rejects(
    client.request(
      (signal) => new Promise((resolve) => signal.addEventListener('abort', () => resolve({ error: 'late' }), { once: true })),
      1,
    ),
    MemAuraTimeoutError,
  );
  await assert.rejects(
    client.request(
      (signal) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('late')), { once: true })),
      1,
    ),
    (error) => error instanceof MemAuraTimeoutError && error.cause?.message === 'late',
  );
});

test('Memory private mappings cover fallback fields and optional evidence fields', async () => {
  const client = memory();
  const fallback = client.toApiError('not-an-object');
  assert.equal(fallback.message, 'Router request failed with status unknown');
  assert.equal(fallback.code, undefined);
  const withStatus = client.toApiError({}, new Response('', { status: 502 }));
  assert.match(withStatus.message, /502/);

  client.request = async () => ({
    strategy: undefined,
    query: undefined,
    evidence: undefined,
    evidence_details: [{
      event_id: 'e',
      text: 'fact',
      source: 'dialog',
      role: null,
      sender_name: null,
      atomic_facts: ['atomic'],
      group_id: null,
      timestamp: null,
    }],
    requested_group_id: null,
  });
  const result = await client.search({ query: 'fallback' });
  assert.deepEqual(result, {
    strategy: '',
    query: 'fallback',
    evidence: [],
    evidenceDetails: [{
      eventId: 'e',
      text: 'fact',
      source: 'dialog',
      role: null,
      senderName: null,
      atomicFacts: ['atomic'],
      groupId: null,
      timestamp: null,
    }],
    requestedGroupId: null,
  });

  client.request = async () => ({ evidence_details: null });
  assert.deepEqual((await client.search({ query: 'none' })).evidenceDetails, []);

  client.request = async () => ({ job_id: 'j' });
  assert.deepEqual(await client.add({ turns: [{ content: 'x' }] }), {
    jobId: 'j',
    sessionId: undefined,
    status: 'queued',
    statusUrl: undefined,
  });
});
