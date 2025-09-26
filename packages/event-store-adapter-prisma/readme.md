# `@schemeless/event-store-adapter-prisma`

Official Prisma adapter for the Schemeless Event Store. This package lets you use a Prisma Client instance as the persistence layer behind `@schemeless/event-store`, embracing Prisma's schema-first workflow while reusing the existing event sourcing APIs.

## Installation

```bash
yarn add @schemeless/event-store-adapter-prisma @prisma/client
yarn add -D prisma
```

## Setup

1. Add the `EventStoreEntity` model to your `prisma/schema.prisma` file. A ready-to-copy example lives at [`schema.prisma.example`](./schema.prisma.example) and is also exported from [`src/schema.prisma.example`](./src/schema.prisma.example) for programmatic access.
2. Run Prisma migrations to apply the schema to your database:
   - During development: `npx prisma migrate dev`
   - In production: `npx prisma migrate deploy`
3. Generate the Prisma Client that this adapter expects:

```bash
npx prisma generate
```

After these steps the generated client will include the `eventStoreEntity` model used by the adapter.

## Usage

```ts
import { PrismaClient } from '@prisma/client';
import { makeEventStore } from '@schemeless/event-store';
import { EventStoreRepo } from '@schemeless/event-store-adapter-prisma';

const prisma = new PrismaClient();
const repo = new EventStoreRepo(prisma);

await repo.init(); // ensures the Prisma client is connected

const eventStore = await makeEventStore({
  repo,
});

// Store new events through the Event Store APIs as usual
```

The adapter never runs migrations or schema updates for you. Make sure your deployment pipeline runs the appropriate `prisma migrate` or `prisma db push` commands before the application starts.

## API

`EventStoreRepo` implements the shared `IEventStoreRepo` interface and exposes the following methods:

- `constructor(prismaClient)` – Accepts an existing `PrismaClient` instance so you can share connection pooling with the rest of your application.
- `init()` – Calls `prisma.$connect()` to ensure the adapter has an active database connection before persisting events.
- `storeEvents(events)` – Persists the provided events inside a Prisma interactive transaction, maintaining write ordering.
- `getAllEvents(pageSize, startFromId?)` – Returns an async iterator that replays events ordered by creation time and identifier.
- `resetStore()` – Clears all persisted events via `deleteMany`, useful for tests.
