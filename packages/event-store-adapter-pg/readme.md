# @schemeless/event-store-adapter-pg

A dedicated, high-performance PostgreSQL adapter for `@schemeless/event-store`.

## Features

- **Zero ORM Overhead**: Directly uses `pg` (node-postgres) for maximum throughput.
- **Native JSONB Support**: Automatically stores event `payload` and `meta` as `JSONB`, enabling efficient indexing and querying.
- **Optimistic Concurrency Control (OCC)**: Leverages PostgreSQL transactions and unique indexes to ensure stream integrity.
- **Lightweight**: Minimal dependencies.

## Installation

```bash
yarn add @schemeless/event-store-adapter-pg pg
```

## Usage

```typescript
import { PgEventStoreRepo } from '@schemeless/event-store-adapter-pg';

const repo = new PgEventStoreRepo({
  host: 'localhost',
  user: 'postgres',
  password: 'your-password',
  database: 'your-db',
  // standard pg.PoolConfig options...
});

await repo.init(); // Ensures the event_store_entity table and indexes exist
```

## Configuration

The constructor accepts `PgAdapterOptions` which extends `pg.PoolConfig`:

- `tableName` (optional): Defaults to `event_store_entity`.
- All other options are passed directly to `pg.Pool`.

## Performance Note

This adapter is optimized for append-only patterns and sequential replay. By using `JSONB` for event data, it allows you to create specialized GIN indexes for complex queries without migrating the core store schema.
