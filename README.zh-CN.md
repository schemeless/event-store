# Schemeless Event Store

[![npm version](https://img.shields.io/npm/v/@schemeless/event-store?label=npm%20%40schemeless%2Fevent-store)](https://www.npmjs.com/package/@schemeless/event-store)
[![Publish Workflow](https://github.com/schemeless/event-store/actions/workflows/publish.yml/badge.svg)](https://github.com/schemeless/event-store/actions/workflows/publish.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

[English](./readme.md)

> **记录发生了什么，而不仅仅是现在的样子。**
> **Store what happened, not just what is.**

这是一个专为 Node.js 此打造的 Event Sourcing（事件溯源）工具箱，功能完备（batteries-included）。它采用 Monorepo 结构，提供了核心运行时 (`@schemeless/event-store`)、共享类型库 (`@schemeless/event-store-types`)，以及一系列开箱即用的持久化适配器（支持 SQL、DynamoDB 以及移动端/离线场景）。

## 项目状态 Status

✅ **生产环境就绪**。本库已在生产系统中稳定运行。核心 API 已定型，未来仅会有微小的功能迭代。

## 核心特性 Features

- **声明式定义** — 在一处集中定义事件的校验逻辑、状态变更和副作用，不再散落在各处。
- **严格有序** — 默认保证事件处理的严格顺序，也支持针对性能需求调整并发度。
- **历史回放 (Replay)** — 通过重放不可变的事件日志，随时重建或修复你的读模型（Projections）。
- **观察者模式** — 支持异步的观察者流水线（Pipeline），无论是从旁路触发通知（fire-and-forget）还是阻塞式处理。
- **内置回滚 (Revert)** — 即使是事件溯源也能“后悔”。通过补偿事件机制，支持撤销整个因果相关的事件树。
- **存储无关** — 业务逻辑与存储解耦。想从 SQL 迁移到 DynamoDB？业务代码一行都不用改。

## 核心概念：像“事件”一样思考

绝大多数应用还在用 **CRUD**（增删改查）的方式，只保存数据的**最终状态**。
而 **Event Sourcing** 选择保存**导致状态变更的一系列事实（事件）**。

### 举个通俗的例子

想象一下你的**钱包余额**。

**在传统（CRUD）系统中：**
数据库里只存一个数字。如果用户先存了 100 块，又取了 40 块，数据库里就变成 `60`。
至于这 `60` 块是怎么来的？是一笔存还是十笔存？除非你去查另一张流水表，否则这张表里**只有结果，没有过程**。

```json
// 数据库里的当前状态
{ "userId": "u-1", "balance": 60 }
```

**在 Event Sourcing 系统中：**
我们不直接存“余额”，而是存“交易流水”。所谓的“当前余额”，无非是把所有流水加减一遍算出来的结果。

```text
1. AccountOpened { date: "2023-01-01" } // 账户开通
2. FundsDeposited { amount: 100 }       // 存入 100
3. FundsWithdrawn { amount: 40 }        // 取出 40
```

这样做的好处是，你不仅知道现在有 60 块，还能回答：“上周二下午 3 点的时候余额是多少？”——只需要把事件回放到那个时间点即可。

在这个库中：
- `receive(...)`: 接收用户的操作指令。
- `apply`: 定义事件如何改变状态（比如余额 +100）。
- `replay()`: 当你需要重建数据时，系统自动把事件重跑一遍。

### 为什么要这么做？

| 特性 | 传统 CRUD | Event Sourcing |
| :--- | :--- | :--- |
| **真相来源 (Source of Truth)** | 表里当前的那行数据 | 不可篡改的事件日志 |
| **审计 (Audit Trail)** | 需要额外写代码记录日志，容易漏 | **天生自带**完整历史，强可追溯 |
| **调试 (Debugging)** | 很难复现复杂的中间状态 | **时间旅行**：随意回放到过去任意时刻 |
| **业务意图** | 意图丢失（比如状态只变成了 `closed`） | 意图明确（是 `AccountClosed` 还是 `AccountSuspended`？）|

本库就是为了让这种模式落地变得简单：它帮你处理接收事件、校验规则，并把它们安全地存到数据库里（SQL, DynamoDB 等）。

## 适合我吗？

**如果你需要：**

- 带有明确生命周期（校验 -> 变更 -> 副作用）的事件流
- 确定性的重放机制，以及完整的可追溯性（自带 `correlationId` 和 `causationId`）
- TypeScript 优先，且希望存储层可以灵活插拔

**那么它非常适合你。**

**如果你：**

- 只需要一个简单的 CRUD 增删改查
- 完全不需要回放历史、审计日志或因果追踪

**那可能不太适合，杀鸡焉用牛刀。**

## 前置要求 Prerequisites

- **Node.js** 14+ (推荐 TypeScript 4.1+)
- **数据库**: 任选其一：
  - SQL系: TypeORM, Prisma, 或 MikroORM
  - NoSQL: DynamoDB
  - 移动端/离线: WatermelonDB (React Native)
  - 测试用: Null adapter

## 安装 Install

安装核心库：

```bash
yarn add @schemeless/event-store @schemeless/event-store-types
```

选择一个适配器（以 TypeORM 为例）：

```bash
yarn add @schemeless/event-store-adapter-typeorm typeorm reflect-metadata sqlite3
```

## 快速上手 Quick start (5 分钟)

```ts
import 'reflect-metadata';
import { EventFlow, makeEventStore } from '@schemeless/event-store';
import { EventStoreRepo as TypeOrmRepo } from '@schemeless/event-store-adapter-typeorm';

// 1. 定义事件载荷
type UserRegisteredPayload = {
  userId: string;
  email: string;
};

// 2. 定义事件流
const userRegisteredFlow: EventFlow<UserRegisteredPayload> = {
  domain: 'user',
  type: 'registered',
  
  // 接收逻辑
  receive: (eventStore) => (eventInput) => eventStore.receive(userRegisteredFlow)(eventInput),
  
  // 校验逻辑
  validate: (event) => {
    if (!event.payload.email.includes('@')) {
      throw new Error('invalid email');
    }
  },
  
  // 状态变更 / 投影更新
  apply: async (event) => {
    console.log('应用事件:', event.id, event.payload.userId);
  },
};

async function main() {
  // 3. 初始化存储适配器
  const repo = new TypeOrmRepo({
    name: 'quick-start',
    type: 'sqlite',
    database: ':memory:', // 使用内存数据库演示
    dropSchema: true,
    synchronize: true,
    logging: false,
  });

  // 4. 创建 EventStore 实例
  const store = await makeEventStore(repo)([userRegisteredFlow]);

  // 5. 触发事件
  const [created] = await store.receive(userRegisteredFlow)({
    payload: { userId: 'u-1', email: 'user@example.com' },
    identifier: 'u-1',
  });

  console.log('事件创建成功 ID:', created.id);
  await store.shutdown();
}

main().catch(console.error);
```

## 适配器能力矩阵 Capability Matrix

| 适配器 | 后端 | 支持重放 | 支持乐观锁 (OCC) | 支持回滚辅助 |
| --- | --- | --- | --- | --- |
| `adapter-typeorm` | SQL (TypeORM) | ✅ | ✅ | ✅ |
| `adapter-typeorm-v3` | SQL (TypeORM v3) | ✅ | ❌ | ✅ |
| `adapter-prisma` | SQL (Prisma) | ✅ | ❌ | ✅ |
| `adapter-mikroorm` | SQL (MikroORM) | ✅ | ❌ | ✅ |
| `adapter-dynamodb` | DynamoDB | ✅ | ✅ | ✅ |
| `adapter-watermelondb` | WatermelonDB / RN SQLite | ✅ | ❌ | ✅ |
| `adapter-null` | No-op (测试桩) | ❌ | ❌ | 部分 |

> 注意：内置适配器目前主要支持全局重放。聚合根级别的重放 (`getStreamEvents`) 暂未默认实现。

## 核心工作流 Core workflows

### 1) 接收事件 (Receive)

`store.receive(flow)(input)` 是标准的入口。它负责：
1. 生成事件 ID 和时间戳
2. 执行 `validate`
3. 持久化事件
4. 执行 `apply` 和 `sideEffect`

### 2) 重放历史 (Replay)

当你的业务逻辑变了，想重新计算数据时：

```ts
await store.replay();
```

或者从某个断点继续：

```ts
await store.replay('last-processed-event-id');
```

### 3) 观察者 (Observer)

有些逻辑不需要在事件发生的当场同步执行（比如发邮件、数据分析），可以用观察者：

```ts
const observers = [
  {
    filters: [{ domain: 'user', type: 'registered' }],
    priority: 1,
    fireAndForget: true, // true = 异步执行，不阻塞主流程
    apply: async (event) => {
      // 发邮件...
    },
  },
];
```

### 4) 监控生命周期

通过 RxJS 流监控内部发生的一切：

```ts
store.output$.subscribe((eventOutput) => {
  console.log('当前阶段:', eventOutput.state, '事件ID:', eventOutput.event.id);
});
```

### 5) 撤销/回滚 (Revert)

```ts
// 检查是否可以回滚（只有 "叶子节点" 的事件才能被回滚，或者整个分支一起回滚）
const check = await store.canRevert(eventId);

if (check.canRevert) {
  // 预览会发生什么
  const preview = await store.previewRevert(eventId);
  // 执行回滚（通过生成反向的补偿事件）
  await store.revert(eventId);
}
```

### 6) 乐观并发控制 (OCC)

防止并发写入冲突。如果你绕过 `store.receive` 直接写库，需要带上 `expectedSequence`：

```ts
try {
  await repo.storeEvents([newEvent], { expectedSequence: 5 });
} catch (error) {
  if (error instanceof ConcurrencyError) {
    console.log('有人抢先一步修改了数据');
  }
}
```

## 文档索引

**指南**
- [架构设计](docs/architecture.md)
- [EventFlow 参考手册](docs/event-flow-reference.md)
- [OCC 与并发控制](docs/occ-and-concurrency.md)
- [回滚指南](docs/revert.md)
- [适配器选择](docs/adapters.md)

**适配器文档**
- [TypeORM](packages/event-store-adapter-typeorm/readme.md) | [Prisma](packages/event-store-adapter-prisma/readme.md) | [MikroORM](packages/event-store-adapter-mikroorm/README.md) | [DynamoDB](packages/event-store-adapter-dynamodb/readme.md) | [WatermelonDB](packages/event-store-adapter-watermelondb/readme.md)

## 贡献 Contributing

欢迎提交 PR！

1. **先开 Issue** 讨论你的想法
2. **本地测试**: `yarn test` 和 `yarn lerna-test`
3. **保持文档同步**: 改了 API 记得改文档
4. **统一风格**: 主要使用 Prettier
5. **使用 Yarn**: 请用 `yarn@1.22.22`

## License

MIT. See [`LICENSE`](./LICENSE).
