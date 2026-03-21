# V5 Plan: Internal Architecture Rewrite — Remove RxJS, Eliminate Global State

## Goal

Rewrite the internal implementation of `@schemeless/event-store` to be maximally understandable by AI programming tools. The external API (established in V4) remains unchanged. This is about making the **internals** simple enough that an AI can confidently modify, debug, and extend the library.

## Prerequisites

- **V4 must be completed first** (see `docs/PLAN-V4.md`)
- Read this entire document before starting
- Run `yarn test` in `packages/event-store` to verify all V4 tests pass
- Understand the current architecture by reading these files in order:
  1. `packages/event-store/src/makeEventStore.ts` — the main factory
  2. `packages/event-store/src/queue/makeMainQueue.ts` — main queue with RxJS
  3. `packages/event-store/src/queue/RxQueue.ts` — the RxJS queue wrapper
  4. `packages/event-store/src/operators/applyRootEventAndCollectSucceed.ts` — event tree processing
  5. `packages/event-store/src/eventLifeCycle/aggregateStateCache.ts` — global mutable state

## Context: Why V5

### Root Cause Analysis

The current internals have three coupled problems that make AI-assisted maintenance unreliable:

#### Problem 1: RxJS as control flow backbone

The event processing pipeline is implemented as RxJS operator chains spread across 6+ files:

```
makeMainQueue.ts:
  merge(...partitionQueues.map(pq => pq.process$)).pipe(
    mergeMap(({ task, done }) => {
      const applyQueue = makeApplyQueue();
      combineLatest([
        applyRootEventAndCollectSucceed(applyQueue),  // scan + mergeMap in another file
        racedQueueFailedOrDrained(applyQueue),         // race in another file
      ]).pipe(
        take(1),
        cleanupAndCancelFailedEvent(),                 // concatMap + mergeMap in another file
        finalize(() => applyQueue.destroy()),
      )
    })
  )
```

Problems for AI:
- `scan` accumulator lifecycle is invisible at the call site
- `combineLatest` timing depends on when each source emits — AI can't reason about this without understanding both sources
- `take(1)` semantics depend on what combineLatest emits first
- `mergeMap(async ...)` inside `mergeMap` creates nested async-observable boundaries that are extremely hard to debug
- Error propagation through RxJS pipes is non-obvious (does `error` terminate the stream or get caught?)

#### Problem 2: Global aggregate state cache

`aggregateStateCache` in `packages/event-store/src/eventLifeCycle/aggregateStateCache.ts` is a **module-level singleton** with two Maps:

```typescript
const byEventId = new Map<string, unknown>();      // Written in apply.ts:46,47,53,62
const byAggregateKey = new Map<string, unknown>();  // Written in apply.ts:46,47
                                                     // Read in validate.ts:26-44, apply.ts:29-47
                                                     // Cleared in makeReceive.ts:43,60,70
```

This creates action-at-a-distance: modifying `apply.ts` can break `validate.ts` or `makeReceive.ts`. The cache lifetime spans the entire event processing pipeline but is cleaned up in a completely different module. If cleanup fails (e.g., an exception in the wrong place), the cache leaks and subsequent events see stale state.

#### Problem 3: RxQueue reimplements async processing with microtask hacks

`RxQueue.ts` contains a `createRxQueue` function that:
1. Creates an `AsyncQueue` (manual pump loop with microtask scheduling)
2. Wraps it in RxJS Subjects
3. Uses **double microtask deferral** (`Promise.resolve().then(() => Promise.resolve().then(...))`) to work around RxJS operator timing

This exists because the actual need — "process tasks sequentially within a partition" — is trivially solved by `async/await` but was forced into an RxJS-shaped hole.

---

## Architecture Overview: Before and After

### Before (current)

```
makeEventStore
  ├── mainQueue (createRxQueue × N partitions)
  │     ├── process$ → mergeMap → combineLatest([
  │     │     applyRootEventAndCollectSucceed (scan + mergeMap)
  │     │     racedQueueFailedOrDrained (race)
  │     │   ]) → cleanupAndCancelFailedEvent
  │     └── applyQueue (createRxQueue, FILO, per-event-tree)
  ├── sideEffectQueue (createRxQueue × N partitions)
  │     └── process$ → mergeMap(async ...)
  ├── observerQueue (createRxQueue, created per-receive-call)
  │     └── process$ → mergeMap(async ...)
  ├── aggregateStateCache (global Map × 2)
  └── output$ (merge of mainQueue + sideEffectQueue processed$)

Files involved in processing a single event:
  makeEventStore.ts → makeMainQueue.ts → RxQueue.ts → makeApplyQueue.ts →
  applyRootEventAndCollectSucceed.ts → defaultEventCreator.ts →
  makeValidateAndApply.ts → validate.ts → aggregateStateCache.ts →
  preApply.ts → apply.ts → aggregateStateCache.ts (again) →
  createConsequentEvents.ts → racedQueueFailedOrDrained.ts →
  cleanupAndCancelFailedEvent.ts → makeSideEffectQueue.ts →
  makeReceive.ts → makeObserverQueue.ts → aggregateStateCache.ts (cleanup)
```

### After (V5)

