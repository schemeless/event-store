# Export and Import Events

The V6 architecture exposes export/import through `@schemeless/event-store-core`. These utilities are adapter-agnostic and operate on the event-log layer.

## When to use this

| Scenario                                               | Pattern                                                   |
| ------------------------------------------------------ | --------------------------------------------------------- |
| **User backup** — let users download their data        | Export → `JSON.stringify` → write file                    |
| **Developer analysis** — dump events for debugging     | Export → share file                                       |
| **Adapter migration** — move between storage backends  | Export from old → Import into new                         |
| **Device restore** — let users restore on a new device | Read file → `parseSnapshot` → Import with `replace: true` |

## API Reference

### `core.export(opts?)`

Pages through `repo.getAllEvents()` and collects every event into a flat array.

```ts
import { makeEventStoreCore } from '@schemeless/event-store-core';

const core = makeEventStoreCore(repo);
const events = await core.export({ pageSize: 200 });
// -> PersistedEvent[]
```

### `core.import(events, opts?)`

Writes events back into the event log. When `replace: true` is used, the adapter must provide `reset()`.

```ts
await core.import(events, {
  replace: true,
});
```

> **Note:** `replace: true` requires `repo.reset()` support.

## Usage patterns

### Full backup and restore (Node.js)

```ts
import fs from 'fs/promises';
import { makeEventStoreCore } from '@schemeless/event-store-core';

const core = makeEventStoreCore(repo);
const events = await core.export();
await fs.writeFile('backup.json', JSON.stringify(events, null, 2));

// Restore into a reset-capable adapter
const json = await fs.readFile('backup.json', 'utf-8');
await core.import(JSON.parse(json), { replace: true });
```

### React Native / Expo — share a backup file

```ts
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { makeEventStoreCore } from '@schemeless/event-store-core';

export async function shareBackup(repo) {
  const core = makeEventStoreCore(repo);
  const json = JSON.stringify(await core.export());
  const path = FileSystem.documentDirectory + 'event-store-backup.json';
  await FileSystem.writeAsStringAsync(path, json);
  await Sharing.shareAsync(path, { mimeType: 'application/json' });
}
```

### React Native / Expo — restore from a backup file

```ts
import * as FileSystem from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import { makeEventStoreCore } from '@schemeless/event-store-core';

export async function restoreBackup(repo) {
  const core = makeEventStoreCore(repo);
  const result = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
  if (result.canceled) return;

  const json = await FileSystem.readAsStringAsync(result.assets[0].uri);
  await core.import(JSON.parse(json), { replace: true });
}
```

### Adapter migration (e.g. SQLite → PostgreSQL)

```ts
const oldCore = makeEventStoreCore(sqliteRepo);
const events = await oldCore.export();

const newCore = makeEventStoreCore(pgRepo);
await newCore.import(events, { replace: true });
```

## Considerations

- **Order is preserved.** Events are exported in the order returned by `getAllEvents`, and imported in the same order.
- **Date serialisation.** If exported events are serialized to JSON, callers should restore `created` fields as `Date` before import or rely on the core import normalization.
- **Memory.** `exportEventsToArray` loads all events into memory at once. For extremely large stores, consider streaming the async iterator from `repo.getAllEvents` directly and writing pages to disk.
- **Concurrency.** Neither export nor import acquires a lock. Production imports should be run in a controlled maintenance window.
