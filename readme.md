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

const core = makeEventStoreCore(adapter, []);
const aggregate = makeAggregateRuntime(adapter);
```

## Supported Adapters

- `@schemeless/event-store-adapter-pg`
- `@schemeless/event-store-adapter-expo-sqlite`

These adapters implement the V6 contracts in `@schemeless/event-store-types`:

- `EventStoreAdapter`
- `StreamEventStoreAdapter`

## Documentation

- [Architecture](/Users/akino/Projects/event-store/docs/architecture.md)
- [Adapters](/Users/akino/Projects/event-store/docs/adapters.md)
- [OCC and Concurrency](/Users/akino/Projects/event-store/docs/occ-and-concurrency.md)
- [Export / Import](/Users/akino/Projects/event-store/docs/export-import.md)
- [V6 Migration](/Users/akino/Projects/event-store/docs/redesign-v6-migration.md)
- [RFC: Core + Aggregate Redesign](/Users/akino/Projects/event-store/docs/rfcs/event-store-core-aggregate-redesign.md)

## Local Development

```bash
yarn install
yarn test
```
