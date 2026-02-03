# @schemeless/event-store-adapter-typeorm

A SQL persistence adapter built on top of TypeORM. It stores events in a simple table, keeps JSON payloads/meta serialised as text, and exposes the `IEventStoreRepo` contract so you can plug it straight into the core runtime.

## Installation

```bash
yarn add @schemeless/event-store-adapter-typeorm typeorm
```

Install the database driver you intend to use (for example `sqlite3`, `mysql2`, or `pg`) because TypeORM relies on peer dependencies for transport.

## Usage

```ts
import { EventStoreRepo as TypeOrmRepo } from '@schemeless/event-store-adapter-typeorm';
import { makeEventStore } from '@schemeless/event-store';

const repo = new TypeOrmRepo({
  type: 'postgres',
  host: 'localhost',
  port: 5432,
  username: 'postgres',
  password: 'postgres',
  database: 'event_store',
});

const eventStore = await makeEventStore(repo)(eventFlows, successObservers);
```

On initialisation the repository creates (or reuses) a TypeORM connection, choosing a slightly different entity shape when targeting SQLite so timestamp precision is preserved. Incoming events are converted into entity instances, payload/meta fields are stringified, and every record is persisted inside a transaction to guarantee consistency.

## Streaming events

`getAllEvents` returns an async iterator that pages through events ordered by `created` and `id`. An optional `startFromId` lets you resume from a checkpoint, and every page is parsed back into plain JavaScript objects before being yielded to the replay subsystem.

## Resetting the store

`resetStore` drops and recreates the schema using TypeORM’s `synchronize(true)` call. For MySQL it also ensures the database exists and uses UTF-8 collation, which keeps integration tests and local development ergonomic.
