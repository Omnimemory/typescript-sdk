import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import {
  MemAuraApiError,
  MemAuraTimeoutError,
  MemAuraValidationError,
  Memory,
} from '../dist/index.js';

const startServer = async (handler) => {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }

    const text = Buffer.concat(chunks).toString('utf8');
    const captured = {
      body: text ? JSON.parse(text) : undefined,
      headers: request.headers,
      method: request.method,
      url: request.url,
    };
    requests.push(captured);

    const result = await handler(captured, requests);
    response.writeHead(result.status ?? 200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(result.body));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test server did not expose a TCP address');
  }

  return {
    requests,
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
};

const ok = (data, status = 200) => ({
  status,
  body: { success: true, message: 'ok', code: status, data },
});

test('Memory maps ingest input and returns an async job acknowledgement', async (t) => {
  const server = await startServer(() =>
    ok({ job_id: 'job-1', session_id: 'session-a', status: 'queued', status_url: '/memory/ingest/jobs/job-1' }, 202),
  );
  t.after(server.close);

  const memory = new Memory({ apiKey: 'qbk_test', endpoint: server.url, deviceNo: 'device-a' });
  const job = await memory.add({
    turns: [{ content: 'remember this', role: 'user', senderName: 'Ada', turnId: 'turn-1' }],
    sessionId: 'session-a',
    groupId: 'group-a',
    groupName: 'Group A',
    commitId: 'commit-a',
  });

  assert.deepEqual(job, {
    jobId: 'job-1',
    sessionId: 'session-a',
    status: 'queued',
    statusUrl: '/memory/ingest/jobs/job-1',
  });
  assert.equal(server.requests[0].method, 'POST');
  assert.equal(server.requests[0].url, '/memory/ingest');
  assert.equal(server.requests[0].headers['x-api-key'], 'qbk_test');
  assert.equal(server.requests[0].headers['x-device-no'], 'device-a');
  assert.deepEqual(server.requests[0].body, {
    turns: [{ content: 'remember this', role: 'user', sender_name: 'Ada', turn_id: 'turn-1' }],
    session_id: 'session-a',
    group_id: 'group-a',
    group_name: 'Group A',
    commit_id: 'commit-a',
  });
});

test('Memory maps regular and hybrid searches to their distinct data-plane operations', async (t) => {
  const server = await startServer((request) =>
    ok({
      strategy: request.url.includes('/hybrid') ? 'hybrid' : 'regular',
      query: request.body.query,
      evidence: ['event-1'],
      evidence_details: [{ event_id: 'event-1', text: 'remembered fact', group_id: 'group-a' }],
      requested_group_id: request.body.group_id,
    }),
  );
  t.after(server.close);

  const memory = new Memory({ apiKey: 'qbk_test', endpoint: server.url, deviceNo: 'device-a' });
  const regular = await memory.search({ query: 'what happened?', limit: 3, groupId: 'group-a' });
  const hybrid = await memory.searchHybrid({ query: 'what happened?', limit: 5, groupId: 'group-a', deviceNo: 'device-b' });

  assert.equal(regular.strategy, 'regular');
  assert.equal(hybrid.strategy, 'hybrid');
  assert.deepEqual(regular.evidenceDetails, [{ eventId: 'event-1', text: 'remembered fact', groupId: 'group-a' }]);
  assert.deepEqual(server.requests.map((request) => request.url), [
    '/memory/retrieval',
    '/memory/retrieval/hybrid',
  ]);
  assert.deepEqual(server.requests.map((request) => request.body), [
    { query: 'what happened?', top_k: 3, group_id: 'group-a' },
    { query: 'what happened?', top_k: 5, group_id: 'group-a' },
  ]);
  assert.equal(server.requests[0].headers['x-device-no'], 'device-a');
  assert.equal(server.requests[1].headers['x-device-no'], 'device-b');
});

test('Memory jobs get and wait without resubmitting the ingest request', async (t) => {
  let polls = 0;
  const server = await startServer(() => {
    polls += 1;
    return ok({ job_id: 'job/1', session_id: 'session-a', status: polls < 3 ? 'queued' : 'succeeded' });
  });
  t.after(server.close);

  const memory = new Memory({ apiKey: 'qbk_test', endpoint: server.url, deviceNo: 'device-a' });
  const first = await memory.jobs.get('job/1');
  const completed = await memory.jobs.wait('job/1', { intervalMs: 1, timeoutMs: 100 });

  assert.equal(first.status, 'queued');
  assert.equal(completed.status, 'succeeded');
  assert.equal(polls, 3);
  assert.deepEqual(server.requests.map((request) => request.url), [
    '/memory/ingest/jobs/job%2F1',
    '/memory/ingest/jobs/job%2F1',
    '/memory/ingest/jobs/job%2F1',
  ]);
  assert.equal(server.requests.every((request) => request.headers['x-device-no'] === 'device-a'), true);
});

test('Memory jobs wait exposes the last observed status on timeout', async (t) => {
  const server = await startServer(() => ok({ job_id: 'job-1', status: 'queued' }));
  t.after(server.close);

  const memory = new Memory({ apiKey: 'qbk_test', endpoint: server.url });
  await assert.rejects(
    memory.jobs.wait('job-1', { intervalMs: 1, timeoutMs: 20 }),
    (error) => error instanceof MemAuraTimeoutError && error.lastJob?.status === 'queued',
  );
});

test('Memory jobs wait treats accumulated as a normal terminal status', async (t) => {
  const server = await startServer(() => ok({ job_id: 'job-1', status: 'accumulated' }));
  t.after(server.close);

  const memory = new Memory({ apiKey: 'qbk_test', endpoint: server.url });
  const status = await memory.jobs.wait('job-1', { intervalMs: 1, timeoutMs: 100 });

  assert.equal(status.status, 'accumulated');
  assert.equal(server.requests.length, 1);
});

test('Memory jobs wait applies its total timeout to an in-flight status request', async (t) => {
  const server = await startServer(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    return ok({ job_id: 'job-1', status: 'queued' });
  });
  t.after(server.close);

  const memory = new Memory({ apiKey: 'qbk_test', endpoint: server.url, timeoutMs: 1_000 });
  const startedAt = Date.now();
  await assert.rejects(
    memory.jobs.wait('job-1', { intervalMs: 1, timeoutMs: 15 }),
    MemAuraTimeoutError,
  );
  assert.ok(Date.now() - startedAt < 50);
});

test('Memory maps error envelopes and rejects invalid input before HTTP', async (t) => {
  const server = await startServer(() => ({
    status: 401,
    body: { success: false, message: 'Invalid API key', code: 401, data: { error: 'invalid_api_key' } },
  }));
  t.after(server.close);

  assert.throws(() => new Memory({ apiKey: '   ' }), MemAuraValidationError);

  const memory = new Memory({ apiKey: 'qbk_test', endpoint: server.url });
  await assert.rejects(
    memory.search({ query: 'test' }),
    (error) =>
      error instanceof MemAuraApiError &&
      error.status === 401 &&
      error.code === 401 &&
      error.error === 'invalid_api_key' &&
      error.message === 'Invalid API key',
  );
  await assert.rejects(memory.search({ query: '  ' }), MemAuraValidationError);
  await assert.rejects(memory.add({ turns: [] }), MemAuraValidationError);
  await assert.rejects(memory.jobs.wait('job-1', { intervalMs: 0 }), MemAuraValidationError);
  assert.equal(server.requests.length, 1);
});
