# V4 Plan: External API Redesign for AI-Friendliness

## Goal

Make `@schemeless/event-store` and `@schemeless/event-store-types` maximally friendly to AI programming tools (Codex, Claude Code, Cursor, etc.) — both for maintaining this library and for downstream users who define EventFlows with AI assistance.

V4 focuses on **external API changes** that require downstream migration. Internal implementation changes are deferred to V5.

This is a **breaking release**. All changes prioritize type safety and explicitness over backwards compatibility.

## Prerequisites

- Read this entire document before starting any implementation
- Run `yarn install` at repo root to ensure dependencies are in place
- Run `yarn test` in `packages/event-store` to verify tests pass before making changes
- The monorepo uses Lerna + Yarn workspaces. The two packages involved are:
  - `packages/event-store-types` — type definitions only, no runtime code
  - `packages/event-store` — the main library

## Context: Why V4

### Problem 1: EventFlow is a "magic bag" of optional fields

The current `EventFlow` type in `packages/event-store-types/src/EventStore.types.ts` has ~12 optional fields. Whether `aggregate` is present changes the semantics of `validate` and `apply`:

- **Without `aggregate`**: `apply(event)` returns `void`
- **With `aggregate`**: `apply(event, state)` must return `State`

This is checked at runtime (`isAggregateEventFlow()` in `packages/event-store/src/operators/isAggregateEventFlow.ts`), not at the type level. AI tools cannot know these constraints without reading implementation code.

### Problem 2: Triple-curried `receive` function

The current API: `eventStore.receive(flow)(input)` — a curried function returned by `makeReceive`. The `receive` property on `EventFlow` itself is also curried: `receive: (eventStore) => (input) => Promise<...>`. AI has to track what's closed over at each level.

### Problem 3: Error messages are unstructured strings

All errors are `throw new Error('string')`. AI debug tools can only pattern-match on strings, not on error types or structured data.

### Problem 4: `output$` leaks RxJS into the public API

The `EventStore` interface exposes `Observable<EventOutput>` from RxJS. Downstream users who don't use RxJS are forced to depend on it, and AI tools may not understand RxJS subscription semantics.

---

## Task List (in order)

### Task 1: Discriminated Union for EventFlow

**Files to modify:**
- `packages/event-store-types/src/EventStore.types.ts`

**What to do:**

1. Add a `kind` discriminant field to EventFlow types. Keep the existing `EventFlow` and `AggregateEventFlow` interfaces but add `kind`:

```typescript
// Add to existing EventFlow interface:
interface EventFlow<PartialPayload, Payload, META> {
  readonly kind?: 'simple';  // optional for backwards compat in v4, required in v5
  // ... all existing fields unchanged
}

// Add to existing AggregateEventFlow interface:
interface AggregateEventFlow<PartialPayload, Payload, State, META> {
  readonly kind?: 'aggregate';  // optional for backwards compat in v4, required in v5
  // ... all existing fields unchanged
}
```

2. Create a new union type that uses discriminated union when `kind` is specified:

```typescript
/**
 * Use this type when defining new EventFlows.
 * The `kind` field enables TypeScript to narrow the type automatically.
 */
export type TypedEventFlow<P = any, S = any> =
  | (EventFlow<P, P> & { readonly kind: 'simple' })
  | (AggregateEventFlow<P, P, S> & { readonly kind: 'aggregate' });
```

3. Update the `isAggregateEventFlow` function in `packages/event-store/src/operators/isAggregateEventFlow.ts` to also check `kind`:

```typescript
export const isAggregateEventFlow = (flow: EventFlow | AggregateEventFlow): flow is AggregateEventFlow => {
  if (flow.kind === 'aggregate') return true;
  if (flow.kind === 'simple') return false;
  // Fallback for v3 flows without kind
  return !!(flow as AggregateEventFlow).aggregate;
};
```

**Why optional `kind` in V4:** Allows gradual migration. Existing flows without `kind` still work. New flows should use `kind` for type narrowing.

