# Architecture

This document explains how Schemeless Event Store processes events end-to-end.

## Lifecycle overview

Each incoming command goes through a deterministic lifecycle:

1. `receive` turns input into one or more event candidates
2. Framework creates event metadata (`id`, `created`, correlation/causation)
3. `validate` checks invariants
4. `preApply` can enrich/reshape event data
5. `apply` runs synchronous projection logic
6. Created events are persisted by the repository
7. `sideEffect` runs async work (with retry)
8. Success observers are executed by observer queue

If validation/apply fails, created events in the same chain are marked canceled and `cancelApply` hooks are used for cleanup.

## Event structure

Every persisted event follows this baseline shape:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | Framework-generated event id |
| `domain` | `string` | Domain namespace (`Account`, `Order`, etc.) |
| `type` | `string` | Event type inside domain |
| `payload` | `object` | Business payload |
| `meta` | `object?` | Optional metadata/extensions |
| `created` | `Date` | Event creation timestamp |
| `identifier` | `string?` | Developer-provided actor/stream identifier |
| `correlationId` | `string?` | Root causal chain id |
| `causationId` | `string?` | Immediate parent event id |

## Queues and processing model

The runtime coordinates three queue layers:

- Main queue: receives root events and consequent events
- Side-effect queue: executes `sideEffect` with retry policy
- Observer queue: executes success observers by priority

Concurrency is configurable via:

- `mainQueueConcurrent`
- `sideEffectQueueConcurrent`
- `observerQueueConcurrent`

Default is `1` for deterministic ordering.

## Traceability model

Framework-managed tracing fields:

- `id`: unique event id
- `correlationId`: root-chain id
- `causationId`: immediate parent id

Developer-supplied tracing/context fields:

- `identifier`: actor/stream identifier
- External trace ids (for example `trackingId`) should be stored in `meta`

The key rule is: do not manually author `causationId` in normal flow input. It is derived by the framework when consequent/side-effect-generated events are created.

### Chain example

```text
Order/Placed (root)
  id=evt_111
  correlationId=evt_111
  causationId=null

Account/Transfer
  id=evt_222
  correlationId=evt_111
  causationId=evt_111

Account/Debit
  id=evt_333
  correlationId=evt_111
  causationId=evt_222
```

## Replay model

`replay()` streams stored events in chronological order and re-runs:

- flow `apply`
- success observers

Use replay to rebuild read models/projections after deployment or migration.

## Output stream (`output$`)

`EventStore.output$` emits lifecycle outcomes from main processing and side effects.

State families emitted by `output$`:

- Event states: `Event:success`, `Event:invalid`, `Event:canceled`, `Event:reverted`, `Event:revertFailed`
- Side-effect states: `SideEffects:done`, `SideEffects:retry`, `SideEffects:fail`

Use it for:

- metrics and alerting
- dead-letter diagnostics
- replay progress visibility

Runtime behavior note:

- the store creates an internal subscription so processing starts even when callers do not subscribe
- during `shutdown()`, that internal subscription is cleaned up

## Repository contract boundary

The runtime is storage-agnostic. Adapters implement `IEventStoreRepo` and provide:

- init/reset primitives
- event persistence
- paginated historical streaming

Optional repository capabilities unlock advanced features such as OCC and revert tree traversal.

## Shutdown behavior

`shutdown(timeout)`:

1. waits for main + side-effect queues to drain
2. pauses and destroys queue workers
3. calls `repo.close()` when available
4. aborts with timeout error if graceful drain takes too long
