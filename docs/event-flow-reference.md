# EventFlow Reference

`EventFlow` models one domain event type and its lifecycle handlers.

## Required fields

- `domain: string`
- `type: string`
- `receive: (eventStore) => (eventInput) => Promise<[CreatedEvent, ...]>`

## Core optional fields

- `description`: human description for docs/tooling
- `meta.sideEffectFailedRetryAllowed`: side-effect retry budget
- `samplePayload`: example payload for readability/tests
- `eventType`: type helper for created event shape
- `payloadType`: type helper for payload inference/narrowing

## Lifecycle hooks

- `validate(event)`: reject invalid state before apply/persist
- `preApply(event)`: transform/enrich event before apply
- `apply(event)`: synchronous projection/read-model updates
- `sideEffect(event)`: async integration work, may enqueue new base events
- `cancelApply(event)`: compensation when event is canceled during cleanup
- `createConsequentEvents(causalEvent)`: fan-out follow-up events
- `compensate(originalEvent)`: return compensating event(s) for revert

## Signature reference

| Field | Signature |
| --- | --- |
| `receive` | `(eventStore) => (eventInputArgs) => Promise<[CreatedEvent<Payload>, ...CreatedEvent<any>[]]>` |
| `validate` | `(event) => Promise<Error \\| void> \\| Error \\| void` |
| `preApply` | `(event: CreatedEvent<PartialPayload>) => Promise<CreatedEvent<Payload> \\| void> \\| CreatedEvent<Payload> \\| void` |
| `apply` | `(event) => Promise<void> \\| void` |
| `sideEffect` | `(event) => Promise<void \\| BaseEvent<any>[]> \\| void \\| BaseEvent<any>[]` |
| `cancelApply` | `(event) => Promise<void> \\| void` |
| `createConsequentEvents` | `(causalEvent) => Promise<BaseEvent<any>[]> \\| BaseEvent<any>[]` |
| `compensate` | `(originalEvent) => BaseEvent<any> \\| BaseEvent<any>[]` |

## Schema evolution hooks

- `schemaVersion`: current payload schema version (default `1`)
- `upcast(event, fromVersion)`: migrate older event payloads at runtime

Use this for backward-compatible replay and rolling migrations.

## Sharding hook

- `getShardKey(event) => string | undefined`

Events with the same shard key are processed sequentially in the same partition. Different shard keys can run in parallel when queue concurrency is greater than `1`.

## Input and output shapes

`receive` accepts `BaseEventInput`:

- `payload` (required)
- `meta` (optional)
- `identifier` (optional)
- `correlationId` (optional)
- `created` (optional)

`receive` resolves to created event array where each event has:

- framework-generated `id` (ULID-like)
- normalized `created: Date`
- correlation/causation linkage

## Authoring tips

- Keep business invariants in `validate`
- Keep pure state updates in `apply`
- Keep external I/O in `sideEffect`
- Use `createConsequentEvents` for causal workflows instead of ad-hoc recursion
- Define `compensate` only for events that are logically reversible

## Minimal template

```ts
import type { EventFlow } from '@schemeless/event-store-types';

type Payload = { id: string };

export const UserCreated: EventFlow<Payload> = {
  domain: 'user',
  type: 'created',
  receive: (es) => (input) => es.receive(UserCreated)(input),
  validate: (event) => {
    if (!event.payload.id) throw new Error('id is required');
  },
  apply: async (event) => {
    // projection update
  },
};
```
