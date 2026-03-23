# Step 1: Build `event-store-core`

## Objective

Create a new core package that is only an event log and replay engine.

This step must produce a stable package boundary with no aggregate-runtime semantics.

## Scope

Implement a new package:

- `packages/event-store-core`

Core responsibilities:

- append events
- read stream events
- scan all events
- rebuild read models
- run observers
- import/export events

Out of scope:

- command handling
- aggregate hydration API
- aggregate validation
- aggregate stateful hooks

## Public API Target

```ts
export interface EventStoreCore {
  append(events: PersistedEvent[]): Promise<void>;

  stream(
    domain: string,
    identifier: string,
    options?: { fromSequence?: number }
  ): Promise<PersistedEvent[]>;

  scan(options?: {
    pageSize?: number;
    startFromId?: string;
  }): Promise<AsyncIterable<PersistedEvent[]>>;

  rebuildReadModels(options?: {
    startFromId?: string;
    observers?: Observer[];
    reset?: () => Promise<void>;
  }): Promise<void>;

  export(options?: {
    pageSize?: number;
  }): Promise<PersistedEvent[]>;

  import(
    events: PersistedEvent[],
    options?: {
      replace?: boolean;
    }
  ): Promise<void>;
}
```

## Required Work

1. Create package skeleton
2. Define core types in `@schemeless/event-store-types`
3. Move or rewrite replay logic as `rebuildReadModels()`
4. Move observer execution into the core package
5. Move import/export helpers into the core package
6. Remove aggregate-state-aware behavior from core observer execution
7. Write new core README/examples

## Constraints

- `core` must not know about `precondition`, `decide`, `evolve`, or `hydrate`
- observers receive only persisted events
- replay must be documented as read-model rebuild only
- no hidden dependency on in-memory aggregate state

## Suggested File Layout

- `packages/event-store-core/src/index.ts`
- `packages/event-store-core/src/makeEventStoreCore.ts`
- `packages/event-store-core/src/rebuildReadModels.ts`
- `packages/event-store-core/src/ObserverRunner.ts`
- `packages/event-store-core/src/exportImport.ts`

## Tests

Add tests for:

- append and stream read
- paginated scan
- rebuild read models in chronological order
- observer priority ordering
- fire-and-forget observer behavior
- export/import round trip

## Exit Criteria

- `event-store-core` compiles independently
- `rebuildReadModels()` works without any aggregate package present
- no core public API mentions aggregate state
- tests cover replay/rebuild semantics directly
