# Changelog

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
