# API 参考

## V4 API

### `new MemoryV4(options)`

```ts
new MemoryV4({
  apiKey: string;
  endpoint?: string;
  deviceNo?: string;
  timeoutMs?: number;
});
```

`apiKey` 必填。`endpoint` 默认为 `https://api.omnimemory.cn/api/v3`；`deviceNo` 用作默认 `X-Device-No` 请求头，`timeoutMs` 是单次请求超时，默认 `30_000` 毫秒。

### `memory.ingest(input)`

将 `turns` 提交到 `/memory/ingest_4`。可选控制项包括 `language`（`auto`、`zh` 或 `en`）、`timezone`、`deviceNo`、`waitFor`（`staged` 或 `searchable`）以及 `waitTimeoutSeconds`（最大 300）。返回 `{ jobId, status?, waitTimedOut?, error? }`。

V4 写入只发送一次，SDK 不会自动重试。遇到结果不明确的超时或网络错误时，应继续使用已保留的任务 ID，或采用应用层幂等策略，不要直接重复提交。

### `memory.retrieve(input)`

请求 `/memory/retrieval_4`，返回归一化的 `cards`，每张 Card 包含精简的 `episodes`。输入支持 `query`、`topK`、`vectorWeight`、`tagKeys`、`role`、`scopeType`、`startTime`、`endTime`、`entityId`、`entityMatchMode`、`participantRoles`、`deviceNo`、`includeQueryAnalysis` 和 `includeDetails`。

`scopeType` 可取 `account`、`api_key` 或 `device`；`entityMatchMode` 可取 `primary`、`involved` 或 `source`。按需返回 `queryAnalysis` 和原始响应 `details`。

### `memory.jobs.get(jobId)` 与 `memory.jobs.wait(jobId, options?)`

V4 任务通过 `/memory/ingest_4/jobs/{jobId}` 查询。`wait` 只轮询同一任务，直到 `succeeded` 或 `failed`；等待中的状态包括 `queued`、`staged`、`processing`、`buffered` 和 `indexing`。默认总超时五分钟、轮询间隔一秒。超时时抛出 `MemAuraTimeoutError`，并在可用时附带最后一次任务状态。

## 旧版 V2 API

### `new Memory(options)`

```ts
new Memory({
  apiKey: string;
  endpoint?: string;
  deviceNo?: string;
  timeoutMs?: number;
});
```

`apiKey` 必填。`endpoint` 默认是 `https://api.omnimemory.cn/api/v2`，且必须是绝对 URL。`deviceNo` 默认通过 `X-Device-No` 发送，也可以按单次调用覆盖。`timeoutMs` 是单次请求超时，默认 `30_000`。

### `memory.add(input)`

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

返回 `{ jobId, sessionId?, status, statusUrl }`。`turns` 必须是非空数组。方法调用 `/memory/ingest`，Router 接收任务后即返回。

### `memory.search(input)` 与 `memory.searchHybrid(input)`

```ts
await memory.search({
  query: string;
  limit?: number;
  groupId?: string;
  deviceNo?: string;
});
```

两个方法都返回：

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

`search()` 调用 `/memory/retrieval`；`searchHybrid()` 调用 `/memory/retrieval/hybrid`。`query` 不能为空；若传入 `limit`，必须是正整数。

### `memory.jobs.get(jobId, options?)`

从 `/memory/ingest/jobs/{jobId}` 读取一个 ingest 任务，返回 `{ jobId?, sessionId?, status? }`。

### `memory.jobs.wait(jobId, options?)`

```ts
await memory.jobs.wait(jobId, {
  deviceNo?: string;
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
});
```

默认总超时为 `60_000`ms，轮询间隔为 `1_000`ms。任务状态为 `accumulated`、`completed`、`done`、`succeeded`、`success`、`failed`、`error`、`cancelled` 或 `canceled` 时会返回；请检查 `status` 区分成功和失败终态。超时时抛出 `MemAuraTimeoutError`，如果已查询到状态，其中会带上最后的任务状态。

## 错误

| 错误 | 含义 |
| --- | --- |
| `MemAuraValidationError` | 本地参数无效，未发送请求。 |
| `MemAuraNetworkError` | 无法连接 Router，或等待被中断。 |
| `MemAuraTimeoutError` | 请求或完整任务等待超过 deadline。 |
| `MemAuraApiError` | Router 返回 HTTP 或信封错误，包含 `status`、`code`、`error` 和 `details`。 |