```
makeEventStore
  ├── EventProcessor (class, owns partitions)
  │     ├── PartitionWorker[] (simple async serial executor)
  │     └── processEventTree() (pure async function, no global state)
  │           ├── createEvent()
  │           ├── upcast()
  │           ├── validate() — receives state as parameter
  │           ├── preApply()
  │           ├── apply() — receives state as parameter, returns new state
  │           └── loop for consequent events (explicit depth limit)
  ├── SideEffectRunner (simple async, with retry and depth limit)
  ├── ObserverRunner (simple async, priority-sorted)
  └── shutdown (Promise-based, no RxJS subscription management)

Files involved in processing a single event:
  makeEventStore.ts → EventProcessor.ts → processEventTree.ts →
  createEvent.ts, upcast.ts, validate.ts, preApply.ts, apply.ts
```

---

## Task List (in order)

### Task 1: Create `PartitionWorker` class

**Create file:** `packages/event-store/src/pipeline/PartitionWorker.ts`

```typescript
/**
 * Simple async serial task executor.
 * Tasks within a partition are processed one at a time, in order.
 * Replaces RxQueue + createRxQueue (~200 lines) with ~40 lines.
 */
export class PartitionWorker {
  private queue: Array<{
    fn: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (reason: any) => void;
  }> = [];
  private running = false;
  private _paused = false;
  private _destroyed = false;

  constructor(public readonly id: string | number) {}

  /**
   * Enqueue a task and return a promise that resolves when the task completes.
   * Tasks are processed in FIFO order, one at a time.
   */
  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    if (this._destroyed) {
      throw new Error(`PartitionWorker ${this.id} is destroyed`);
    }
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.pump();
    });
  }

  pause(): void {
    this._paused = true;
  }

  resume(): void {
    this._paused = false;
    this.pump();
  }

  /**
   * Returns a promise that resolves when all currently queued tasks are done.
   */
  async drain(): Promise<void> {
    if (this.queue.length === 0 && !this.running) return;
    return new Promise<void>((resolve) => {
      const check = () => {
        if (this.queue.length === 0 && !this.running) {
          resolve();
        } else {
          // Re-check after current task completes
          setTimeout(check, 1);
        }
      };
      check();
    });
  }

  destroy(): void {
    this._destroyed = true;
    // Reject any pending tasks
    for (const item of this.queue) {
      item.reject(new Error(`PartitionWorker ${this.id} destroyed`));
    }
    this.queue = [];
  }

  get pending(): number {
    return this.queue.length + (this.running ? 1 : 0);
  }

  private async pump(): Promise<void> {
    if (this.running || this._paused || this._destroyed) return;
    this.running = true;

    while (this.queue.length > 0 && !this._paused && !this._destroyed) {
      const item = this.queue.shift()!;
      try {
        const result = await item.fn();
        item.resolve(result);
      } catch (err) {
        item.reject(err);
      }
    }

    this.running = false;
  }
}
```

**Tests to create:** `packages/event-store/src/pipeline/PartitionWorker.test.ts`
- Test serial execution (tasks complete in order)
- Test concurrent enqueue (multiple callers, still serial)
- Test pause/resume
- Test drain waits for all tasks
- Test destroy rejects pending tasks
- Test error in one task doesn't break subsequent tasks

---

### Task 2: Create `processEventTree` pure async function

**Create file:** `packages/event-store/src/pipeline/processEventTree.ts`

This is the **core logic** of the library: take an event input, recursively apply it and all consequent events, return the results. No global state, no RxJS.

