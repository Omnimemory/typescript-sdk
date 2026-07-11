# API Reference

## `new Memory(options)`

```ts
new Memory({
  apiKey: string;
  endpoint?: string;
  deviceNo?: string;
  timeoutMs?: number;
});
```

`apiKey` is required. `endpoint` defaults to `https://api.omnimemory.cn/api/v2`; it must be an absolute URL. `deviceNo` is sent as `X-Device-No` by default and can be overridden per operation. `timeoutMs` is the per-request timeout and defaults to `30_000`.

## `memory.add(input)`

```ts
await memory.add({
  turns: Array<{
    content: string;
    role?: 'user' | 'assistant' | 'system';
    turnId?: string;
    timestamp?: string;
    senderName?: string;
    referList?: string[];
  }>;
  sessionId?: string;
  groupId?: string;
  groupName?: string;
  commitId?: string;
  deviceNo?: string;
});
```

Returns `{ jobId, sessionId?, status, statusUrl }`. A non-empty `turns` array is required. The method posts `/memory/ingest` and returns when Router accepts the job.

## `memory.search(input)` and `memory.searchHybrid(input)`

```ts
await memory.search({
  query: string;
  limit?: number;
  groupId?: string;
  deviceNo?: string;
});
```

Both methods return:

```ts
{
  strategy: string;
  query: string;
  evidence: string[];
  evidenceDetails: Array<{
    eventId: string;
    text: string;
    source?: string;
    role?: string | null;
    senderName?: string | null;
    atomicFacts?: string[];
    groupId?: string | null;
    timestamp?: string | null;
  }>;
  requestedGroupId?: string | null;
}
```

`search()` calls `/memory/retrieval`; `searchHybrid()` calls `/memory/retrieval/hybrid`. `query` must be non-empty and `limit`, when set, must be a positive integer.

## `memory.jobs.get(jobId, options?)`

Reads one ingest job from `/memory/ingest/jobs/{jobId}`. It returns `{ jobId?, sessionId?, status? }`.

## `memory.jobs.wait(jobId, options?)`

```ts
await memory.jobs.wait(jobId, {
  deviceNo?: string;
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
});
```

Defaults are `60_000`ms for the total timeout and `1_000`ms for the polling interval. The method resolves at `accumulated`, `completed`, `done`, `succeeded`, `success`, `failed`, `error`, `cancelled`, or `canceled`; inspect `status` to distinguish a successful terminal state from a failed one. A timeout throws `MemAuraTimeoutError` and includes the last observed job status when available.

## Errors

| Error | Meaning |
| --- | --- |
| `MemAuraValidationError` | Local input is invalid; no request was sent. |
| `MemAuraNetworkError` | Router could not be reached or a wait was aborted. |
| `MemAuraTimeoutError` | A request or complete job wait exceeded its deadline. |
| `MemAuraApiError` | Router returned an HTTP or envelope error. It exposes `status`, `code`, `error`, and `details`. |
