# OCC and Concurrency

Legacy guide for the old `@schemeless/event-store` package.

For V6, prefer:

- `appendToStream(expectedVersion)` on stream-capable adapters
- `hydrate()` / `handle()` in `@schemeless/event-store-aggregate`
- `rebuildReadModels()` in `@schemeless/event-store-core`

## OCC basics

Optimistic concurrency now belongs to the aggregate runtime boundary.

- `expectedVersion` is the correctness boundary for multi-instance aggregate writes.
- `event.identifier` is the canonical stream key.
- Projection freshness must never be required for write correctness.

## Error handling

Use `StreamConcurrencyError` for V6 aggregate writes. Legacy repo-level `ConcurrencyError` still exists for older adapters.

## Legacy package note

The old `eventStore.receive(...)` path is no longer the recommended write-side API.

For new work, use the V6 split architecture documented in:

- [`docs/redesign-v6-migration.md`](./redesign-v6-migration.md)
- [`docs/architecture.md`](./architecture.md)