```typescript
import type {
  BaseEvent,
  CreatedEvent,
  EventFlowMap,
  IEventStoreEntity,
} from '@schemeless/event-store-types';
import { AggregateError } from '@schemeless/event-store-types';
import { defaultEventCreator } from '../operators/defaultEventCreator';
import { getEventFlow } from '../operators/getEventFlow';
import { isAggregateEventFlow } from '../operators/isAggregateEventFlow';
import { upcast } from '../eventLifeCycle/upcast';
import { logEvent } from '../util/logEvent';

export interface AggregateLoader {
  <State>(
    domain: string,
    identifier: string,
    reducer: (state: State, event: IEventStoreEntity) => State,
    initialState: State
  ): Promise<{ state: State; sequence: number }>;
}

export interface ProcessEventTreeOptions {
  maxDepth?: number;
}

export interface ProcessedEvent<Payload = any> {
  event: CreatedEvent<Payload>;
  /** Aggregate state after apply, if this was an aggregate event. undefined for simple events. */
  aggregateState?: unknown;
  /** Aggregate domain, for cache keying */
  aggregateDomain?: string;
  /** Aggregate identifier, for cache keying */
  aggregateIdentifier?: string;
}

export interface ProcessResult {
  events: ProcessedEvent[];
}

/**
 * Process an event and all its consequent events depth-first.
 *
 * This is a pure async function with no side effects beyond calling
 * the EventFlow lifecycle hooks (validate, preApply, apply, createConsequentEvents).
 *
 * Aggregate state is passed through the `applied` array — no global cache needed.
 */
export async function processEventTree(
  rootInput: BaseEvent<any>,
  eventFlowMap: EventFlowMap,
  getAggregate: AggregateLoader | undefined,
  options: ProcessEventTreeOptions = {}
): Promise<ProcessResult> {
  const { maxDepth = 10 } = options;
  const applied: ProcessedEvent[] = [];

  // Explicit stack for depth-first traversal
  const stack: Array<{
    input: BaseEvent<any>;
    causalEvent?: CreatedEvent<any>;
    depth: number;
  }> = [{ input: rootInput, depth: 0 }];

  while (stack.length > 0) {
    const { input, causalEvent, depth } = stack.pop()!;

    if (depth > maxDepth) {
      throw new Error(
        `Event tree exceeded max depth ${maxDepth}. Root: ${rootInput.domain}/${rootInput.type}. ` +
        `This usually indicates a circular consequent event chain.`
      );
    }

    // 1. Create event (assign ID, timestamps, causation/correlation chain)
    const event = defaultEventCreator(input, causalEvent);
    const flow = getEventFlow(eventFlowMap)(event);

    // 2. Upcast (schema migration)
    const upcastedEvent = await upcast(flow, event);

    // 3. Load aggregate state if needed
    let aggregateState: unknown = undefined;
    let aggregateDomain: string | undefined;
    let aggregateIdentifier: string | undefined;

    if (isAggregateEventFlow(flow)) {
      aggregateIdentifier = flow.aggregate.getIdentifier?.(upcastedEvent) ?? upcastedEvent.identifier;
      aggregateDomain = flow.domain;

      if (!aggregateIdentifier) {
        throw new AggregateError(
          { domain: flow.domain, type: flow.type },
          'no_identifier'
        );
      }

      // Look for the most recent state in already-applied events (local context)
      aggregateState = findLatestAggregateState(applied, flow.domain, aggregateIdentifier);

      if (aggregateState === undefined) {
        // Load from repository
        if (!getAggregate) {
          throw new AggregateError(
            { domain: flow.domain, type: flow.type },
            'no_loader'
          );
        }
        const result = await getAggregate(
          flow.domain,
          aggregateIdentifier,
          flow.aggregate.reducer,
          flow.aggregate.initialState
        );
        aggregateState = result.state;
      }
    }

    // 4. Validate
    if (flow.validate) {
      if (isAggregateEventFlow(flow)) {
        const error = await flow.validate(upcastedEvent, aggregateState);
        if (error instanceof Error) throw error;
      } else {
        const error = await flow.validate(upcastedEvent);
        if (error instanceof Error) throw error;
      }
    }
    logEvent(upcastedEvent, '☑️', 'verified');

    // 5. PreApply
    let finalEvent = upcastedEvent;
    if (flow.preApply) {
      const preApplied = await flow.preApply(upcastedEvent);
      if (preApplied) finalEvent = preApplied;
    }

    // 6. Apply
    if (isAggregateEventFlow(flow)) {
      if (flow.apply) {
        const nextState = await flow.apply(finalEvent, aggregateState);
        if (typeof nextState === 'undefined') {
          throw new AggregateError(
            { domain: flow.domain, type: flow.type },
            'apply_must_return_state'
          );
        }
        aggregateState = nextState;
      }
    } else {
      if (flow.apply) {
        await flow.apply(finalEvent);
      }
    }
    logEvent(finalEvent, '✅️', 'Apply');

    // 7. Record applied event
    applied.push({
      event: finalEvent,
      aggregateState,
      aggregateDomain,
      aggregateIdentifier,
    });

    // 8. Generate consequent events and push onto stack (reverse order for correct DFS)
    if (flow.createConsequentEvents) {
      const consequents = await flow.createConsequentEvents(finalEvent);
      if (consequents && consequents.length > 0) {
        // Inject schemaVersion into consequent events
        for (let i = consequents.length - 1; i >= 0; i--) {
          const ce = consequents[i];
          const ceFlow = getEventFlow(eventFlowMap)(ce as any);
          ce.meta = {
            ...(ce.meta || {}),
            schemaVersion: ceFlow?.schemaVersion || 1,
          };
          stack.push({
            input: ce,
            causalEvent: finalEvent,
            depth: depth + 1,
          });
        }
      }
    }
  }

  return { events: applied };
}

/**
 * Find the most recent aggregate state for a given domain+identifier
 * from the already-processed events in this tree.
 */
function findLatestAggregateState(
  applied: ProcessedEvent[],
  domain: string,
  identifier: string
): unknown | undefined {
  for (let i = applied.length - 1; i >= 0; i--) {
    const p = applied[i];
    if (
      p.aggregateDomain === domain &&
      p.aggregateIdentifier === identifier &&
      p.aggregateState !== undefined
    ) {
      return p.aggregateState;
    }
  }
  return undefined;
}
```

**Tests to create:** `packages/event-store/src/pipeline/processEventTree.test.ts`
- Test simple event (no aggregate, no consequents)
- Test aggregate event (state loaded from getAggregate, returned in result)
- Test consequent events (depth-first order)
- Test depth limit exceeded throws
- Test aggregate state reuse across events in same tree
- Test validation failure throws and stops processing
- Test preApply transforms event
- Test upcast is called for old schema versions

---

### Task 3: Create `SideEffectRunner`

**Create file:** `packages/event-store/src/pipeline/SideEffectRunner.ts`

