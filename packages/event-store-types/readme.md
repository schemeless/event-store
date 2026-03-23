# @schemeless/event-store-types

Shared TypeScript contracts for the V6 architecture.

Primary consumers:

- `@schemeless/event-store-core`
- `@schemeless/event-store-aggregate`
- adapter packages

This package is the canonical home for:

- persisted event types
- snapshot types
- adapter capability contracts
- concurrency and snapshot errors

## Installation

```bash
yarn add @schemeless/event-store-types
```

## Main contracts

```ts
import type {
  PersistedEvent,
  Snapshot,
  EventStoreAdapter,
  StreamEventStoreAdapter,
} from '@schemeless/event-store-types';
```

## Design note

New code should target the V6 split architecture. This package only carries shared contracts and storage-facing types.
