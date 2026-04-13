# @schemeless/event-store-core

Pure event-log infrastructure for appending, scanning, streaming, exporting, importing, and rebuilding read models from persisted events.

This package does not expose aggregate runtime concepts. Observers receive persisted events only.

`core.stream()` requires a `StreamEventStoreAdapter`.
`rebuildReadModels()` waits for all observer work to finish before it resolves.

```ts
import { makeEventStoreCore } from '@schemeless/event-store-core';

const core = makeEventStoreCore(repo);

await core.append(events);
const streamEvents = await core.stream('orders', 'order-1');
await core.rebuildReadModels({ observers });
```
