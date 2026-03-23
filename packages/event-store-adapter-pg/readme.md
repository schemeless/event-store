# @schemeless/event-store-adapter-pg

PostgreSQL adapter for the V6 event-store contracts.

## Provides

- `append(events)`
- `getAllEvents(pageSize?, startFromId?)`
- `getStreamEvents(domain, identifier, fromSequence?)`
- `appendToStream(events, expectedVersion)`
- `getSnapshot(domain, identifier)`
- `saveSnapshot(snapshot)`
- `reset()` for tests and import replacement flows

## Install

```bash
yarn add @schemeless/event-store-adapter-pg pg
```

## Usage

```ts
import { PgEventStoreAdapter } from '@schemeless/event-store-adapter-pg';

const adapter = new PgEventStoreAdapter({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'postgres',
  database: 'event_store',
});

await adapter.init();
```
