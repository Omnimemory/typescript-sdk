# MemAura TypeScript SDK

The official Node.js SDK for writing and retrieving MemAura long-term memory with an API Key.

[中文文档](README.zh-CN.md) | [API reference](docs/API.md) | [中文 API 参考](docs/API.zh-CN.md)

## Requirements

- Node.js 18 or later
- A MemAura API Key beginning with `qbk_`

The SDK calls `https://api.omnimemory.cn/api/v2` by default. Keep API Keys on trusted server-side environments; do not embed them in browser applications or public clients.

## Install

```bash
npm install @memaura/sdk
```

## Quick Start

```ts
import { Memory } from '@memaura/sdk';

const memory = new Memory({
  apiKey: process.env.MEMAURA_API_KEY!,
  deviceNo: 'stable-device-id',
});

const job = await memory.add({
  sessionId: 'conversation-42',
  commitId: 'conversation-42:turn-1',
  turns: [
    { role: 'user', content: 'I prefer product reviews on Wednesday afternoons.' },
    { role: 'assistant', content: 'I will remember that preference.' },
  ],
});

await memory.jobs.wait(job.jobId);

const result = await memory.searchHybrid({
  query: 'When does the user prefer product reviews?',
  limit: 5,
});

for (const evidence of result.evidenceDetails) {
  console.log(evidence.text);
}
```

`add()` accepts the job asynchronously. Pass a stable `commitId` whenever your application may retry a write: Router deduplicates repeated submissions with the same key in the same device or session scope. The SDK deliberately never retries writes implicitly.

## Retrieval

Use `search()` to preserve the established retrieval path. Use `searchHybrid()` for new integrations that supply a stable device identifier.

```ts
const regular = await memory.search({
  query: 'What did we decide?',
  groupId: 'project-alpha',
  limit: 10,
});

const hybrid = await memory.searchHybrid({
  query: 'What did this device remember?',
  deviceNo: 'desktop-01',
  limit: 10,
});
```

Both methods return `evidenceDetails` in relevance order. Build downstream context from those entries rather than from an upstream memory-engine response.

## Ingest Jobs

```ts
const status = await memory.jobs.get(job.jobId);

const terminal = await memory.jobs.wait(job.jobId, {
  timeoutMs: 60_000,
  intervalMs: 1_000,
});
```

`jobs.wait()` polls only the status endpoint. It never submits a second ingest. Its timeout covers the complete wait, including an in-flight status request; a `MemAuraTimeoutError` includes `lastJob` when a status was observed.

## Errors

```ts
import {
  MemAuraApiError,
  MemAuraTimeoutError,
  Memory,
} from '@memaura/sdk';

try {
  await memory.search({ query: 'recent preferences' });
} catch (error) {
  if (error instanceof MemAuraTimeoutError) {
    console.error(error.lastJob);
  } else if (error instanceof MemAuraApiError) {
    console.error(error.status, error.code, error.error, error.message);
  } else {
    throw error;
  }
}
```

The public error hierarchy is `MemAuraError`, `MemAuraValidationError`, `MemAuraNetworkError`, `MemAuraTimeoutError`, and `MemAuraApiError`.

## Scope

This SDK is intentionally limited to API Key data-plane operations:

- asynchronous memory ingest
- regular retrieval
- hybrid retrieval
- ingest-job status and waiting

It does not provide account, billing, login, or admin APIs. It neither accepts nor creates user Tokens, and it does not expose generated Router clients from the package root.

## Support Matrix

The SDK supports Node.js 18, 20, 22, 24, and 26. CI runs type checks, generated-contract checks, HTTP behavior tests, ESM/CJS export tests, and package smoke checks on each supported major version.

## License

[MIT](LICENSE)
