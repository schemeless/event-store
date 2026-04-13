# Step 3: Build `event-store-aggregate`

## Objective

Implement a dedicated aggregate command runtime on top of the new core and stream-capable adapters.

This package owns aggregate hydration, preconditions, event decisions, and state evolution.

## Scope

Implement a new package:

- `packages/event-store-aggregate`

Do not reuse old `EventFlow` / `AggregateEventFlow` semantics.

## Public API Target

```ts
export interface AggregateRuntime {
  handle<C, E extends DomainEvent, S>(aggregate: AggregateDefinition<C, E, S>, command: C): Promise<HandleResult<E, S>>;

  hydrate<E extends DomainEvent, S>(
    aggregate: AggregateDefinition<any, E, S>,
    identifier: string
  ): Promise<HydratedAggregate<S>>;
}
```

```ts
export interface AggregateDefinition<Command, Event extends DomainEvent, State> {
  name: string;
  domain: string;

  getIdentifier(command: Command): string;
  initialState: State;
  evolve(state: State, event: Event): State;

  precondition?(command: Command, state: State, ctx: AggregateContext): Promise<void> | void;

  decide(command: Command, state: State, ctx: AggregateContext): Promise<Event[]> | Event[];

  validateEvent?(event: Event, state: State, ctx: PhaseContext): Promise<void> | void;
}
```

## Required Work

1. Implement aggregate hydration from snapshot + stream
2. Implement `handle(command)` lifecycle
3. Canonicalize `identifier` onto every produced event before append
4. Enforce `evolve` as the only state transition function
5. Persist with `appendToStream(expectedVersion)`
6. Add optional snapshot save policy hooks

## Hard Constraints

- aggregate runtime must not depend on replay/rebuild observers
- `precondition` runs only for live command handling
- `validateEvent`, if present, must be replay-safe
- `evolve` is the only state transition source
- command handlers return `Event[]`, not one event plus a consequent-event mechanism
- aggregate identifiers must be non-empty
- snapshot save failures must be observable via logging or hooks

## Execution Flow

1. resolve identifier from command
2. hydrate current state
3. run `precondition`
4. run `decide`
5. canonicalize event identifiers
6. optionally run `validateEvent`
7. append with OCC
8. fold `nextState` with `evolve`
9. optionally save snapshot

## Tests

Add tests for:

- hydrate from initial state with empty stream
- hydrate from snapshot plus trailing events
- `precondition` success and failure
- `decide` returning multiple events
- canonical identifier persisted onto emitted events
- OCC conflict handling
- multi-event state evolution after a successful handle

## Exit Criteria

- aggregate runtime compiles without old `EventFlow`
- aggregate writes work without replay
- aggregate identity is canonicalized before persistence
- live command handling correctness depends only on stream-capable adapter behavior
