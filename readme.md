# Schemeless Event Store

[简体中文](/Users/akino/Projects/event-store/README.zh-CN.md)

Schemeless Event Store is a V6 split architecture for event-sourced systems:

- `@schemeless/event-store-core`
- `@schemeless/event-store-aggregate`
- `@schemeless/event-store-types`
- storage adapters such as `@schemeless/event-store-adapter-pg` and `@schemeless/event-store-adapter-expo-sqlite`

## Package Roles

- `core`

  - append events
  - read streams
  - scan the log
  - rebuild read models
  - export and import event logs

- `aggregate`

  - hydrate aggregate state
  - run `precondition`
  - `decide` domain events
  - `evolve` state
  - write with optimistic concurrency

- `types`
  - shared event, snapshot, and adapter contracts

## Runtime Notes

- `core.stream()` requires a stream-capable adapter and fails fast otherwise.
- `rebuildReadModels()` runs observers to completion before it resolves.
- scan/export order follows storage commit order, not caller-provided `created` timestamps.

## Install

```bash
yarn add @schemeless/event-store-core @schemeless/event-store-aggregate @schemeless/event-store-types
```

Pick an adapter for the event log:

```bash
yarn add @schemeless/event-store-adapter-pg pg
```

or

```bash
yarn add @schemeless/event-store-adapter-expo-sqlite expo-sqlite
```

## Quick Start

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

const core = makeEventStoreCore(adapter);
const aggregate = makeAggregateRuntime(adapter);
```

## Supported Adapters

- `@schemeless/event-store-adapter-pg`
- `@schemeless/event-store-adapter-expo-sqlite`

These adapters implement the V6 contracts in `@schemeless/event-store-types`:

- `EventStoreAdapter`
- `StreamEventStoreAdapter`

## Documentation

- [Architecture](docs/architecture.md)
- [Adapters](docs/adapters.md)
- [OCC and Concurrency](docs/occ-and-concurrency.md)
- [Export / Import](docs/export-import.md)
- [V6 Migration](docs/redesign-v6-migration.md)
- [RFC: Core + Aggregate Redesign](docs/rfcs/event-store-core-aggregate-redesign.md)

## Local Development

```bash
yarn install
yarn test
```
