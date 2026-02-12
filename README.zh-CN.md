# Schemeless Event Store

[![npm version](https://img.shields.io/npm/v/@schemeless/event-store?label=npm%20%40schemeless%2Fevent-store)](https://www.npmjs.com/package/@schemeless/event-store)
[![Publish Workflow](https://github.com/schemeless/event-store/actions/workflows/publish.yml/badge.svg)](https://github.com/schemeless/event-store/actions/workflows/publish.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

[English](./readme.md)

> **Store what happened, not just what is.**

这是一个专为 Node.js 服务打造的、开箱即用的事件溯源（Event Sourcing）工具包。作为一个 Monorepo，它包含核心运行时 (`@schemeless/event-store`)、共享类型定义 (`@schemeless/event-store-types`)，以及适配 SQL、DynamoDB 和移动端/离线场景的持久化适配器。

## 项目状态 Status

✅ **生产环境就绪 (Production-ready)**。本库已在生产系统中实际应用。核心 API 已经稳定，尽管可能会有一些微小的功能迭代。

## 功能特性 Features

- **声明式事件生命周期** — 在一处统一定义验证逻辑、状态转换和副作用
- **有序事件处理** — 默认保持严格顺序处理，可针对性能调优并发度
- **基于历史回放重建** — 通过不可变的事件日志重建你的读模型（Read Models/Projections）
- **观察者流水线** — 通过异步处理器（即发即弃或阻塞模式）响应已提交的事件
- **回滚支持 (Revert)** — 基于补偿事件机制撤销整个因果相关的事件树 (`canRevert`, `previewRevert`, `revert`)
- **可插拔存储** — 想换数据库（SQL, DynamoDB, SQLite）？哪怕我不改业务逻辑也能无缝切换

## 核心概念：思考事件 Core Concepts

大多数应用只通过 CRUD（增删改查）持久化**最新的状态**。而事件溯源持久化的是**造成该状态的一系列事实（事件）**。

### 举个例子

想象一下用户的**钱包余额**。

**在传统（CRUD）系统中：**
你只存一个数字。如果用户存了 100 块，又取了 40 块，数据库里就只剩个 60。你不知道他是怎么变成 60 的，也不知道这是一笔操作还是十笔操作的结果。
```json
// 数据库里的当前状态
{ "userId": "u-1", "balance": 60 }
```

**在事件溯源（Event Sourced）系统中：**
你存的是交易流水的历史（事件）。"当前余额" 是通过回放这些事实计算出来的。
```text
1. AccountOpened { date: "2023-01-01" } (账户已开通)
2. FundsDeposited { amount: 100 }       (资金已存入)
3. FundsWithdrawn { amount: 40 }        (资金已取出)
```
现在你不仅确切地知道为什么余额是 60，还能回答像"上周二余额是多少？"这样的问题——只要回放到那一天就行。
在这个库里，这对应着：通过 `receive(...)` 接收指令，在 `apply` 中进行状态转换，并通过 `replay()` 重建历史。

### 为什么要这么做？

| 特性 | 传统 CRUD | 事件溯源 Event Sourcing |
| :--- | :--- | :--- |
| **真相来源 (Source of Truth)** | 当前的一行数据 | 不可变的事件日志 |
| **审计追踪 (Audit Trail)** | 需要手动维护额外的历史表 | 内置完整的变更历史（强可追溯性） |
| **调试能力 (Debugging)** | 很难复现复杂状态 | **时间旅行**：可以回放到过去任意时间点 |
| **业务意图 (Business Intent)** | 信息丢失（只是 status 字段变成了 closed） | 意图明确（是 `AccountClosed` 还是 `AccountSuspended`）|

本库提供了相应的基础设施来让这个模式变得简单：接收事件、校验业务规则，并持久化到存储（SQL, DynamoDB 等）。

## 适合我吗？Is this a fit?

请使用如果：

- 你想要带有明确生命周期钩子的事件溯源
- 你需要确定性的重放和可追溯性 (`correlationId`, `causationId`)
- 你想要在 TypeScript 优先的代码库中使用可插拔的持久化适配器

可能不适合如果：

- 你只需要一个简单的 CRUD 增删改查数据层
- 你不需要重放、事件历史或因果链

## 前置要求 Prerequisites

- **Node.js** 14+ (推荐 TypeScript 4.1+)
- **Database**: 根据技术栈选择适配器：
  - SQL: TypeORM, Prisma, 或 MikroORM
  - NoSQL: DynamoDB
  - 移动端/离线: WatermelonDB (React Native)
  - 测试/桩: Null adapter

## 安装 Install

安装运行时和类型定义：

```bash
yarn add @schemeless/event-store @schemeless/event-store-types
# or: npm i @schemeless/event-store @schemeless/event-store-types
```

选择一个适配器（以 TypeORM 为例）：

```bash
yarn add @schemeless/event-store-adapter-typeorm typeorm reflect-metadata sqlite3
# or: npm i @schemeless/event-store-adapter-typeorm typeorm reflect-metadata sqlite3
```

本 Monorepo 中可用的适配器：

- `@schemeless/event-store-adapter-typeorm`
- `@schemeless/event-store-adapter-typeorm-v3`
- `@schemeless/event-store-adapter-prisma`
- `@schemeless/event-store-adapter-mikroorm`
- `@schemeless/event-store-adapter-dynamodb`
- `@schemeless/event-store-adapter-watermelondb`
- `@schemeless/event-store-adapter-null`

## 快速开始 Quick start (5 分钟)

```ts
import 'reflect-metadata';
import { EventFlow, makeEventStore } from '@schemeless/event-store';
import { EventStoreRepo as TypeOrmRepo } from '@schemeless/event-store-adapter-typeorm';

type UserRegisteredPayload = {
  userId: string;
  email: string;
};

const userRegisteredFlow: EventFlow<UserRegisteredPayload> = {
  domain: 'user',
  type: 'registered',
  receive: (eventStore) => (eventInput) => eventStore.receive(userRegisteredFlow)(eventInput),
  validate: (event) => {
    if (!event.payload.email.includes('@')) {
      throw new Error('invalid email');
    }
  },
  apply: async (event) => {
    // 在这里更新投影/读模型
    console.log('applied event', event.id, event.payload.userId);
  },
};

async function main() {
  const repo = new TypeOrmRepo({
    name: 'quick-start',
    type: 'sqlite',
    database: ':memory:',
    dropSchema: true,
    synchronize: true,
    logging: false,
  });

  const store = await makeEventStore(repo)([userRegisteredFlow]);

  const [created] = await store.receive(userRegisteredFlow)({
    payload: { userId: 'u-1', email: 'user@example.com' },
    identifier: 'u-1',
  });

  console.log('created event id:', created.id);
  await store.shutdown();
}

main().catch(console.error);
```

## 适配器能力矩阵 Adapter capability matrix

| 适配器包名 | 后端 | 支持重放 (`getAllEvents`) | 支持乐观锁 OCC (`expectedSequence`) | 回滚辅助 (`getEventById` + `findByCausationId`) |
| --- | --- | --- | --- | --- |
| `@schemeless/event-store-adapter-typeorm` | SQL via TypeORM | Yes | Yes | Yes |
| `@schemeless/event-store-adapter-typeorm-v3` | SQL via TypeORM v3 flavor | Yes | No | Yes |
| `@schemeless/event-store-adapter-prisma` | SQL via Prisma | Yes | No | Yes |
| `@schemeless/event-store-adapter-mikroorm` | SQL via MikroORM | Yes | No | Yes |
| `@schemeless/event-store-adapter-dynamodb` | DynamoDB (+ 可选 S3 载荷卸载) | Yes | Yes | Yes |
| `@schemeless/event-store-adapter-watermelondb` | WatermelonDB / React Native SQLite | Yes | No | Yes |
| `@schemeless/event-store-adapter-null` | No-op stub | No | No | Partial (stubbed) |

注意：`getAggregate` 需要 `repo.getStreamEvents(...)` 支持。内置适配器目前尚未实现 `getStreamEvents`，因此聚合根重放能力默认不可用。

## 核心工作流 Core workflows

### 1) 接收事件 Receive events

`store.receive(flow)(input)` 是推荐的数据摄入路径。它会自动生成事件 ID 和时间戳、处理生命周期钩子、持久化创建的事件，并分发副作用。

### 2) 重放历史 Replay history

使用重放来重建投影（projections）：

```ts
await store.replay();
```

也可以从某个事件 ID 检查点继续重放：

```ts
await store.replay('last-processed-event-id');
```

### 3) 观察成功的事件 Observe successful events

在构建 store 时注册成功观察者：

```ts
const observers = [
  {
    filters: [{ domain: 'user', type: 'registered' }],
    priority: 1,
    fireAndForget: true,
    apply: async (event) => {
      // 异步通知、数据分析等
    },
  },
];

const store = await makeEventStore(repo)([userRegisteredFlow], observers);
```

行为说明：

- `fireAndForget: true` 不会阻塞主接收流程
- 即发即弃（fire-and-forget）观察者的失败与主事件的成功/失败是隔离的

### 4) 监控生命周期事件 Monitor lifecycle events

使用 `output$` 可观察流：

```ts
const sub = store.output$.subscribe((eventOutput) => {
  console.log(eventOutput.state, eventOutput.event.id);
});

// 后面记得取消订阅
sub.unsubscribe();
```

### 5) 回滚事件树 Revert event trees

```ts
const check = await store.canRevert(rootEventId);
if (check.canRevert) {
  const preview = await store.previewRevert(rootEventId);
  const result = await store.revert(rootEventId);
}
```

只有根事件（Root Event）可以被回滚。因果树中的每个事件都必须定义 `compensate` 逻辑。

### 6) 乐观并发控制 (OCC)

如果你直接使用 repository 层的写入操作，请传入 `expectedSequence`：

```ts
import { ConcurrencyError, type CreatedEvent } from '@schemeless/event-store-types';

const expectedSequence = await repo.getStreamSequence('account', 'user-123');

const nextEvent: CreatedEvent<{ amount: number }> = {
  id: 'evt-account-user-123-0002',
  domain: 'account',
  type: 'debited',
  identifier: 'user-123',
  payload: { amount: 100 },
  created: new Date(),
};

try {
  await repo.storeEvents([nextEvent], { expectedSequence });
} catch (error) {
  if (error instanceof ConcurrencyError) {
    console.log(`Expected ${error.expectedSequence}, but found ${error.actualSequence}`);
  }
}
```

重要：直接调用 `repo.storeEvents(...)` 需要传入 `CreatedEvent[]`（包含 `id` 和 `created`）。大多数应用应该优先使用 `store.receive(...)`，它会帮你自动创建这些字段。

## 性能与并发 Performance and concurrency

默认情况下，队列是串行执行的（并发度 `1`），以保证严格顺序。你可以调整队列并发度：

```ts
const store = await makeEventStore(repo, {
  mainQueueConcurrent: 5,
  sideEffectQueueConcurrent: 10,
  observerQueueConcurrent: 5,
})(eventFlows, observers);
```

调优指南：

- 优先增加 `sideEffectQueueConcurrent` 来处理 I/O 密集型工作
- 当观察者之间相互独立时，增加 `observerQueueConcurrent`
- 只有在你充分理解顺序权衡的情况下，才增加 `mainQueueConcurrent`

## Monorepo 结构

```txt
packages/
  event-store/                 核心运行时
  event-store-react-native/    运行时的 React Native 构建版本
  event-store-types/           共享类型定义
  event-store-adapter-*/       持久化适配器
examples/
  example-domain-packages/     示例领域和流程
  example-service/             示例服务集成
```

## 本地开发 Local development

```bash
yarn install
yarn bootstrap
yarn test
yarn prepare
```

Workspace 说明：

- 使用 Yarn classic (`yarn@1.22.22`) 和 Lerna
- `yarn bootstrap` 会运行 workspace 的 `prepublish` 构建
- `yarn lerna-test` 运行各个 package 的测试脚本

## 快速试用示例 Try examples quickly

最快、摩擦最小的路径：

```bash
yarn workspace @schemeless/example-domain test
```

完整的服务示例（需要 MySQL + Redis 和环境变量配置）：

```bash
cd examples/example-service
npm run dev:db:sync
npm run start
```

## 文档地图 Documentation map

### 指南 Guides

- [架构设计 Architecture](docs/architecture.md)
- [EventFlow 参考手册](docs/event-flow-reference.md)
- [OCC 与并发控制](docs/occ-and-concurrency.md)
- [回滚指南 Revert](docs/revert.md)
- [适配器选择指南](docs/adapters.md)
- [运行时深入解读 Runtime deep dive](packages/event-store/readme.md)

### 适配器文档 Adapter Docs

- [TypeORM](packages/event-store-adapter-typeorm/readme.md) | [Prisma](packages/event-store-adapter-prisma/readme.md) | [MikroORM](packages/event-store-adapter-mikroorm/README.md) | [DynamoDB](packages/event-store-adapter-dynamodb/readme.md) | [WatermelonDB](packages/event-store-adapter-watermelondb/readme.md)

### 迁移指南 Migration Guides

- [并发迁移指南](packages/event-store/MIGRATION.md)
- [OCC 迁移指南](packages/event-store/OCC_MIGRATION.md)
- [Schema 版本控制/Upcasting](packages/event-store/SCHEMA_VERSIONING.md)

## 贡献 Contributing

我们欢迎任何贡献！在提交 PR 之前：

1. **先查阅现有 issue** 或新建一个来讨论你的想法
2. **在本地运行测试**: `yarn test` 和 `yarn lerna-test`
3. **保持文档同步**: 当修改公开 API 时请同步更新相关文档
4. **遵循代码风格**: 使用 Prettier（如果有的话运行 `yarn format`）
5. **优先使用 Yarn**: 本项目使用 Yarn classic (`yarn@1.22.22`)

对于较大的变更，请务必先在 issue 中讨论以对齐方案。

## 许可证 License

MIT. 详见 [`LICENSE`](./LICENSE)。
