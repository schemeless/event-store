# @schemeless/event-store-adapter-expo-sqlite

Expo SQLite adapter for the V6 event-store contracts.

## Provides

- `append(events)`
- `getAllEvents(pageSize?, startFromId?)`
- `getStreamEvents(domain, identifier, fromSequence?)`
- `appendToStream(events, expectedVersion)`
- `getSnapshot(domain, identifier)`
- `saveSnapshot(snapshot)`
- `reset()` for tests and import replacement flows

## Semantics

- `appendToStream(events, expectedVersion)` accepts one stream per call.
- `getAllEvents()` and rebuild/export flows follow storage commit order.
- `startFromId` is a strict cursor and must reference an existing event id.

## Install

```bash
yarn add @schemeless/event-store-adapter-expo-sqlite expo-sqlite
```

## Usage

```ts
import { openDatabaseAsync } from 'expo-sqlite';
import { ExpoSqliteEventStoreAdapter } from '@schemeless/event-store-adapter-expo-sqlite';

const db = await openDatabaseAsync('events.db');
const adapter = new ExpoSqliteEventStoreAdapter(db);

await adapter.init();
```
