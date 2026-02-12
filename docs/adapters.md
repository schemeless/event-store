# Adapter Selection and Configuration

This guide helps choose the right `IEventStoreRepo` adapter.

## At a glance

| Adapter | Best for | OCC (`expectedSequence`) | Revert helpers | Notes |
| --- | --- | --- | --- | --- |
| `@schemeless/event-store-adapter-typeorm` | SQL services on TypeORM | Yes | Yes | Mature SQL option with OCC support |
| `@schemeless/event-store-adapter-typeorm-v3` | TypeORM v3 ecosystems | No | Yes | Alternate TypeORM flavor |
| `@schemeless/event-store-adapter-prisma` | Prisma-first services | No | Yes | Uses your existing `PrismaClient` |
| `@schemeless/event-store-adapter-mikroorm` | MikroORM-based services | No | Yes | Good for multi-database MikroORM stacks |
| `@schemeless/event-store-adapter-dynamodb` | AWS-native serverless | Yes | Yes | DynamoDB storage, optional S3 offload |
| `@schemeless/event-store-adapter-watermelondb` | React Native/offline-first | No | Yes | Local/mobile event persistence |
| `@schemeless/event-store-adapter-null` | Unit tests / dry runs | No | Partial | No real persistence, no replay stream |

Related helper package:

- `@schemeless/dynamodb-orm` for AWS Data Mapper utilities used by DynamoDB integration paths.

## Adapter choice checklist

Pick based on:

- existing ORM/database in your stack
- need for repository-level OCC
- need for offline/mobile behavior
- throughput and operational constraints

## TypeORM adapter example

```ts
import 'reflect-metadata';
import { makeEventStore } from '@schemeless/event-store';
import { EventStoreRepo } from '@schemeless/event-store-adapter-typeorm';

const repo = new EventStoreRepo({
  name: 'event-store-main',
  type: 'postgres',
  host: 'localhost',
  port: 5432,
  username: 'postgres',
  password: 'postgres',
  database: 'event_store',
  synchronize: true,
});

const store = await makeEventStore(repo)(eventFlows, observers);
```

For local quick tests, switch to sqlite in-memory:

```ts
const repo = new EventStoreRepo({
  name: 'event-store-test',
  type: 'sqlite',
  database: ':memory:',
  dropSchema: true,
  synchronize: true,
});
```

## DynamoDB adapter notes

Use DynamoDB adapter when:

- you need managed AWS scaling
- you want event data in DynamoDB with optional large payload offload to S3

The adapter exposes OCC via stream sequence checks and conditional writes.

## Writing your own adapter

Implement `IEventStoreRepo`:

- required: `init`, `getAllEvents`, `createEventEntity`, `storeEvents`, `resetStore`
- optional but recommended:
  - `getStreamSequence` (OCC support)
  - `getEventById` + `findByCausationId` (revert support)
  - `close` (graceful shutdown)

If you need `eventStore.getAggregate`, also implement `getStreamEvents`.