**Tests to update:**
- `packages/event-store/src/aggregate-eventflow.test.ts` — add `kind: 'aggregate'` to test flows
- `packages/event-store/src/mocks/Standard.event.ts` — add `kind: 'simple'`
- `packages/event-store/src/mocks/NestedOnce.event.ts` — add `kind: 'simple'`
- `packages/event-store/src/mocks/NestedTwice.event.ts` — add `kind: 'simple'`
- All existing tests must still pass with or without `kind`

---

### Task 2: Simplified `submit` API alongside `receive`

**Files to modify:**
- `packages/event-store/src/EventStore.types.ts`
- `packages/event-store/src/makeEventStore.ts`

**What to do:**

1. Add a `submit` method to the `EventStore` interface in `packages/event-store/src/EventStore.types.ts`:

```typescript
export interface EventStore {
  // ... existing fields ...

  /**
   * Submit an event for processing. This is the preferred API over `receive`.
   * Validates, applies, persists, runs side effects, and notifies observers.
   *
   * @param flow - The EventFlow definition for this event type
   * @param input - The event input (payload, identifier, etc.)
   * @returns All created events (root + consequent events)
   * @throws ValidationError if validation fails
   */
  submit: <PartialPayload, Payload extends PartialPayload>(
    flow: EventFlow<PartialPayload, Payload>,
    input: BaseEventInput<PartialPayload>
  ) => Promise<[CreatedEvent<Payload>, ...Array<CreatedEvent<any>>]>;
}
```

2. In `makeEventStore.ts`, implement `submit` by delegating to `receive`:

```typescript
const receiveHandler = makeReceive(mainQueue, successEventObservers, {
  observerQueueConcurrent,
  eventFlowMap,
});

const submit: EventStore['submit'] = (flow, input) => receiveHandler(flow)(input);
```

3. Add `submit` to the returned EventStore object.

4. Mark `receive` as `@deprecated` in the `EventStore` interface JSDoc:

```typescript
/**
 * @deprecated Use `submit(flow, input)` instead. Will be removed in v5.
 */
receive: ReturnType<typeof makeReceive>;
```

**Tests to add:**
- New test in `packages/event-store/src/makeEventStore.test.ts`:
  - Test `submit` works identically to `receive(flow)(input)` for simple events
  - Test `submit` works for aggregate events
  - Test `submit` throws on validation failure

---

### Task 3: Structured Error Types

**Files to modify:**
- `packages/event-store-types/src/Errors.ts` (add new error classes)
- `packages/event-store-types/src/index.ts` (export new errors)
- Various files in `packages/event-store/src/` (use new error types)

**What to do:**

1. Add error classes to `packages/event-store-types/src/Errors.ts`:

```typescript
// Keep existing ConcurrencyError unchanged

export class EventStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventStoreError';
  }
}

export class ValidationError extends EventStoreError {
  constructor(
    public readonly flow: { domain: string; type: string },
    public readonly eventId: string,
    cause: unknown
  ) {
    super(
      `Validation failed for ${flow.domain}/${flow.type} (event ${eventId}): ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    );
    this.name = 'ValidationError';
    this.cause = cause instanceof Error ? cause : new Error(String(cause));
  }
}

export class FlowNotFoundError extends EventStoreError {
  constructor(
    public readonly domain: string,
    public readonly type: string
  ) {
    super(
      `No EventFlow registered for "${domain}/${type}". ` +
      `Make sure the EventFlow is included in the eventFlows array passed to makeEventStore.`
    );
    this.name = 'FlowNotFoundError';
  }
}

export class AggregateError extends EventStoreError {
  constructor(
    public readonly flow: { domain: string; type: string },
    public readonly reason: 'no_loader' | 'no_identifier' | 'apply_must_return_state' | 'capability_missing'
  ) {
    const messages: Record<string, string> = {
      no_loader: 'requires getAggregate() support to load state',
      no_identifier: 'requires an identifier (set event.identifier or aggregate.getIdentifier)',
      apply_must_return_state: 'apply() must return the new state object',
      capability_missing: 'requires adapter with getStreamEvents() support',
    };
    super(`AggregateEventFlow ${flow.domain}/${flow.type}: ${messages[reason]}`);
    this.name = 'AggregateError';
  }
}

export class ShutdownTimeoutError extends EventStoreError {
  constructor(public readonly timeoutMs: number) {
    super(`EventStore shutdown timed out after ${timeoutMs}ms`);
    this.name = 'ShutdownTimeoutError';
  }
}

