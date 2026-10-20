import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import {
  MemAuraApiError,
  MemAuraNetworkError,
  MemAuraTimeoutError,
  MemAuraValidationError,
  MemoryV4,
} from '../dist/index.js';

test('MemoryV4 uses explicit V4 ingest, job, and retrieval contracts', async (t) => {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, url: request.url, headers: request.headers, body });
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/v3/memory/ingest_4') {
      response.end(JSON.stringify({ success: true, data: { job_id: 'job-1', status: 'queued' } }));
    } else if (request.url === '/api/v3/memory/ingest_4/jobs/job-1') {
      response.end(JSON.stringify({ success: true, data: { status: 'succeeded' } }));
    } else if (request.url === '/api/v3/memory/retrieval_4') {
      response.end(JSON.stringify({ results: [{
        card_id: 'card-1', role: 'user', content: 'Prefers tea',
        episodes: [{ episode_id: 'episode-1', summary: 'Said they prefer tea' }],
      }] }));
    } else {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: { code: 'not_found', message: 'missing' } }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  const memory = new MemoryV4({
    apiKey: 'qbk_test', deviceNo: 'device-1', endpoint: `http://127.0.0.1:${address.port}/api/v3`,
  });

  const ack = await memory.ingest({ turns: [{ role: 'user', content: 'I prefer tea' }] });
  const job = await memory.jobs.get(ack.jobId);
  const result = await memory.retrieve({ query: 'What do I prefer?', topK: 5 });

  assert.equal(job.status, 'succeeded');
  assert.equal(result.cards[0].cardId, 'card-1');
  assert.equal(result.cards[0].episodes[0].episodeId, 'episode-1');
  assert.equal(requests[0].headers['x-api-key'], 'qbk_test');
  assert.equal(requests[0].headers['x-device-no'], 'device-1');
  const ingest = JSON.parse(requests[0].body);
  assert.equal(ingest.wait_for, 'staged');
  assert.equal('session_id' in ingest, false);
  const retrieval = JSON.parse(requests[2].body);
  assert.equal(retrieval.vector_weight, 0.8);
  assert.equal(retrieval.top_k, 5);
});

test('MemoryV4 validates constructor, ingest, and retrieval input', async () => {
  assert.throws(() => new MemoryV4({ apiKey: '' }), MemAuraValidationError);
  assert.throws(() => new MemoryV4({ apiKey: 'key', endpoint: 'relative' }), MemAuraValidationError);
  assert.throws(() => new MemoryV4({ apiKey: 'key', timeoutMs: 0 }), MemAuraValidationError);
  assert.throws(() => new MemoryV4({ apiKey: 'key', timeoutMs: Number.NaN }), MemAuraValidationError);
  const memory = new MemoryV4({ apiKey: 'key' });
  await assert.rejects(memory.ingest({ turns: [] }), /at least one/);
  await assert.rejects(memory.ingest({ turns: [{ content: 'x' }], waitTimeoutSeconds: 0 }), /between/);
  await assert.rejects(memory.ingest({ turns: [{ content: 'x' }], waitTimeoutSeconds: 301 }), /between/);
  await assert.rejects(memory.ingest({ turns: [{ content: ' ' }] }), /content/);
  await assert.rejects(memory.retrieve({ query: 'x', topK: 0 }), /topK/);
  await assert.rejects(memory.retrieve({ query: 'x', topK: 1.5 }), /topK/);
  await assert.rejects(memory.retrieve({ query: 'x', topK: 101 }), /topK/);
  await assert.rejects(memory.retrieve({ query: 'x', vectorWeight: -1 }), /vectorWeight/);
  await assert.rejects(memory.retrieve({ query: 'x', vectorWeight: 2 }), /vectorWeight/);
  await assert.rejects(memory.retrieve({ query: 'x', vectorWeight: Number.NaN }), /vectorWeight/);
  await assert.rejects(memory.retrieve({ query: ' ' }), /query/);
});