```typescript
import type { BaseEvent, CreatedEvent, EventFlowMap } from '@schemeless/event-store-types';
import { getEventFlow } from '../operators/getEventFlow';
import { logEvent } from '../util/logEvent';
import { logger } from '../util/logger';

export interface SideEffectRunnerOptions {
  maxRetries?: number;
}

export interface SideEffectResult {
  event: CreatedEvent<any>;
  newEvents: BaseEvent<any>[];
  status: 'done' | 'no_side_effect';
}

/**
 * Runs side effects for a list of processed events.
 * Returns any new events generated by side effects.
 *
 * Retry logic is per-event, controlled by flow.meta.sideEffectFailedRetryAllowed.
 */
export async function runSideEffects(
  events: CreatedEvent<any>[],
  eventFlowMap: EventFlowMap
): Promise<SideEffectResult[]> {
  const results: SideEffectResult[] = [];

  for (const event of events) {
    const flow = getEventFlow(eventFlowMap)(event);

    if (!flow.sideEffect) {
      logEvent(event, '🌠', 'SideEffect:N/A');
      results.push({ event, newEvents: [], status: 'no_side_effect' });
      continue;
    }

    const maxRetries = flow.meta?.sideEffectFailedRetryAllowed ?? 0;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const nextEvents = await flow.sideEffect(event);
        logEvent(event, '🌠', 'SideEffect:Done');
        results.push({
          event,
          newEvents: Array.isArray(nextEvents) ? nextEvents : [],
          status: 'done',
        });
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        logger.error(`Side effect failed (attempt ${attempt + 1}/${maxRetries + 1}): ${error}`);
        if (attempt < maxRetries) {
          logEvent(event, '🌠', `SE:Retry:${attempt}`);
        }
      }
    }

    if (lastError) {
      logEvent(event, '🌠', `SE:FAILED`);
      // Side effect failure is non-fatal — event is already persisted
      results.push({ event, newEvents: [], status: 'done' });
    }
  }

  return results;
}
```

**Tests to create:** `packages/event-store/src/pipeline/SideEffectRunner.test.ts`
- Test side effect runs and returns new events
- Test no side effect skips gracefully
- Test retry on failure (respects sideEffectFailedRetryAllowed)
- Test retry succeeds on 2nd attempt
- Test all retries exhausted — no throw, just logged

---

### Task 4: Create `ObserverRunner`

**Create file:** `packages/event-store/src/pipeline/ObserverRunner.ts`

```typescript
import type {
  AggregateEventObserver,
  CreatedEvent,
  SuccessEventObserver,
} from '@schemeless/event-store-types';
import { logEvent } from '../util/logEvent';
import { logger } from '../util/logger';

type Observer = SuccessEventObserver<any> | AggregateEventObserver<any, any>;

interface ObserverMap {
  [domainType: string]: Observer[];
}

function buildObserverMap(observers: Observer[]): ObserverMap {
  const map: ObserverMap = {};
  for (const observer of observers) {
    for (const filter of observer.filters) {
      const key = `${filter.domain}__${filter.type}`;
      if (!map[key]) map[key] = [];
      map[key].push(observer);
    }
  }
  return map;
}

export interface ProcessedEventWithState {
  event: CreatedEvent<any>;
  aggregateState?: unknown;
}

/**
 * Run observers for a batch of processed events.
 * Observers are applied in priority order.
 * Fire-and-forget observers are not awaited.
 */
export async function runObservers(
  events: ProcessedEventWithState[],
  observers: Observer[]
): Promise<void> {
  if (observers.length === 0) return;

  const observerMap = buildObserverMap(observers);

  for (const { event, aggregateState } of events) {
    const key = `${event.domain}__${event.type}`;
    const matching = observerMap[key];
    if (!matching || matching.length === 0) {
      logEvent(event, '👀', 'No observers');
      continue;
    }

    // Sort by priority (ascending)
    const sorted = [...matching].sort((a, b) => a.priority - b.priority);

    for (const observer of sorted) {
      const isAggregate = (observer as AggregateEventObserver<any, any>).aggregate === true;

      const applyFn = async () => {
        if (isAggregate) {
          if (aggregateState === undefined) {
            throw new Error(
              `Aggregate observer for ${event.domain}/${event.type} expected aggregate state but none was available`
            );
          }
          await (observer as AggregateEventObserver<any, any>).apply?.(event, aggregateState);
        } else {
          await (observer as SuccessEventObserver<any>).apply?.(event);
        }
      };

      if (observer.fireAndForget) {
        applyFn().catch((err) => {
          logger.error(`Fire-and-forget observer failed: ${err}`);
        });
      } else {
        await applyFn();
      }
    }

    logEvent(event, '👀', 'Applied observers');
  }
}
```

**Tests to create:** `packages/event-store/src/pipeline/ObserverRunner.test.ts`
- Test observers called in priority order
- Test aggregate observer receives state
- Test fire-and-forget observer doesn't block
- Test no matching observers is a no-op
- Test observer error propagates (for non-fire-and-forget)

---

### Task 5: Create `EventProcessor` class

**Create file:** `packages/event-store/src/pipeline/EventProcessor.ts`

This ties everything together: partition routing, processEventTree, store, side effects, observers.

