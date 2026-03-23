# Schemeless Event Store

[English](/Users/akino/Projects/event-store/readme.md)

这是 V6 的拆层式 Event Sourcing 工具箱，核心由四部分组成：

- `@schemeless/event-store-core`
- `@schemeless/event-store-aggregate`
- `@schemeless/event-store-types`
- 事件存储适配器，例如 `@schemeless/event-store-adapter-pg` 与 `@schemeless/event-store-adapter-expo-sqlite`

## 包职责

- `core`

  - 追加事件
  - 读取 stream
  - 扫描全量事件
  - 重建读模型
  - 导出 / 导入事件日志

- `aggregate`

  - hydrate 聚合状态
  - 执行 `precondition`
  - `decide` 领域事件
  - 用 `evolve` 推进状态
  - 带 OCC 写入 stream

- `types`
  - 共享事件、快照与 adapter contract

## 安装

```bash
yarn add @schemeless/event-store-core @schemeless/event-store-aggregate @schemeless/event-store-types
```

选择一个事件日志适配器：

```bash
yarn add @schemeless/event-store-adapter-pg pg
```

或：

```bash
yarn add @schemeless/event-store-adapter-expo-sqlite expo-sqlite
```

## 快速开始

```ts
import { makeEventStoreCore } from '@schemeless/event-store-core';
import { makeAggregateRuntime } from '@schemeless/event-store-aggregate';
import { PgEventStoreAdapter } from '@schemeless/event-store-adapter-pg';

const adapter = new PgEventStoreAdapter({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'postgres',
  database: 'event_store',
});

await adapter.init();

const core = makeEventStoreCore(adapter, []);
const aggregate = makeAggregateRuntime(adapter);
```

## 当前支持的适配器

- `@schemeless/event-store-adapter-pg`
- `@schemeless/event-store-adapter-expo-sqlite`

它们实现的是 V6 contract：

- `EventStoreAdapter`
- `StreamEventStoreAdapter`

## 文档

- [架构说明](/Users/akino/Projects/event-store/docs/architecture.md)
- [适配器说明](/Users/akino/Projects/event-store/docs/adapters.md)
- [OCC 与并发](/Users/akino/Projects/event-store/docs/occ-and-concurrency.md)
- [导出 / 导入](/Users/akino/Projects/event-store/docs/export-import.md)
- [V6 迁移指南](/Users/akino/Projects/event-store/docs/redesign-v6-migration.md)
- [RFC：Core + Aggregate 重构](/Users/akino/Projects/event-store/docs/rfcs/event-store-core-aggregate-redesign.md)
