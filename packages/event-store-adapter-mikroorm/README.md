# @schemeless/event-store-adapter-mikroorm

A MikroORM-backed persistence adapter for [`@schemeless/event-store`](https://github.com/schemeless/event-store). It implements the shared `IEventStoreRepo` contract so you can store and replay events using any SQL database supported by MikroORM (PostgreSQL, MySQL, SQLite, MariaDB, etc.).

## Installation

Install the adapter alongside MikroORM and the SQL driver for your database:

```bash
yarn add @schemeless/event-store @schemeless/event-store-adapter-mikroorm @schemeless/event-store-types @mikro-orm/core @mikro-orm/postgresql
```

Replace `@mikro-orm/postgresql` with the driver for your database (e.g. `@mikro-orm/mysql`, `@mikro-orm/mariadb`, `@mikro-orm/sqlite`). The adapter will register its entity automatically, so you do not have to list it in your own MikroORM configuration.

## Usage

```ts
import { makeEventStore } from '@schemeless/event-store';
import type { Options } from '@mikro-orm/core';
import { EventStoreRepo } from '@schemeless/event-store-adapter-mikroorm';

const ormOptions: Options = {
  type: 'postgresql',
  clientUrl: process.env.DATABASE_URL,
  // you can still register your own entities here if you need them
};

const repo = new EventStoreRepo(ormOptions);

const buildEventStore = makeEventStore(repo);
const eventStore = await buildEventStore([
  /* your event flows */
]);

// store events as usual
const [created] = await eventStore.receive(userRegisteredFlow)({
  payload: { id: 'user-123', email: 'user@example.com' },
});

// replay later if you need projections or observers to catch up
await eventStore.replay();
```

### Testing with SQLite

For unit/integration tests you can pass the in-memory SQLite driver:

```ts
const repo = new EventStoreRepo({
  type: 'sqlite',
  dbName: ':memory:',
});
```

The adapter will automatically create and migrate the schema on `init()`.

## API

`EventStoreRepo` implements the shared `IEventStoreRepo` interface and provides:

- `constructor(options)` – Accepts standard MikroORM options. The adapter adds the `EventStoreEntity` to whatever entities you configure so you can continue to manage your own domain models.
- `init()` – Lazily initialises MikroORM, updates the schema if required, and keeps the `MikroORM` instance cached for subsequent calls.
- `storeEvents(events)` – Persists events inside a single transaction, ensuring either all events succeed or the batch is rolled back.
- `getAllEvents(pageSize, startFromId?)` – Streams ordered events using a paginated async iterator for efficient replays.
- `resetStore()` – Drops and recreates the event store schema, ideal for keeping tests isolated.

## API

`EventStoreRepo` implements the shared `IEventStoreRepo` interface:

- `constructor(options)` – Accepts a standard MikroORM options object. The adapter automatically registers its `EventStoreEntity` alongside any entities you provide.
- `init()` – Lazily initialises MikroORM and updates the schema.
- `storeEvents(events)` – Persists the provided events inside a transaction.
- `getAllEvents(pageSize, startFromId?)` – Returns an async iterator that paginates results ordered by creation time and identifier.
- `resetStore()` – Drops and recreates the event store schema, useful for tests.

See the tests in [`src/EventStore.test.ts`](./src/EventStore.test.ts) for more usage examples, including pagination and transactional guarantees.