```typescript
import type {
  AggregateEventObserver,
  BaseEvent,
  BaseEventInput,
  CreatedEvent,
  EventFlow,
  EventFlowMap,
  IEventStoreRepo,
  SuccessEventObserver,
} from '@schemeless/event-store-types';
import { PartitionWorker } from './PartitionWorker';
import { processEventTree, AggregateLoader, ProcessedEvent } from './processEventTree';
import { runSideEffects } from './SideEffectRunner';
import { runObservers, ProcessedEventWithState } from './ObserverRunner';
import { registerEventFlowTypes } from '../operators/registerEventFlowTypes';
import { getPartitionIndex } from '../queue/shardUtils';
import { logEvent } from '../util/logEvent';
import { EventOutput } from '../EventStore.types';

export interface EventProcessorOptions {
  mainConcurrency?: number;
  sideEffectConcurrency?: number;
  observerConcurrency?: number;
  maxEventDepth?: number;
  maxSideEffectCascadeDepth?: number;
}

export class EventProcessor {
  private partitions: PartitionWorker[];
  private sideEffectPartitions: PartitionWorker[];
  private eventFlowMap: EventFlowMap;
  private eventHandlers: Array<(output: EventOutput) => void> = [];
  private _shutdown = false;

  constructor(
    private repo: IEventStoreRepo,
    eventFlows: EventFlow[],
    private observers: Array<SuccessEventObserver<any> | AggregateEventObserver<any, any>>,
    private getAggregate: AggregateLoader | undefined,
    private options: EventProcessorOptions = {}
  ) {
    const { mainConcurrency = 1, sideEffectConcurrency = 1 } = options;

    this.eventFlowMap = registerEventFlowTypes({}, eventFlows);

    this.partitions = Array.from(
      { length: mainConcurrency },
      (_, i) => new PartitionWorker(`main-${i}`)
    );

    this.sideEffectPartitions = Array.from(
      { length: sideEffectConcurrency },
      (_, i) => new PartitionWorker(`sideEffect-${i}`)
    );
  }

  /**
   * Submit an event for full processing:
   * 1. Route to partition (by shard key)
   * 2. Process event tree (validate → apply → consequent events)
   * 3. Persist all events
   * 4. Run side effects (may cascade new events)
   * 5. Run observers
   */
  async submit(
    flow: EventFlow,
    input: BaseEventInput<any>
  ): Promise<[CreatedEvent<any>, ...Array<CreatedEvent<any>>]> {
    if (this._shutdown) {
      throw new Error('EventProcessor is shut down');
    }

    const event: BaseEvent<any> = {
      ...input,
      domain: flow.domain,
      type: flow.type,
      created: input.created || undefined,
      meta: {
        ...(input.meta || {}),
        schemaVersion: flow.schemaVersion || 1,
      },
    };

    const partition = this.getPartition(event);
    const worker = this.partitions[partition];

    return worker.enqueue(async () => {
      // 1. Process event tree
      const result = await processEventTree(
        event,
        this.eventFlowMap,
        this.getAggregate,
        { maxDepth: this.options.maxEventDepth }
      );

      const createdEvents = result.events.map((p) => p.event);

      try {
        // 2. Persist
        await this.repo.storeEvents(createdEvents);

        // 3. Notify success
        this.notifyHandlers(createdEvents, 'success');

        // 4. Side effects (in side effect partition for ordering)
        await this.runSideEffectsInPartition(createdEvents);

        // 5. Observers
        const eventsWithState: ProcessedEventWithState[] = result.events.map((p) => ({
          event: p.event,
          aggregateState: p.aggregateState,
        }));
        await runObservers(eventsWithState, this.observers);

        return createdEvents as [CreatedEvent<any>, ...Array<CreatedEvent<any>>];
      } catch (err) {
        // On failure, cancel applied events
        await this.cancelAppliedEvents(result.events);
        this.notifyHandlers(createdEvents, 'error');
        throw err;
      }
    });
  }

  /**
   * Push a raw BaseEvent (used internally by side effects).
   */
  async pushRaw(event: BaseEvent<any>): Promise<void> {
    const partition = this.getPartition(event);
    const worker = this.partitions[partition];

    await worker.enqueue(async () => {
      const result = await processEventTree(
        event,
        this.eventFlowMap,
        this.getAggregate,
        { maxDepth: this.options.maxEventDepth }
      );

      const createdEvents = result.events.map((p) => p.event);
      await this.repo.storeEvents(createdEvents);
      this.notifyHandlers(createdEvents, 'success');

      await this.runSideEffectsInPartition(createdEvents);

      const eventsWithState: ProcessedEventWithState[] = result.events.map((p) => ({
        event: p.event,
        aggregateState: p.aggregateState,
      }));
      await runObservers(eventsWithState, this.observers);
    });
  }

  onProcessed(handler: (output: EventOutput) => void): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx !== -1) this.eventHandlers.splice(idx, 1);
    };
  }

  async shutdown(timeout = 5000): Promise<void> {
    this._shutdown = true;

    const drainPromise = (async () => {
      // Drain all partitions
      await Promise.all(this.partitions.map((p) => p.drain()));
      await Promise.all(this.sideEffectPartitions.map((p) => p.drain()));

      // Destroy all workers
      for (const p of [...this.partitions, ...this.sideEffectPartitions]) {
        p.destroy();
      }

      // Close repo if it supports it
      if (this.repo.close) {
        await this.repo.close();
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`Shutdown timeout after ${timeout}ms`)), timeout);
      (timer as any).unref?.();
    });

    await Promise.race([drainPromise, timeoutPromise]);
  }

  // --- Private ---

  private getPartition(event: BaseEvent<any>): number {
    const flow = this.eventFlowMap[`${event.domain}__${event.type}`];
    const key = flow?.getShardKey?.(event) ?? event.identifier ?? '';
    if (!key) return 0;
    return getPartitionIndex(key, this.partitions.length);
  }

  private async runSideEffectsInPartition(events: CreatedEvent<any>[]): Promise<void> {
    const results = await runSideEffects(events, this.eventFlowMap);

    for (const result of results) {
      for (const newEvent of result.newEvents) {
        // Cascade: new events from side effects go through the full pipeline
        await this.pushRaw(newEvent);
      }
    }
  }

  private async cancelAppliedEvents(processed: ProcessedEvent[]): Promise<void> {
    for (const { event } of processed) {
      try {
        const flow = this.eventFlowMap[`${event.domain}__${event.type}`];
        if (flow?.cancelApply) {
          await flow.cancelApply(event);
        }
      } catch (e) {
        // Best-effort cancel
      }
    }
  }

  private notifyHandlers(events: CreatedEvent<any>[], status: 'success' | 'error'): void {
    for (const event of events) {
      const output: EventOutput = {
        event,
        state: status === 'success' ? 'Event:success' as any : 'Event:invalid' as any,
      };
      for (const handler of this.eventHandlers) {
        try { handler(output); } catch (e) { /* ignore handler errors */ }
      }
    }
  }
}
```

