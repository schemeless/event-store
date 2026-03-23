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

Returns an `AsyncIterable<PersistedEvent[]>` that pages through `repo.getAllEvents()`.
Each iteration yields one page of events. Empty pages are filtered out automatically.

```ts
import { makeEventStoreCore } from '@schemeless/event-store-core';

const core = makeEventStoreCore(repo);

// Collect all events from the async iterable
const events: PersistedEvent[] = [];
for await (const page of core.export({ pageSize: 200 })) {
  events.push(...page);
}
```

### `core.scan(opts?)`

Same streaming interface as `export`, but intended for general log scanning
(e.g. building projections manually, debugging). Returns `AsyncIterable<PersistedEvent[]>`.

```ts
for await (const page of core.scan({ pageSize: 100, startFromId: 'cursor' })) {
  for (const event of page) {
    console.log(event.id, event.type);
  }
}
```

### `core.import(events, opts?)`

Writes a flat `PersistedEvent[]` back into the event log.
When `replace: true` is used, the adapter must provide `reset()`.

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

// Export: collect all pages into a flat array for serialisation
const events: PersistedEvent[] = [];
for await (const page of core.export()) {
  events.push(...page);
}
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
  const events = [];
  for await (const page of core.export()) events.push(...page);
  const path = FileSystem.documentDirectory + 'event-store-backup.json';
  await FileSystem.writeAsStringAsync(path, JSON.stringify(events));
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
const newCore = makeEventStoreCore(pgRepo);

for await (const page of oldCore.export()) {
  await newCore.import(page);
}
```

> This pattern streams one page at a time without loading the entire log into memory,
> which is preferable for large stores.

## Considerations

- **Order is preserved.** Events are exported in the order returned by `getAllEvents`, and imported in the same order.
- **Date serialisation.** If exported events are serialized to JSON, callers should restore `created` fields as `Date` before import or rely on the core import normalization.
- **Memory.** `core.export()` is a streaming `AsyncIterable`. To avoid loading everything into memory at once, process pages as they arrive instead of collecting them all upfront.
- **Concurrency.** Neither export nor import acquires a lock. Production imports should be run in a controlled maintenance window.
