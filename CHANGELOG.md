# Changelog

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
