# Adapters

V6 keeps two first-class event-log adapters in this repository:

- `@schemeless/event-store-adapter-pg`
- `@schemeless/event-store-adapter-expo-sqlite`

Both implement `StreamEventStoreAdapter` from `@schemeless/event-store-types`.

## Required Capabilities

For `core`:

- `append(events)`
- `getAllEvents(pageSize?, startFromId?)`

For `aggregate`:

- `getStreamEvents(domain, identifier, fromSequence?)`
- `appendToStream(events, expectedVersion)`

For `revert`:

- `getEventById(id)`
- `findByCausationId(causationId)`
- `append(events)`

Optional:

- `getSnapshot(domain, identifier)`
- `saveSnapshot(snapshot)`
- `reset()` for tests and import replacement flows
- `close()` for releasing adapter resources

## Behaviour Rules

- `appendToStream(events, expectedVersion)` accepts exactly one `(domain, identifier)` stream per call.
- stream operations require a non-empty `identifier`.
- `getAllEvents()` must return storage commit order, not caller-provided `created` timestamps.
- `startFromId` must reference an existing event id; adapters should fail fast on invalid cursors.

## Adapter Selection

### PostgreSQL

Use `@schemeless/event-store-adapter-pg` when you want:

- multi-instance deployments
- durable event logs
- strong stream-level optimistic concurrency

### Expo SQLite

Use `@schemeless/event-store-adapter-expo-sqlite` when you want:

- on-device event logs
- offline-first mobile workflows
- local aggregate hydration and replay


## V6 PostgreSQL atomic extensions

`BatchEventStoreAdapter` and `IncrementalEventStoreAdapter` are optional capability
contracts; `supportsAppendBatch` / `supportsIncrementalLog` detect support. SQLite
and core keep their existing contracts. PostgreSQL transaction composition remains
pg-specific via `withTransaction` and scoped `execute`; pg driver types do not enter
shared contracts. See [API, isolation, cursor limitations and receipt example](../packages/event-store-adapter-pg/readme.md).
