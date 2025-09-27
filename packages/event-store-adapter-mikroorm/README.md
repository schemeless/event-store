# @schemeless/event-store-adapter-mikroorm

A MikroORM-backed persistence adapter for [`@schemeless/event-store`](https://github.com/schemeless/event-store). It implements the shared `IEventStoreRepo` contract so you can store and replay events using any SQL database supported by MikroORM (PostgreSQL, MySQL, SQLite, MariaDB, etc.).

## Installation

Install the adapter alongside MikroORM and the SQL driver for your database:

```bash
yarn add @schemeless/event-store @schemeless/event-store-adapter-mikroorm @schemeless/event-store-types @mikro-orm/core @mikro-orm/postgresql
```

Replace `@mikro-orm/postgresql` with the driver for your database (e.g. `@mikro-orm/mysql`, `@mikro-orm/mariadb`, `@mikro-orm/sqlite`).

## ⚠️ Migration Guide: Upgrading to v2.5.0

Version 2.5.0 introduces a significant architectural improvement that requires changes in how you integrate this library. We've moved away from creating an internal MikroORM instance to prevent conflicts with your main application's ORM.

**The Core Change:** `EventStoreRepo` no longer accepts `MikroORMOptions`. Instead, it now requires an active `EntityManager` instance to be passed to its constructor.

This change makes the library framework-agnostic and solves potential context-related errors.

### **Steps to Migrate**

Here’s a typical migration example for a NestJS application:

**1. Update Your MikroORM Configuration**

You are now responsible for managing the `EventStoreEntity`. Add it to the `entities` array in your main MikroORM configuration. If you use a separate database for the event store, configure it as a second connection.

```typescript
// in your app.module.ts or mikro-orm.config.ts
import { EventStoreEntity } from '@schemeless/event-store-adapter-mikroorm';
import { YourOtherEntity } from './entities';

MikroOrmModule.forRoot({
  // ... your main database configuration
  entities: [YourOtherEntity, EventStoreEntity], // <-- Add EventStoreEntity here
}),
```

**2. Update `EventStoreRepo` Instantiation**

You must now provide the `EntityManager` to the `EventStoreRepo` constructor. In NestJS, this is easily done with a `useFactory` provider.

- **Before (v2.4.x):**

  ```typescript
  // In your event-store.module.ts
  const eventStoreRepoProvider = {
    provide: EventStoreRepo,
    useFactory: () => {
      // You were creating a full config object here
      const mikroOrmOptions = {
        driver: SqliteDriver,
        dbName: ':memory:',
        entities: [EventStoreEntity],
      };
      return new EventStoreRepo(mikroOrmOptions); // <-- Passing options
    },
  };
  ```

- **After (v2.5.0):**

  ```typescript
  // In your event-store.module.ts
  import { EntityManager } from '@mikro-orm/core';
  import { EventStoreRepo } from '@schemeless/event-store-adapter-mikroorm';

  const eventStoreRepoProvider = {
    provide: EventStoreRepo,
    useFactory: (em: EntityManager) => new EventStoreRepo(em), // <-- Pass the EntityManager
    inject: [EntityManager], // <-- Inject the default EntityManager from NestJS DI
  };
  ```

**3. Schema Management**

The library no longer automatically creates or updates the database schema. You are now in full control of your database migrations, which is the standard practice. Ensure your migration tool or `schema:update` command is aware of the `EventStoreEntity`.

<br>

---

## Usage

```ts
import { makeEventStore } from '@schemeless/event-store';
import { MikroORM } from '@mikro-orm/core';
import { EventStoreEntity, EventStoreRepo } from '@schemeless/event-store-adapter-mikroorm';

const orm = await MikroORM.init({
  type: 'postgresql',
  clientUrl: process.env.DATABASE_URL,
  entities: [EventStoreEntity],
});

const repo = new EventStoreRepo(orm.em);

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

For unit/integration tests you can create your own in-memory MikroORM instance and reuse the entity manager:

```ts
import { MikroORM } from '@mikro-orm/core';
import { SqliteDriver } from '@mikro-orm/sqlite';
import { EventStoreEntity, EventStoreRepo } from '@schemeless/event-store-adapter-mikroorm';

const orm = await MikroORM.init({
  driver: SqliteDriver,
  dbName: ':memory:',
  entities: [EventStoreEntity],
});
await orm.getSchemaGenerator().createSchema();

const repo = new EventStoreRepo(orm.em);
```

## API

`EventStoreRepo` implements the shared `IEventStoreRepo` interface:

- `constructor(entityManager)` – Accepts an active MikroORM `EntityManager`. The host application is responsible for configuring connections, entities, and schema management.
- `init()` – No-op retained for interface compatibility.
- `storeEvents(events)` – Persists the provided events inside a transaction using a forked entity manager.
- `getAllEvents(pageSize, startFromId?)` – Returns an async iterator that paginates results ordered by creation time and identifier.
- `resetStore()` – Throws an error because schema management must be handled by the host application.

See the tests in [`src/EventStore.test.ts`](./src/EventStore.test.ts) for more usage examples, including pagination and transactional guarantees.
