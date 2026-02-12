# OCC and Concurrency

This document covers optimistic concurrency control (OCC) and queue concurrency behavior.

## OCC basics

OCC prevents conflicting appends to the same stream. For adapters that support it, use:

- `repo.getStreamSequence(domain, identifier)`
- `repo.storeEvents(events, { expectedSequence })`

If sequence changed between read and write, adapter throws `ConcurrencyError`.

Error fields:

- `streamKey`
- `expectedSequence`
- `actualSequence`

Supported in this monorepo:

- `@schemeless/event-store-adapter-typeorm`
- `@schemeless/event-store-adapter-dynamodb`

Not currently implemented for OCC in:

- `@schemeless/event-store-adapter-prisma`
- `@schemeless/event-store-adapter-mikroorm`
- `@schemeless/event-store-adapter-typeorm-v3`
- `@schemeless/event-store-adapter-watermelondb`

## Recommended usage

Prefer `eventStore.receive(...)` for normal flow ingestion. Use raw `repo.storeEvents(...)` only when implementing custom append workflows.

If you use raw repo writes, pass full `CreatedEvent[]` objects (`id`, `created`, etc.).

## Multi-stream write caveat

`StoreEventsOptions.expectedSequence` is a single number. In multi-stream batches this can be ambiguous by design.

Practical guidance:

- Use OCC writes per stream when consistency matters
- Avoid reusing one `expectedSequence` across unrelated streams

## Adapter-level conflict behavior

- TypeORM adapter:
  detects unique-constraint conflicts (`SQLITE_CONSTRAINT`, PostgreSQL `23505`, MySQL `ER_DUP_ENTRY`) and maps them to `ConcurrencyError` with re-queried sequence.
- DynamoDB adapter:
  uses conditional writes for stream sequence checks and maps condition conflicts to `ConcurrencyError`.

## Batch behavior

- DynamoDB:
  batches larger than 25 writes are chunked; large payload offload to S3 happens before chunking.
- SQL adapters:
  batch writes are performed inside database transactions (adapter-specific implementation).

## Queue concurrency controls

Runtime queue options:

- `mainQueueConcurrent`
- `sideEffectQueueConcurrent`
- `observerQueueConcurrent`

Defaults are `1`.

## Ordering tradeoffs

When `mainQueueConcurrent > 1`:

- throughput increases
- strict global ordering can be relaxed
- dependent events across streams may interleave

Use `getShardKey` on flows to keep per-entity ordering while still allowing cross-entity parallelism.

## Tuning approach

1. Keep main queue at `1` first
2. Increase side-effect queue for external I/O bottlenecks
3. Increase observer queue if observer handlers are independent
4. Increase main queue only after measuring ordering-sensitive paths

## Conflict handling pattern

```ts
import { ConcurrencyError } from '@schemeless/event-store-types';

try {
  await repo.storeEvents(events, { expectedSequence });
} catch (error) {
  if (error instanceof ConcurrencyError) {
    // retry / merge / reject
    console.log(error.expectedSequence, error.actualSequence);
  }
}
```
