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
- `getAllEvents()` returns storage insertion/allocation order, not caller-provided `created` timestamps. PostgreSQL allocation order is not commit order under concurrent transactions; see the cursor limitations below.
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


## V6 atomic extensions

`BatchEventStoreAdapter` and `IncrementalEventStoreAdapter` are optional capability
contracts; `supportsAppendBatch` / `supportsIncrementalLog` detect support. PostgreSQL
and Expo SQLite support batches; only PostgreSQL supports the incremental vector log.
Core does not require either optional capability. PostgreSQL transaction composition remains
pg-specific via `withTransaction` and scoped `execute`; pg driver types do not enter
shared contracts. SQLite transaction composition is not currently exposed; do not
wrap root adapter calls in an external SQLite transaction. See [API, isolation, cursor limitations and receipt example](../packages/event-store-adapter-pg/readme.md).

## Rebuild and export while writers are active

Core replay, `rebuildReadModels`, and export use the legacy `getAllEvents` iterator.
They do not establish a snapshot, isolate projection resets, or automatically switch
onto the optional incremental log. For a complete rebuild/export, stop all event
writers, drain pending consumer work, run the operation to completion, then resume.
Do not concurrently reset and update the same projection.

For PostgreSQL online incremental consumption, use `getLogPage` and persist its
stream-vector checkpoint only after projection succeeds. This avoids skipping late
commits but does not preserve transaction-sized pages or total cross-stream commit
order. Use consumer idempotency and coordination; use CDC transaction boundaries
if atomic multi-stream projection is required. Finite stream versions protect only
listed dependencies, not new streams matching a query. A consumer-defined revision
stream must cover every mutation affecting such a query's decision scope.
