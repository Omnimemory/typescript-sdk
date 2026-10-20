# MemAura TypeScript SDK

MemAura 面向 Node.js 的官方 TypeScript SDK，使用 API Key 写入和检索长期记忆。

[English](README.md) | [API 参考](docs/API.zh-CN.md) | [English API reference](docs/API.md)

## 环境要求

- Node.js 18 或更高版本
- 一个以 `qbk_` 开头的 MemAura API Key

默认接口地址为 `https://api.omnimemory.cn/api/v2`。API Key 必须仅保存在可信的服务端环境，不能放入浏览器代码或公开客户端。

## 安装

```bash
npm install @memaura/sdk
```

## 快速开始

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
    { role: 'user', content: '我更喜欢在周三下午做产品评审。' },
    { role: 'assistant', content: '我会记住这个偏好。' },
  ],
});

await memory.jobs.wait(job.jobId);

const result = await memory.searchHybrid({
  query: '用户偏好在什么时候做产品评审？',
  limit: 5,
});

for (const evidence of result.evidenceDetails) {
  console.log(evidence.text);
}
```

`add()` 只负责异步提交任务。应用可能重试写入时，请传稳定的 `commitId`：Router 会在同一设备或会话范围内对同一个键去重。SDK 不会隐式重试写入，避免产生重复记忆。

## V4 Card/Episode API

`MemoryV4` 是面向当前 `/api/v3` 数据面的新增客户端；原有 `Memory` 类继续服务已有的
`/api/v2` 接入，行为不变。

```ts
import { MemoryV4 } from '@memaura/sdk';

const memory = new MemoryV4({ apiKey: process.env.MEMAURA_API_KEY!, deviceNo: 'DEVICE-001' });
const ack = await memory.ingest({ turns: [
  { role: 'user', content: '我偏好周三下午进行产品评审。' },
  { role: 'assistant', content: '好的，已记下。' },
] });
const job = await memory.jobs.wait(ack.jobId, { timeoutMs: 300_000 });
if (job.status === 'failed') throw new Error(JSON.stringify(job.error));

const result = await memory.retrieve({ query: '我偏好什么时候进行产品评审？', topK: 5 });
for (const card of result.cards) console.log(card.content);
```

V4 写入不会自动重试。本地等待超时不会取消后台任务，请继续查询同一个 `jobId`。检索支持
`topK`、向量/文本融合权重、硬标签、角色和作用域、显式时间范围，以及实体和参与角色过滤。

## 旧版 V2 检索

`search()` 保持既有检索链路；新集成在有稳定设备号时，推荐使用 `searchHybrid()`。

```ts
const regular = await memory.search({
  query: '我们最终做了什么决定？',
  groupId: 'project-alpha',
  limit: 10,
});

const hybrid = await memory.searchHybrid({
  query: '这个设备记住了什么？',
  deviceNo: 'desktop-01',
  limit: 10,
});
```

两个检索方法都会按相关性顺序返回 `evidenceDetails`。下游构造上下文时应使用这些证据，而不要依赖上游记忆引擎的原始响应。

## 写入任务

```ts
const status = await memory.jobs.get(job.jobId);

const terminal = await memory.jobs.wait(job.jobId, {
  timeoutMs: 60_000,
  intervalMs: 1_000,
});
```

`jobs.wait()` 只轮询任务状态，不会重新提交 ingest。它会在 `succeeded`、`accumulated` 等成功终态以及失败终态停止，请检查 `status` 区分结果。它的超时覆盖完整等待过程，包括正在执行的状态请求；如果已拿到状态，`MemAuraTimeoutError` 会携带 `lastJob`。

## 错误处理

```ts
import {
  MemAuraApiError,
  MemAuraTimeoutError,
  Memory,
} from '@memaura/sdk';

try {
  await memory.search({ query: '最近的偏好' });
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

公开错误层级包括 `MemAuraError`、`MemAuraValidationError`、`MemAuraNetworkError`、`MemAuraTimeoutError` 和 `MemAuraApiError`。

## 能力边界

本 SDK 仅支持 API Key 数据面能力：

- 异步记忆写入
- 普通检索
- 混合检索
- ingest 任务状态查询与等待

它不提供账户、账单、登录或管理员 API；不接受、不生成用户 Token，也不会从包根导出 Router 的生成客户端。

## 支持版本

支持 Node.js 18、20、22、24 和 26。CI 会在每个支持的大版本上执行类型检查、生成契约检查、HTTP 行为测试、ESM/CJS 导出测试和包内容冒烟测试。

## 许可证

[MIT](LICENSE)
