# @schemeless/event-store-aggregate

Aggregate command runtime for the redesign v6 architecture.

This package owns aggregate hydration and command handling only. It does not rebuild read models or run observers.

Aggregate identifiers are treated as hard invariants: `getIdentifier(command)` must return a non-empty string.
Snapshot save failures are reported through `console.error`, or `makeAggregateRuntime(adapter, { onSnapshotError })`.