**Tests to create:** `packages/event-store/src/pipeline/EventProcessor.test.ts`
- Test submit processes and persists event
- Test submit with aggregate event
- Test submit with consequent events
- Test submit with side effects generating new events
- Test partition routing (same shard key → same partition → serial)
- Test different shard keys → parallel
- Test shutdown drains all queues
- Test shutdown timeout
- Test observer execution after persist

---

### Task 6: Rewrite `makeEventStore` to use `EventProcessor`

**File to modify:** `packages/event-store/src/makeEventStore.ts`

**What to do:**

Replace the entire RxJS-based implementation with `EventProcessor`. The returned `EventStore` object must maintain API compatibility with V4.

```typescript
import { EventProcessor } from './pipeline/EventProcessor';
import { makeRevert } from './revert/makeRevert';
import { makeReplay } from './makeReplay';
import { registerEventFlowTypes } from './operators/registerEventFlowTypes';
import { isAggregateEventFlow } from './operators/isAggregateEventFlow';
import { Subject } from 'rxjs';  // Only for deprecated output$ compatibility
import type { EventStore, EventStoreOptions, EventOutput, AggregateResult } from './EventStore.types';
import type {
  AggregateEventObserver,
  EventFlow,
  EventFlowMap,
  IEventStoreRepo,
  SuccessEventObserver,
  IEventStoreEntity,
} from '@schemeless/event-store-types';

export const makeEventStore =
  (eventStoreRepo: IEventStoreRepo, options: EventStoreOptions = {}) =>
  async (
    eventFlows: EventFlow[],
    successEventObservers: Array<SuccessEventObserver<any> | AggregateEventObserver<any, any>> = []
  ): Promise<EventStore> => {
    const {
      mainQueueConcurrent = 1,
      sideEffectQueueConcurrent = 1,
      observerQueueConcurrent = 1,
    } = options;

    await eventStoreRepo.init();

    // Capability checks (same as before)
    const declaredAggregateCapability = eventStoreRepo.capabilities?.aggregate;
    const capabilities: EventStore['capabilities'] = {
      aggregate: declaredAggregateCapability ?? !!eventStoreRepo.getStreamEvents,
    };

    const hasAggregateEventFlow = eventFlows.some(isAggregateEventFlow);
    if (hasAggregateEventFlow && !capabilities.aggregate) {
      const flow = eventFlows.find(isAggregateEventFlow);
      throw new Error(
        `AggregateEventFlow "${flow?.domain}/${flow?.type}" requires adapter with getStreamEvents() support.`
      );
    }

    // Build getAggregate (same logic as before)
    const getAggregate = /* ... same implementation ... */;

    // Build EventFlowMap for revert
    const eventFlowMap: EventFlowMap = {};
    for (const flow of eventFlows) {
      eventFlowMap[`${flow.domain}__${flow.type}`] = flow;
    }

    // Create processor
    const processor = new EventProcessor(
      eventStoreRepo,
      eventFlows,
      successEventObservers,
      capabilities.aggregate ? getAggregate : undefined,
      {
        mainConcurrency: mainQueueConcurrent,
        sideEffectConcurrency: sideEffectQueueConcurrent,
        observerConcurrency: observerQueueConcurrent,
      }
    );

    // Deprecated output$ compatibility via Subject
    const outputSubject = new Subject<EventOutput>();
    const unsubOutput = processor.onProcessed((output) => outputSubject.next(output));

    // Revert
    const { canRevert, previewRevert, revert } = makeRevert({
      repo: eventStoreRepo,
      eventFlowMap,
      storeEvents: (events) => eventStoreRepo.storeEvents(events),
    });

    // Submit (new V4+ API)
    const submit: EventStore['submit'] = (flow, input) => processor.submit(flow, input);

    // Receive (deprecated, V3 compat)
    const receiveHandler = (flow: EventFlow) => (input: any) => processor.submit(flow, input);
    const receive = () => receiveHandler;

    const store: EventStore = {
      // New API
      submit,
      on: (event, handler) => {
        if (event !== 'processed') throw new Error(`Unknown event: ${event}`);
        return processor.onProcessed(handler);
      },

      // Deprecated but maintained for V4 compat
      mainQueue: null as any,  // V5: no longer exposed
      sideEffectQueue: null as any,  // V5: no longer exposed
      receive: receive as any,
      output$: outputSubject.asObservable(),

      // Unchanged
      replay: makeReplay(eventFlows, successEventObservers, eventStoreRepo),
      eventStoreRepo,
      capabilities,
      getAggregate,
      canRevert,
      previewRevert,
      revert,

      shutdown: async (timeout = 5000) => {
        await processor.shutdown(timeout);
        unsubOutput();
        outputSubject.complete();
      },
    };

    return store;
  };
```

**Important:** The `receive` function in V5 needs special handling. In V4, `receive` is `makeReceive(mainQueue)(flow)(input)`. In V5, it should delegate to `processor.submit`. The shape must match: `receive(flow)(input)`.

