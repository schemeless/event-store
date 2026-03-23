# Adapter Selection and Configuration

Legacy adapter selection guide for the old `IEventStoreRepo` surface.

For the V6 architecture, adapters should be evaluated against the capability matrix:

- core event log
- stream query
- optimistic concurrency
- snapshot

See:

- [`docs/architecture.md`](./architecture.md)
- [`docs/redesign-v6-migration.md`](./redesign-v6-migration.md)

## Adapter matrix

| Adapter | Core event log | Stream query | Optimistic concurrency | Snapshot | Multi-instance aggregate writes |
| --- | --- | --- | --- | --- | --- |
| `@schemeless/event-store-adapter-pg` | Yes | Yes | Yes | Yes | Yes |
| `@schemeless/event-store-adapter-expo-sqlite` | Yes | Yes | Yes | Yes | Limited to local/device scope |
| `@schemeless/event-store-adapter-dynamodb` | Yes | Yes | Yes | Partial | Yes |
| `@schemeless/event-store-adapter-typeorm` | Legacy | Legacy | Legacy | Legacy | Legacy |
| `@schemeless/event-store-adapter-prisma` | Legacy | Legacy | Legacy | Legacy | Legacy |
| `@schemeless/event-store-adapter-mikroorm` | Legacy | Legacy | Legacy | Legacy | Legacy |

## Legacy note

The old `IEventStoreRepo`-centric configuration examples remain in the repository for migration purposes only. New code should be written against the V6 packages and their capability contracts.
