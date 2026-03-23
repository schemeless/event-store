# Legacy EventFlow Reference

This document is preserved for migration purposes only.

`EventFlow` and `AggregateEventFlow` belong to the legacy `@schemeless/event-store` architecture. New code should use the V6 split architecture instead:

- [`@schemeless/event-store-core`](../packages/event-store-core/readme.md)
- [`@schemeless/event-store-aggregate`](../packages/event-store-aggregate/readme.md)

## Historical shape

The legacy model centered on a single flow object with optional hooks such as:

- `validate`
- `preApply`
- `apply`
- `sideEffect`
- `createConsequentEvents`
- `compensate`

Those hooks were overloaded across command handling, replay, and projection concerns. In V6, those responsibilities are split across core, aggregate runtime, and projection observers.

## Migration notes

- `validate` becomes either `precondition` or `validateEvent`.
- `apply` is no longer an aggregate state transition hook; use `evolve` in aggregate runtime.
- `createConsequentEvents` becomes `decide() -> Event[]`.
- `replay()` becomes `rebuildReadModels()`.

For the new architecture, see [`docs/redesign-v6-migration.md`](./redesign-v6-migration.md).
