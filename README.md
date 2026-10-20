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

## V4 Card/Episode API

`MemoryV4` is the additive client for the current `/api/v3` data plane. The
legacy `Memory` class remains available for existing `/api/v2` integrations.

```ts
import { MemoryV4 } from '@memaura/sdk';

const memory = new MemoryV4({ apiKey: process.env.MEMAURA_API_KEY!, deviceNo: 'DEVICE-001' });
const ack = await memory.ingest({ turns: [
  { role: 'user', content: 'I prefer product reviews on Wednesday afternoons.' },
  { role: 'assistant', content: 'Noted.' },
] });
const job = await memory.jobs.wait(ack.jobId, { timeoutMs: 300_000 });
if (job.status === 'failed') throw new Error(JSON.stringify(job.error));

const result = await memory.retrieve({ query: 'When do I prefer product reviews?', topK: 5 });
for (const card of result.cards) console.log(card.content);
```

### Constructor and input types

```ts
type MemoryV4Options = {
  apiKey: string; endpoint?: string; deviceNo?: string; timeoutMs?: number;
};

type V4Turn = {
  content: string;
  role?: 'user' | 'assistant' | 'system';
  turnId?: string;
  timestamp?: string;
  senderName?: string;
  referList?: string[];
};

declare const options: MemoryV4Options;
const memory = new MemoryV4(options);
```

`endpoint` defaults to `https://api.omnimemory.cn/api/v3`; `deviceNo` supplies
the default `X-Device-No` header; `timeoutMs` defaults to `30_000` per request.

### `memory.ingest(input): Promise<V4Job>`

Calls `POST /memory/ingest_4`. `input.turns` is required. Optional fields are
`language` (`auto`, `zh`, or `en`), `timezone`, `deviceNo`, `waitFor` (`staged`
or `searchable`), and `waitTimeoutSeconds` in the range `(0, 300]`.

### `memory.retrieve(input): Promise<V4RetrievalResult>`

Calls `POST /memory/retrieval_4`.

| Input field | Type/default | Meaning |
| --- | --- | --- |
| `query` | `string`, required | Non-empty retrieval query. |
| `topK` | `number` | Integer from 1 to 100. |
| `vectorWeight` | `number = 0.8` | Vector/text fusion weight from 0 to 1. |
| `tagKeys` | `string[] = []` | Hard tag filters. |
| `role` | `string` | Card role filter. |
| `scopeType` | `account`, `api_key`, or `device` | Memory scope. |
| `startTime`, `endTime` | `string` | Explicit time range. |
| `entityId` | `string` | Entity filter. |
| `entityMatchMode` | `primary`, `involved`, or `source` | How the entity must match. |
| `participantRoles` | `string[]` | Participant-role filters. |
| `deviceNo` | `string` | Per-operation device override. |
| `includeQueryAnalysis` | `boolean = false` | Include query analysis. |
| `includeDetails` | `boolean = false` | Preserve the full response in `details`. |

The result is `{ cards, queryAnalysis?, details? }`. Each card contains
`cardId`, `role`, `content`, and `episodes`; each episode contains `episodeId`
and `summary`.

### V4 jobs

- `memory.jobs.get(jobId): Promise<V4Job>` reads `GET /memory/ingest_4/jobs/{jobId}`.
- `memory.getJob(jobId, timeoutMs?)` is the direct equivalent.
- `memory.jobs.wait(jobId, { timeoutMs?, intervalMs?, signal? })` defaults to five minutes and one-second polling.

`V4Job` contains `jobId`, optional `status`, optional `waitTimedOut`, and
optional `{ code?, message? }` error. Pending states are `queued`, `staged`,
`processing`, `buffered`, and `indexing`; terminal states are `succeeded` and
`failed`. `V4JobOperations` is exported for typing/advanced composition, but a
configured instance is already available as `memory.jobs`.

Exported V4 types are `MemoryV4Options`, `V4Turn`, `V4IngestInput`, `V4Job`,
`V4Episode`, `V4Card`, `V4RetrievalInput`, `V4RetrievalResult`, and
`V4WaitOptions`.

V4 writes are never retried automatically. A local wait timeout does not
cancel the job; continue polling the same `jobId`. Retrieval supports `topK`,
weighted vector/text fusion, hard tags, role and scope selection, explicit time
ranges, and entity/participant filters.

## Legacy V2 API

### Constructor and ingestion

```ts
type MemoryOptions = {
  apiKey: string; endpoint?: string; deviceNo?: string; timeoutMs?: number;
};
type AddInput = {
  turns: Array<{
    content: string; role?: MemoryRole; turnId?: string; timestamp?: string;
    senderName?: string; referList?: string[];
  }>;
  sessionId?: string; groupId?: string; groupName?: string;
  commitId?: string; deviceNo?: string;
};

declare const options: MemoryOptions;
declare const input: AddInput;
const memory = new Memory(options);
const job = await memory.add(input);
```

The V2 endpoint defaults to `https://api.omnimemory.cn/api/v2`; the request
timeout defaults to `30_000`ms. `add()` returns
`{ jobId, sessionId?, status, statusUrl }`. It is asynchronous and never retries
writes automatically; use a stable `commitId` for caller-managed idempotency.

### Retrieval

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

The shared input is `{ query, limit?, groupId?, deviceNo? }`; `limit` must be a
positive integer when supplied. Both methods return `{ strategy, query,
evidence, evidenceDetails, requestedGroupId? }`. An evidence detail contains
`eventId`, `text`, and optional `source`, `role`, `senderName`, `atomicFacts`,
`groupId`, and `timestamp`.

## Ingest Jobs

```ts
const status = await memory.jobs.get(job.jobId);

const terminal = await memory.jobs.wait(job.jobId, {
  timeoutMs: 60_000,
  intervalMs: 1_000,
});
```

`jobs.get(jobId, { deviceNo? })` returns `{ jobId?, sessionId?, status? }`.
`jobs.wait` also accepts `deviceNo` and an abort `signal`.

`jobs.wait()` polls only the status endpoint. It never submits a second ingest. It stops for successful statuses including `succeeded` and `accumulated`, as well as failed terminal statuses; inspect `status` to distinguish them. Its timeout covers the complete wait, including an in-flight status request; a `MemAuraTimeoutError` includes `lastJob` when a status was observed.

Exported V2 types are `MemoryOptions`, `MemoryRole`, `MemoryTurn`, `AddInput`,
`AddResult`, `SearchInput`, `EvidenceDetail`, `SearchResult`, `JobLookupOptions`,
`WaitForJobOptions`, and `JobStatus`.

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

`MemAuraTimeoutError.lastJob` holds the last observed job when available.
`MemAuraApiError` exposes `status`, `code`, `error`, and `details`.

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