Look at the current `makeReceive.ts` to understand the exact signature:
```typescript
// Current: makeReceive returns (flow) => (input) => Promise<[CreatedEvent, ...]>
// V5: receive = (flow) => (input) => processor.submit(flow, input)
```

**Note about `mainQueue` and `sideEffectQueue`:** In V5, these are no longer meaningful. Set them to a minimal stub or `null as any` with a getter that throws:

```typescript
get mainQueue() {
  throw new Error('mainQueue is removed in v5. Use submit() instead.');
},
```

Or, if tests reference `mainQueue`, provide a minimal compatible shim.

---

### Task 7: Update `makeReplay` to not use global cache

**File to modify:** `packages/event-store/src/makeReplay.ts`

The current `makeReplay` already uses **local** Maps for aggregate state (not the global cache). This is good — it was implemented correctly. However, it still uses `makeObserverQueue` which depends on RxJS.

**What to do:**

1. Replace `makeObserverQueue` usage with the new `runObservers` function:

```typescript
// Before:
const observerQueue = makeObserverQueue(successEventObservers, { ... });
observerQueue.push(currentEvent);

// After:
await runObservers(
  [{ event: currentEvent, aggregateState: nextState }],
  successEventObservers
);
```

2. Remove the RxJS subscription management (`subscription`, `processed$`, `drained$`).

3. The rest of the replay logic (iterating events, computing aggregate state) remains the same.

---

### Task 8: Delete obsolete files

After Tasks 1-7 are complete and all tests pass, delete these files:

**Queue files (replaced by PartitionWorker):**
- `packages/event-store/src/queue/RxQueue.ts`
- `packages/event-store/src/queue/makeApplyQueue.ts`
- `packages/event-store/src/queue/makeMainQueue.ts`
- `packages/event-store/src/queue/makeSideEffectQueue.ts`
- `packages/event-store/src/queue/makeObserverQueue.ts`
- `packages/event-store/src/queue/makeReceive.ts`
- `packages/event-store/src/queue/ShardedQueue.ts` (if exists and unused)

**Operator files (logic moved into processEventTree):**
- `packages/event-store/src/operators/applyRootEventAndCollectSucceed.ts`
- `packages/event-store/src/operators/cleanupAndCancelFailedEvent.ts`
- `packages/event-store/src/operators/racedQueueFailedOrDrained.ts`
- `packages/event-store/src/operators/isEventTaskError.ts`

**Global state (eliminated):**
- `packages/event-store/src/eventLifeCycle/aggregateStateCache.ts`

**Lifecycle files (logic moved into processEventTree):**
- `packages/event-store/src/eventLifeCycle/makeValidateAndApply.ts`
- `packages/event-store/src/eventLifeCycle/createConsequentEvents.ts`

**Utility files (no longer needed):**
- `packages/event-store/src/util/completeOn.operator.ts`
- `packages/event-store/src/util/sideEffectFinishedPromise.ts`

**Keep these files (still used):**
- `packages/event-store/src/eventLifeCycle/apply.ts` — may still be used by replay. Check if processEventTree now handles this. If so, can be deleted.
- `packages/event-store/src/eventLifeCycle/validate.ts` — same check.
- `packages/event-store/src/eventLifeCycle/preApply.ts` — same check.
- `packages/event-store/src/eventLifeCycle/upcast.ts` — still used by processEventTree.
- `packages/event-store/src/operators/getEventFlow.ts` — still used.
- `packages/event-store/src/operators/isAggregateEventFlow.ts` — still used.
- `packages/event-store/src/operators/defaultEventCreator.ts` — still used.
- `packages/event-store/src/operators/registerEventFlowTypes.ts` — still used.
- `packages/event-store/src/queue/shardUtils.ts` — still used.
- `packages/event-store/src/revert/makeRevert.ts` — still used, unchanged.
- `packages/event-store/src/util/logger.ts` — still used.
- `packages/event-store/src/util/logEvent.ts` — still used.
- `packages/event-store/src/util/exportImport.ts` — still used.
- `packages/event-store/src/util/ulid.ts` — still used.

---

### Task 9: Delete obsolete test files and create new ones

**Delete these test files (they test deleted modules):**
- `packages/event-store/src/queue/AsyncQueue.test.ts`
- `packages/event-store/src/queue/RxQueue.test.ts`
- `packages/event-store/src/queue/makeMainQueue.test.ts`
- `packages/event-store/src/queue/makeSideEffectQueue.test.ts`
- `packages/event-store/src/queue/makeReceive.test.ts`
- `packages/event-store/src/queue/makeObserverQueue.test.ts`
- `packages/event-store/src/queue/ShardedQueue.concurrency.test.ts`
- `packages/event-store/src/queue/ShardedQueue.stress.test.ts`
- `packages/event-store/src/util/completeOn.operator.test.ts`
- `packages/event-store/src/util/sideEffectFinishedPromise.test.ts`

**Keep these test files (update as needed):**
- `packages/event-store/src/makeEventStore.test.ts` — update to use `submit()` API
- `packages/event-store/src/makeEventStore.shutdown.test.ts` — update
- `packages/event-store/src/aggregate-eventflow.test.ts` — update to use `submit()` API
- `packages/event-store/src/EventStore.snapshot.test.ts` — update
- `packages/event-store/src/EventStore.performance.test.ts` — update (may need rethinking)
- `packages/event-store/src/makeReplay.test.ts` — update
- `packages/event-store/src/revert/makeRevert.test.ts` — no changes needed
- `packages/event-store/src/eventLifeCycle/upcast.test.ts` — no changes needed
- `packages/event-store/src/operators/defaultEventCreator.test.ts` — no changes needed
- `packages/event-store/src/util/exportImport.test.ts` — no changes needed