test('MemoryV4 maps optional ingest, retrieval, and job fields', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requests = [];
  const responses = [
    { success: true, data: { job_id: 'j', wait_timed_out: true, error: { code: 'queued', message: 'later' } } },
    { success: true, data: { status: 7, error: 'ignored' } },
    { success: true, data: { status: 'failed', error: { code: 3, message: null } } },
    { success: true, data: { results: [{ card_id: null, role: null, content: null, episodes: [{}, 'bad'] }], query_analysis: { route: 'both' } } },
    { results: [{ card_id: 'c', role: 'user', content: 'body' }], query_analysis: [] },
  ];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify(responses.shift()), { status: 200 });
  };
  const memory = new MemoryV4({ apiKey: 'key' });
  const ack = await memory.ingest({
    turns: [{ content: ' x ', role: 'user', turnId: 't', timestamp: 'now', senderName: 'n', referList: ['r'] }],
    language: 'zh', timezone: 'Asia/Shanghai', deviceNo: 'op-device', waitFor: 'searchable', waitTimeoutSeconds: 3,
  });
  assert.equal(ack.waitTimedOut, true);
  assert.equal(ack.error.code, 'queued');
  const fallback = await memory.getJob('job/a');
  assert.equal(fallback.jobId, 'job/a');
  assert.equal(fallback.status, undefined);
  const failed = await memory.getJob('j');
  assert.deepEqual(failed.error, { code: undefined, message: undefined });
  const detailed = await memory.retrieve({
    query: 'q', topK: 1, vectorWeight: 0, tagKeys: ['preference'], role: 'user', scopeType: 'device',
    startTime: '2026-01-01T00:00:00Z', endTime: '2026-02-01T00:00:00Z',
    entityId: 'entity-1', entityMatchMode: 'involved', participantRoles: ['owner'],
    deviceNo: 'op-device', includeQueryAnalysis: true, includeDetails: true,
  });
  assert.equal(detailed.cards[0].cardId, '');
  assert.equal(detailed.cards[0].episodes[0].episodeId, '');
  assert.equal(detailed.cards[0].episodes[1].summary, '');
  assert.deepEqual(detailed.queryAnalysis, { route: 'both' });
  assert.ok(detailed.details);
  const compact = await memory.retrieve({ query: 'q' });
  assert.equal(compact.cards[0].episodes.length, 0);
  assert.equal(compact.queryAnalysis, undefined);
  assert.equal(compact.details, undefined);
  assert.match(requests[1].url, /job%2Fa$/);
  assert.equal(requests[0].init.headers['X-Device-No'], 'op-device');
  const retrievalBody = JSON.parse(requests[3].init.body);
  assert.equal(retrievalBody.entity_match_mode, 'involved');
  assert.deepEqual(retrievalBody.participant_roles, ['owner']);
});

test('MemoryV4 rejects malformed successful responses', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const payloads = [
    { success: true, data: {} },
    { results: null },
    { results: ['bad'] },
  ];
  globalThis.fetch = async () => new Response(JSON.stringify(payloads.shift()), { status: 200 });
  const memory = new MemoryV4({ apiKey: 'key' });
  await assert.rejects(memory.ingest({ turns: [{ content: 'x' }] }), /missing job_id/);
  await assert.rejects(memory.retrieve({ query: 'x' }), /missing results/);
  await assert.rejects(memory.retrieve({ query: 'x' }), /Card must be an object/);
});

test('V4 jobs cover success, failure, validation, abort, unknown state, and timeout', async () => {
  const memory = new MemoryV4({ apiKey: 'key' });
  assert.throws(() => memory.jobs.get(' '), MemAuraValidationError);
  await assert.rejects(memory.jobs.wait('j', { timeoutMs: 0 }), /timeoutMs/);
  await assert.rejects(memory.jobs.wait('j', { intervalMs: 0 }), /intervalMs/);

  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(memory.jobs.wait('j', { signal: aborted.signal }), /aborted/);

  memory.getJob = async () => ({ jobId: 'j', status: 'succeeded' });
  assert.equal((await memory.jobs.wait('j')).status, 'succeeded');
  let polls = 0;
  const activeSignal = new AbortController();
  memory.getJob = async () => ({ jobId: 'j', status: polls++ === 0 ? 'queued' : 'succeeded' });
  assert.equal((await memory.jobs.wait('j', { signal: activeSignal.signal, intervalMs: 1 })).status, 'succeeded');
  memory.getJob = async () => ({ jobId: 'j' });
  await assert.rejects(memory.jobs.wait('j'), /Unexpected V4 job status: <missing>/);

  memory.getJob = async () => ({ jobId: 'j', status: 'buffered' });
  const duringSleep = new AbortController();
  setTimeout(() => duringSleep.abort(), 0);
  await assert.rejects(memory.jobs.wait('j', { signal: duringSleep.signal, intervalMs: 100 }), /aborted/);

  await assert.rejects(memory.jobs.wait('j', { timeoutMs: 1, intervalMs: 1 }), (error) => {
    assert.ok(error instanceof MemAuraTimeoutError);
    assert.equal(error.lastJob.status, 'buffered');
    return true;
  });
});

test('MemoryV4 maps HTTP, compact, JSON, envelope, network, and timeout errors', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const memory = new MemoryV4({ apiKey: 'key', timeoutMs: 5 });
  const cases = [
    new Response('not-json', { status: 200 }),
    new Response('7', { status: 200 }),
    new Response(JSON.stringify({ success: false, code: 400, message: 'bad', data: { error: 'invalid', detail: { field: 'x' } } }), { status: 200 }),
    new Response(JSON.stringify({ error: { code: 'compact', message: 'compact bad' } }), { status: 200 }),
    new Response(JSON.stringify({ error: {} }), { status: 500 }),
    new Response(JSON.stringify({ success: true, data: null }), { status: 200 }),
  ];
  globalThis.fetch = async () => cases.shift();
  await assert.rejects(memory.getJob('j'), /invalid JSON/);
  await assert.rejects(memory.getJob('j'), /invalid response/);
  await assert.rejects(memory.getJob('j'), (error) => error instanceof MemAuraApiError && error.error === 'invalid');
  await assert.rejects(memory.getJob('j'), (error) => error instanceof MemAuraApiError && error.error === 'compact');
  await assert.rejects(memory.getJob('j'), (error) => error instanceof MemAuraApiError && error.error === 'request_failed');
  await assert.rejects(memory.getJob('j'), /empty response envelope/);

  globalThis.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(memory.getJob('j'), (error) => error instanceof MemAuraNetworkError && /Unable/.test(error.message));
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  await assert.rejects(memory.getJob('j'), MemAuraTimeoutError);
});