export class RevertError extends EventStoreError {
  constructor(
    public readonly eventId: string,
    public readonly reason: 'not_found' | 'not_root' | 'missing_compensate' | 'repo_not_supported',
    public readonly details?: string
  ) {
    const messages: Record<string, string> = {
      not_found: `Event not found: ${eventId}`,
      not_root: `Event ${eventId} is not a root event. Revert the root event instead.`,
      missing_compensate: `Some events in the tree lack a 'compensate' hook`,
      repo_not_supported: 'Repository must implement getEventById and findByCausationId',
    };
    super(messages[reason] + (details ? `. ${details}` : ''));
    this.name = 'RevertError';
  }
}
```

2. Replace `throw new Error(...)` with structured errors in these files:

| File | Line(s) | Current Error | Replace With |
|------|---------|---------------|-------------|
| `operators/getEventFlow.ts` | ~10 | `Error('No EventFlow found...')` | `FlowNotFoundError(domain, type)` |
| `eventLifeCycle/validate.ts` | ~22,35 | `Error('AggregateEventFlow requires...')` | `AggregateError(flow, 'no_identifier')` / `AggregateError(flow, 'no_loader')` |
| `eventLifeCycle/apply.ts` | ~26,38,59 | `Error('AggregateEventFlow requires...')` | `AggregateError(flow, ...)` |
| `makeEventStore.ts` | ~47-50 | `Error('AggregateEventFlow requires adapter...')` | `AggregateError(flow, 'capability_missing')` |
| `makeEventStore.ts` | ~65-68 | `Error('getAggregate is unavailable...')` | `AggregateError({domain:'*',type:'*'}, 'capability_missing')` |
| `makeEventStore.ts` | shutdown timeout | `Error('EventStore shutdown timeout')` | `ShutdownTimeoutError(timeout)` |
| `revert/makeRevert.ts` | ~31-32 | `Error('Revert operations require...')` | `RevertError('', 'repo_not_supported')` |
| `revert/makeRevert.ts` | ~108 | `Error('Event not found...')` | `RevertError(eventId, 'not_found')` |
| `revert/makeRevert.ts` | ~114 | `Error('Event is not root...')` | `RevertError(eventId, 'not_root')` |

3. Export all new errors from `packages/event-store-types/src/index.ts` (already exports `*` from `Errors.ts`, so just adding to that file is sufficient).

**Tests to add/update:**
- `packages/event-store/src/revert/makeRevert.test.ts` — verify error instances (`expect(error).toBeInstanceOf(RevertError)`)
- `packages/event-store/src/eventLifeCycle/validate.test.ts` — verify `ValidationError` instances
- Add new test: error types are exported and constructible from `@schemeless/event-store-types`

---

### Task 4: Event notification without RxJS dependency

**Files to modify:**
- `packages/event-store/src/EventStore.types.ts`
- `packages/event-store/src/makeEventStore.ts`

**What to do:**

1. Add an `on` method to the `EventStore` interface:

```typescript
export interface EventStore {
  // ... existing fields ...

  /**
   * Subscribe to event processing notifications.
   * Alternative to output$ that doesn't require RxJS.
   *
   * @returns Unsubscribe function
   */
  on: (event: 'processed', handler: (output: EventOutput) => void) => () => void;
}
```

2. Implement in `makeEventStore.ts`:

```typescript
const eventHandlers: Array<(output: EventOutput) => void> = [];

const on: EventStore['on'] = (event, handler) => {
  if (event !== 'processed') throw new Error(`Unknown event: ${event}`);
  eventHandlers.push(handler);
  return () => {
    const idx = eventHandlers.indexOf(handler);
    if (idx !== -1) eventHandlers.splice(idx, 1);
  };
};

// Modify the outputSubscription to also notify handlers:
const outputSubscription = output$.subscribe((output) => {
  for (const handler of eventHandlers) {
    try { handler(output); } catch (e) { logger.error(`Event handler error: ${e}`); }
  }
});
```

3. Mark `output$` as `@deprecated` in the interface:

```typescript
/**
 * @deprecated Use `on('processed', handler)` instead. Will be removed in v5.
 * Requires RxJS subscription.
 */
