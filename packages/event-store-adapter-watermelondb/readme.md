# @schemeless/event-store-adapter-watermelondb

WatermelonDB-powered persistence layer for `@schemeless/event-store`. It stores every emitted event inside a
high-performance SQLite database so that React Native applications can replay and synchronise their domain history offline.

## Installation

```bash
yarn add @schemeless/event-store-adapter-watermelondb
```

This package expects WatermelonDB, React and React Native to be provided by the host application. Make sure they are already
listed in your project dependencies:

```bash
yarn add @nozbe/watermelondb react react-native
```

## Schema

The adapter exposes an `eventStoreSchema` helper that you can compose into your WatermelonDB database schema:

```ts
import { appSchema, Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { eventStoreSchema } from '@schemeless/event-store-adapter-watermelondb';

const schema = appSchema({
  version: 1,
  tables: [eventStoreSchema],
});

const adapter = new SQLiteAdapter({ schema });
const database = new Database({ adapter, modelClasses: [] });
```

If you already have an application schema, simply append `eventStoreSchema` to your existing table list. The schema declares an
`events` table with the following columns:

- `domain`: string – the bounded context that emitted the event.
- `type`: string – the event type within the domain.
- `payload`: stringified JSON payload.
- `meta`: optional stringified JSON metadata.
- `identifier`: optional aggregate identifier.
- `correlation_id`: optional correlation identifier.
- `causation_id`: optional causation identifier.
- `created`: numeric timestamp (milliseconds since epoch).

## Usage

```ts
import { appSchema, Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { makeEventStore } from '@schemeless/event-store';
import { EventStoreRepo, eventStoreSchema } from '@schemeless/event-store-adapter-watermelondb';
import { eventFlows } from './eventFlows';

const schema = appSchema({
  version: 1,
  tables: [eventStoreSchema],
});

const adapter = new SQLiteAdapter({ schema });
const database = new Database({
  adapter,
  modelClasses: [],
});

const repo = new EventStoreRepo(database);
await repo.init(); // no-op but kept for interface symmetry

const eventStore = await makeEventStore(repo)(eventFlows);

await eventStore.receive(eventFlows.userRegistered)({
  payload: { id: 'user-123', email: 'user@example.com' },
});
```

`EventStoreRepo#getAllEvents` returns an async iterator that yields events ordered by creation time. This makes it easy to
replay batches or sync them with a remote backend without loading the full dataset into memory.

## Resetting the store

Call `await repo.resetStore()` if you ever need to purge all locally stored events—for example during a user logout.
