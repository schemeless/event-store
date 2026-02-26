# Export and Import Events

The `@schemeless/event-store` core package ships four built-in utilities for snapshotting and restoring the full event log. They are **adapter-agnostic** — they work with every `IEventStoreRepo` implementation and every environment (Node.js, React Native, browser).

## When to use this

| Scenario                                               | Pattern                                                   |
| ------------------------------------------------------ | --------------------------------------------------------- |
| **User backup** — let users download their data        | Export → `JSON.stringify` → write file                    |
| **Developer analysis** — dump events for debugging     | Export → share file                                       |
| **Adapter migration** — move between storage backends  | Export from old → Import into new                         |
| **Device restore** — let users restore on a new device | Read file → `parseSnapshot` → Import with `replace: true` |

## API Reference

### `exportEventsToArray(repo, opts?)`

Pages through `repo.getAllEvents()` and collects every event into a flat array.

```ts
import { exportEventsToArray } from '@schemeless/event-store';

const events = await exportEventsToArray(store.eventStoreRepo, {
  pageSize: 200, // optional, default 200
  onProgress: (n) => {}, // optional progress callback
});
// → IEventStoreEntity[]
```

### `createSnapshot(events)`

Wraps the events array in a metadata envelope suitable for `JSON.stringify`.

```ts
import { createSnapshot } from '@schemeless/event-store';

const snapshot = createSnapshot(events);
// → { exportedAt: string, count: number, events: IEventStoreEntity[] }

const json = JSON.stringify(snapshot);
```

### `parseSnapshot(json)`

Parses a JSON string produced by `JSON.stringify(createSnapshot(...))`. Automatically restores `Date` objects on every `event.created` field.

```ts
import { parseSnapshot } from '@schemeless/event-store';

const snapshot = parseSnapshot(json);
// → { exportedAt: string, count: number, events: IEventStoreEntity[] }
// snapshot.events[*].created is a proper Date instance
```

### `importEventsFromArray(repo, events, opts?)`

Writes events back in batches and coerces date strings to `Date` objects regardless of input.

```ts
import { importEventsFromArray } from '@schemeless/event-store';

await importEventsFromArray(store.eventStoreRepo, snapshot.events, {
  replace: true, // call resetStore() first (optional, default false)
  batchSize: 100, // optional, default 100
  onProgress: (n) => {},
});
```

> **Note:** `replace: true` calls `repo.resetStore()` before writing. Use this when restoring a full backup to ensure you start from a clean slate.

## Usage patterns

### Full backup and restore (Node.js)

```ts
import fs from 'fs/promises';
import { exportEventsToArray, importEventsFromArray, createSnapshot, parseSnapshot } from '@schemeless/event-store';

// Backup
const events = await exportEventsToArray(store.eventStoreRepo);
await fs.writeFile('backup.json', JSON.stringify(createSnapshot(events), null, 2));

// Restore
const json = await fs.readFile('backup.json', 'utf-8');
const { events } = parseSnapshot(json);
await importEventsFromArray(store.eventStoreRepo, events, { replace: true });
```

### React Native / Expo — share a backup file

```ts
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { exportEventsToArray, createSnapshot } from '@schemeless/event-store';

export async function shareBackup(store) {
  const events = await exportEventsToArray(store.eventStoreRepo, {
    onProgress: (n) => setProgress(n),
  });
  const json = JSON.stringify(createSnapshot(events));
  const path = FileSystem.documentDirectory + 'event-store-backup.json';
  await FileSystem.writeAsStringAsync(path, json);
  await Sharing.shareAsync(path, { mimeType: 'application/json' });
}
```

### React Native / Expo — restore from a backup file

```ts
import * as FileSystem from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import { importEventsFromArray, parseSnapshot } from '@schemeless/event-store';

export async function restoreBackup(store) {
  const result = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
  if (result.canceled) return;

  const json = await FileSystem.readAsStringAsync(result.assets[0].uri);
  const { events, count } = parseSnapshot(json);

  await importEventsFromArray(store.eventStoreRepo, events, {
    replace: true,
    onProgress: (n) => setProgress(`${n} / ${count}`),
  });
}
```

### Adapter migration (e.g. SQLite → PostgreSQL)

```ts
// 1. Export from old adapter
const oldStore = await makeEventStore(sqliteRepo)(flows);
const events = await exportEventsToArray(oldStore.eventStoreRepo);
const json = JSON.stringify(createSnapshot(events));

// 2. Import into new adapter
const newStore = await makeEventStore(pgRepo)(flows);
await importEventsFromArray(newStore.eventStoreRepo, parseSnapshot(json).events, {
  replace: true,
});
```

## Considerations

- **Order is preserved.** Events are exported in the order returned by `getAllEvents` (chronological), and imported in the same order. This ensures correct replay semantics.
- **Date serialisation.** Standard `JSON.stringify` converts `Date` to ISO-8601 strings. `parseSnapshot` automatically converts them back. If you call `importEventsFromArray` with a manually constructed array, date strings are also coerced.
- **Memory.** `exportEventsToArray` loads all events into memory at once. For extremely large stores, consider streaming the async iterator from `repo.getAllEvents` directly and writing pages to disk.
- **Concurrency.** Neither export nor import acquires a lock. For production imports, pause the event store first (`shutdown()`) and restart it after import is complete.
