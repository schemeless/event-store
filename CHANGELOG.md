# Changelog

## [3.0.0] - 2026-02-07

### Added

- **Snapshot Support**: Introduced core interfaces and logic for aggregate snapshots.
  - New `getAggregate` helper in `EventStore` to automatically load state from snapshots + incremental event replay.
  - New `ISnapshotEntity` interface and `getStreamEvents` / `getSnapshot` / `saveSnapshot` methods in `IEventStoreRepo`.
  - Significant performance boost for high-volume streams (OCC validation) when adapters implement these methods.

## [2.11.0] - 2026-02-07

### Fixed

- **@schemeless/event-store-adapter-dynamodb**: Fixed duplicate S3 uploads when storing large batches (>25 items).
  - Refactored `storeEvents` to separate S3 offloading from recursive batch chunking.
  - S3 upload now happens once per oversized event before chunking begins.
- **@schemeless/event-store-adapter-typeorm**: Improved unique constraint violation error handling.
  - Added support for MySQL `ER_DUP_ENTRY` error code.
  - `ConcurrencyError` now reports the actual current sequence by re-querying the database on conflict.

### Added

- **@schemeless/event-store-adapter-dynamodb**: Comprehensive test coverage for advanced OCC scenarios.
  - Large batch chunking (>25 items) with S3 offload integration.
  - Multi-stream batch processing verification.
- **@schemeless/event-store-adapter-typeorm**: Real concurrency tests using file-based SQLite.
  - Validates race condition prevention and strict ordering enforcement.

### Documentation

- Added notes on `expectedSequence` behavior when batching events across multiple streams.
- Updated walkthrough with OCC refinement details and verification results.

## [2.9.0] - 2026-02-07

### Breaking Changes

- **Concurrency Behavior**: When `mainQueueConcurrent > 1`, events are now sharded by key (via `getShardKey` or `identifier`) instead of processing in naive global parallel.
  - **Before**: Random/Race condition parallel processing.
  - **After**: Strict sequential processing per key, parallel across keys.

### Added

- **Key-Based Partitioning (Sharding)**: First-class support for sharded event processing.
  - New `getShardKey` method on `EventFlow`.
  - Intelligent routing to `mainQueue` and `sideEffectQueue` partitions.
  - Guarantees strict ordering for events with the same key.
  - See [MIGRATION.md](packages/event-store/MIGRATION.md) for details.

- **Schema Versioning & Upcasting**: Built-in support for evolving event schemas.
  - New `EventMeta` type with `schemaVersion`.
  - New `upcast` hook in `EventFlow` to migrate older events on-the-fly.
  - Automatic version stamping for new events.
  - See [SCHEMA_VERSIONING.md](packages/event-store/SCHEMA_VERSIONING.md) for a complete guide.

## [2.8.2] - 2026-02-05

### Changed
- **@schemeless/event-store-adapter-dynamodb**: Migrated from AWS SDK v2 to **AWS SDK v3** (`@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`).
- Internal dependency synchronization to ^2.8.2.

## [2.8.1] - 2026-02-05

### Changed
- **@schemeless/event-store-adapter-dynamodb**: Major reconstruction (v2).
  - Switched from full table scans to efficient **Time Bucket** iteration for global replay.
  - Introduced **Conditional Writes** to ensure event uniqueness and concurrency safety.
  - Redigned schema with new Global Secondary Indexes (`timeBucketIndex`, `causationIndex`).
  - Added transparent S3 offloading support for large payloads (improved logic).
- Internal dependency synchronization to ^2.8.1.

### Added

- **Concurrent Queue Processing**: Added support for configurable concurrency in `mainQueue`, `sideEffectQueue`, and `observerQueue`.
  - New `EventStoreOptions` interface for `makeEventStore`.
  - Significant performance improvements for high-volume event processing when enabled.
- **Fire-and-Forget Observers**: Added `fireAndForget` option to `SuccessEventObserver`.
  - Allows observers to execute asynchronously without blocking the main event flow.
  - Failures in fire-and-forget observers are isolated and logged, preventing main flow interruption.

## [2.7.0] - 2026-02-04

### Added

- **Graceful Shutdown**: Added `shutdown()` method to `EventStore` to gracefully stop event processing, wait for queues to drain, and release resources.
  - New `shutdown(timeout?: number)` API.
  - New `close()` optional method on `IEventStoreRepo`.

## [2.6.0] - 2026-02-03

### Added

- **Cascading Revert Support**: Added built-in support for reverting root events and their descendant causal chains.
  - New `EventStore` APIs: `canRevert(eventId)`, `previewRevert(eventId)`, `revert(eventId)`.
  - New `EventFlow` hook: `compensate(event)` to define compensating logic for events.
  - New internal `makeRevert` logic to handle tree traversal and safety checks.
- **Adapter Support**: Updated all adapters (TypeORM, Prisma, MikroORM, DynamoDB, WatermelonDB, Null) with `getEventById` and `findByCausationId` methods.
- **React Native**: Equivalent revert support added to `@schemeless/event-store-react-native`.

### Deprecated

- **Manual causationId**: Setting `causationId` manually in event inputs is now deprecated and will warn at runtime. This field is now fully managed by the framework.

### Changed

- **EventOutputState**: Added `reverted` and `revertFailed` states.