**New test files to create:**
- `packages/event-store/src/pipeline/PartitionWorker.test.ts`
- `packages/event-store/src/pipeline/processEventTree.test.ts`
- `packages/event-store/src/pipeline/SideEffectRunner.test.ts`
- `packages/event-store/src/pipeline/ObserverRunner.test.ts`
- `packages/event-store/src/pipeline/EventProcessor.test.ts`

---

### Task 10: Remove RxJS and Ramda dependencies

**File to modify:** `packages/event-store/package.json`

After all code changes are done and tests pass:

1. Search the entire `packages/event-store/src/` for any remaining `import` from `rxjs` or `ramda`:
   ```
   grep -r "from 'rxjs" packages/event-store/src/
   grep -r "from 'ramda" packages/event-store/src/
   ```

2. If the only remaining RxJS usage is the deprecated `output$` Subject in `makeEventStore.ts`, that's acceptable. Keep `rxjs` as a dependency for now but document that it will be removed when `output$` is removed.

3. If `ramda` has no remaining usage, remove it from `dependencies`.

4. Run `yarn install` to update lockfile.

---

### Task 11: Version bump

1. Update `packages/event-store/package.json` version to `5.0.0`
2. Update `packages/event-store-types/package.json` version to `5.0.0` (if types changed)
3. Update dependency: `"@schemeless/event-store-types": "^5.0.0"`

---

## New Directory Structure After V5

```
packages/event-store/src/
├── index.ts
├── EventStore.types.ts
├── makeEventStore.ts                    (simplified, delegates to EventProcessor)
├── makeReplay.ts                        (simplified, no RxJS)
├── pipeline/                            (NEW — all processing logic)
│   ├── PartitionWorker.ts               (~40 lines)
│   ├── PartitionWorker.test.ts
│   ├── processEventTree.ts             (~120 lines, the core algorithm)
│   ├── processEventTree.test.ts
│   ├── SideEffectRunner.ts             (~50 lines)
│   ├── SideEffectRunner.test.ts
│   ├── ObserverRunner.ts               (~60 lines)
│   ├── ObserverRunner.test.ts
│   ├── EventProcessor.ts              (~150 lines, ties everything together)
│   └── EventProcessor.test.ts
├── eventLifeCycle/
│   ├── upcast.ts                       (kept)
│   └── upcast.test.ts                  (kept)
├── operators/
│   ├── defaultEventCreator.ts          (kept)
│   ├── defaultEventCreator.test.ts     (kept)
│   ├── getEventFlow.ts                 (kept)
│   ├── isAggregateEventFlow.ts         (kept)
│   └── registerEventFlowTypes.ts       (kept)
├── queue/
│   └── shardUtils.ts                   (kept — djb2 hash, partition index)
├── revert/
│   ├── makeRevert.ts                   (kept, unchanged)
│   ├── makeRevert.test.ts              (kept)
│   └── index.ts                        (kept)
├── mocks/                              (kept, updated for V4/V5 API)
└── util/
    ├── logger.ts                       (kept)
    ├── logEvent.ts                     (kept)
    ├── ulid.ts                         (kept)
    ├── exportImport.ts                 (kept)
    ├── exportImport.test.ts            (kept)
    └── testHelpers.ts                  (updated)
```

## Verification Checklist

After all changes:

- [ ] `yarn test` passes in `packages/event-store`
- [ ] `yarn test` passes in `packages/event-store-types`
- [ ] No `grep -r "aggregateStateCache" packages/event-store/src/` hits (global cache eliminated)
- [ ] No `grep -r "createRxQueue\|AsyncQueue\|RxQueue" packages/event-store/src/` hits outside test files
- [ ] `grep -r "from 'rxjs" packages/event-store/src/` shows only `makeEventStore.ts` (for deprecated output$)
- [ ] The `pipeline/` directory has 100% test coverage for its modules
- [ ] Example domain tests (`examples/example-domain-pacakges`) still pass (may need `submit()` migration)
- [ ] `processEventTree` is a pure function — no module-level state, no globals
- [ ] `PartitionWorker` has no RxJS dependency
- [ ] `SideEffectRunner` and `ObserverRunner` have no RxJS dependency

## Key Behavioral Invariants to Preserve

These behaviors from the current implementation MUST be maintained:

1. **Per-shard ordering**: Events with the same shard key are processed in order
2. **Cross-shard parallelism**: Events with different shard keys can run in parallel
3. **Side effect → new event cascade**: Side effects can generate new events that go through the full pipeline
4. **Observer priority ordering**: Observers are called in ascending priority order
5. **Fire-and-forget observers**: These don't block the main flow
6. **FILO for apply queue**: Consequent events within a tree use depth-first (FILO) processing — this is now handled by the explicit stack in `processEventTree`
7. **Validation failure cancels sibling events**: If any event in the tree fails validation, already-applied siblings get `cancelApply` called
8. **Side effect retry**: Side effects respect `flow.meta.sideEffectFailedRetryAllowed`
9. **Graceful shutdown**: Drain all partitions, then destroy, then close repo
10. **Aggregate state continuity**: Within a single event tree, consequent events targeting the same aggregate see the state from the previous event's apply (not the persisted state)
