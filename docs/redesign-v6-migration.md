# V6 Migration Guide

This guide maps the old event-flow architecture to the V6 split architecture.

## New targets

- Core runtime: `@schemeless/event-store-core`
- Aggregate runtime: `@schemeless/event-store-aggregate`
- Shared contracts: `@schemeless/event-store-types`

## Mapping

- `validate` -> `precondition` or `validateEvent`
- aggregate `apply` -> `evolve`
- `createConsequentEvents` -> return `Event[]` from `decide`
- `replay()` -> `rebuildReadModels()`
- `submit(flow, input)` -> `aggregateRuntime.handle(aggregate, command)`

## Behavioral changes

- Replay no longer performs aggregate recovery.
- Observers run during read-model rebuild, not as part of aggregate hydration.
- Aggregate writes depend on `appendToStream(expectedVersion)`, not projection freshness.
- The persisted event stream is the source of truth.

## Practical migration path

1. Move any projection logic to core observers.
2. Replace aggregate-aware `EventFlow` definitions with `AggregateDefinition`.
3. Convert command handling to `handle()`.
4. Use `hydrate()` only for aggregate state loading.
5. Use `rebuildReadModels()` to rebuild projections after data loss or deployment.

## Example

See the reference walkthrough in:

- [`packages/event-store-cash-account-example`](../packages/event-store-cash-account-example)

## Legacy package

The old `@schemeless/event-store` package is now legacy documentation surface. New projects should not start there.
