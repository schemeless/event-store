# Step 2: Redefine Adapter Contracts

## Objective

Define storage contracts that clearly separate:

- base event-log capability
- stream-query capability
- optimistic concurrency capability
- snapshot capability

This step defines the correctness boundary for concurrency, multi-instance safety, and restart recovery.

## Scope

Update `@schemeless/event-store-types` with new adapter interfaces and capability flags.

This is the architectural center of the redesign. Aggregate runtime must not be built until these contracts are stable.

## Public Contract Target

```ts
export interface EventStoreAdapter {
  init(): Promise<void>;
  close?(): Promise<void>;

  append(events: AppendableEvent[]): Promise<void>;

  getAllEvents(pageSize?: number, startFromId?: string): Promise<AsyncIterable<PersistedEvent[]>>;
}
```

```ts
export interface StreamEventStoreAdapter extends EventStoreAdapter {
  getStreamEvents(domain: string, identifier: string, fromSequence?: number): Promise<PersistedEvent[]>;

  appendToStream(events: StreamAppendableEvent[], expectedVersion: number): Promise<{ nextVersion: number }>;

  getSnapshot?<State>(domain: string, identifier: string): Promise<Snapshot<State> | null>;

  saveSnapshot?<State>(snapshot: Snapshot<State>): Promise<void>;

  capabilities: {
    streamQuery: true;
    optimisticConcurrency: true;
    snapshot?: boolean;
  };
}
```

## Required Work

1. Add new adapter interfaces to types package
2. Define concurrency conflict error types
3. Define snapshot types
4. Define capability semantics in docs
5. Update internal code references to stop assuming one undifferentiated repo interface

## Hard Decisions To Encode

- `append()` is not enough for strong aggregate writes
- `appendToStream(expectedVersion)` is the correctness boundary for multi-instance writes
- snapshots are optional and never the source of truth
- `identifier` is the canonical stream key
- `appendToStream()` must accept only one `(domain, identifier)` stream per call
- `getAllEvents()` order must follow storage commit order, not caller-provided timestamps
- `startFromId` must be a strict cursor, not a best-effort hint

## Tests

Add tests for:

- stream read ordering
- append-to-stream version mismatch
- snapshot load and incremental stream replay
- adapters that support base capability but not aggregate runtime capability

## Exit Criteria

- core can be typed against the base adapter
- aggregate runtime can be typed against the stream-capable adapter
- capability gaps are explicit in types and runtime checks
- concurrency semantics are documented, not implied