output$: Observable<EventOutput>;
```

**Tests to add:**
- Test `on('processed', handler)` receives events
- Test unsubscribe function stops notifications
- Test handler errors don't break the pipeline

---

### Task 5: Hide internal queue types from public API

**Files to modify:**
- `packages/event-store/src/EventStore.types.ts`

**What to do:**

1. Mark `mainQueue` and `sideEffectQueue` as `@deprecated` and type them more opaquely:

```typescript
export interface EventStore {
  /**
   * @deprecated Internal implementation detail. Will be removed in v5.
   * Use submit() and on() instead of directly interacting with queues.
   */
  mainQueue: { push: (task: any) => void };

  /**
   * @deprecated Internal implementation detail. Will be removed in v5.
   */
  sideEffectQueue: { push: (task: any) => void };

  // ... rest unchanged
}
```

Wait — changing the types of `mainQueue`/`sideEffectQueue` would break downstream code that accesses these. Instead, just add `@deprecated` JSDoc without changing the types:

```typescript
/**
 * @deprecated Internal implementation detail. Do not use directly.
 * Use `submit()` for sending events and `on('processed', handler)` for notifications.
 * Will be removed in v5.
 */
mainQueue: ReturnType<typeof makeMainQueue>;
```

Same for `sideEffectQueue`.

---

### Task 6: Deprecate the curried `receive` on EventFlow

**Files to modify:**
- `packages/event-store-types/src/EventStore.types.ts`

**What to do:**

The `receive` field on `EventFlow` is a triple-curried function that's confusing for AI:
```typescript
readonly receive: (eventStore: {...}) => (eventInputArgs: ...) => Promise<...>;
```

This field is used by downstream code to create "bound" event dispatchers. Add a JSDoc deprecation notice:

```typescript
/**
 * @deprecated The `receive` pattern will be replaced in v5.
 * Instead of `const send = MyEvent.receive(eventStore); await send(input);`
 * use `await eventStore.submit(MyEvent, input);` directly.
 */
readonly receive: ...;
```

Do NOT remove it in v4. Just deprecate.

---

### Task 7: Update mocks, examples, and documentation

**Files to update:**
- `packages/event-store/src/mocks/*.ts` — add `kind` field to all mock EventFlows
- `examples/example-domain-pacakges/` — add `kind` field to example EventFlows (if they exist)
- `docs/event-flow-reference.md` — document the `kind` discriminant and `submit()` API
- `docs/architecture.md` — update with v4 changes

**For each mock file**, add `kind: 'simple'` or `kind: 'aggregate'` as appropriate.

---

### Task 8: Version bump and changelog

1. Update `packages/event-store/package.json` version to `4.0.0`
2. Update `packages/event-store-types/package.json` version to `4.0.0`
3. Update the dependency version in `packages/event-store/package.json`:
   ```json
   "@schemeless/event-store-types": "^4.0.0"
   ```

---

## Migration Guide for Downstream Users

Include this in the release notes / docs:

### Breaking Changes in v4

1. **Error types changed**: Catch blocks may need updating if you match on `error.message` strings.
   - `Error('No EventFlow found...')` → `FlowNotFoundError`
   - Validation errors → `ValidationError`
   - Aggregate errors → `AggregateError`

2. **No breaking behavioral changes** in v4. All existing code works without modification.

### Recommended Migration Steps

1. Add `kind: 'simple'` or `kind: 'aggregate'` to your EventFlow definitions
2. Replace `const send = MyEvent.receive(eventStore); send(input)` with `eventStore.submit(MyEvent, input)`
3. Replace `eventStore.output$.subscribe(...)` with `eventStore.on('processed', handler)`
4. Update error handling to use structured error types (`instanceof ValidationError`, etc.)

---

## Verification

After all changes:

1. `cd packages/event-store-types && yarn test` — all type tests pass
2. `cd packages/event-store && yarn test` — all existing + new tests pass
3. Manually verify that a flow WITHOUT `kind` still works (backwards compatibility)
4. Manually verify that a flow WITH `kind: 'aggregate'` gets correct TypeScript narrowing
