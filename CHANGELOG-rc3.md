# Changelog 6.0.0-rc.3

## Bug Fixes

### @schemeless/event-store-adapter-pg

- **FIX:** `mapRowToEvent` column name case sensitivity - `correlationId`/`causationId`
  previously always returned `undefined` due to wrong case in row property access

## Tests Added

### @schemeless/event-store-adapter-pg

- Integration tests: 66 tests covering append, streams, snapshots, pagination,
  causation chains, concurrency, edge cases

### @schemeless/event-store-aggregate

- Integration tests: 47 tests covering handle/hydrate, snapshots, preconditions

### @schemeless/event-store-revert

- Integration tests: 42 tests covering compensation, canRevert, previewRevert

### @schemeless/event-store-core

- Unit tests: ObserverRunner, exportImport, makeEventStoreCore, rebuildReadModels

## Migration Plan

**No migration needed.**

This is a bug fix - previously `correlationId` and `causationId` always returned
`undefined` when reading from the database due to case mismatch in column name access.

If your code worked before, it will continue to work after upgrade.
