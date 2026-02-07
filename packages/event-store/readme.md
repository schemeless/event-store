# @schemeless/event-store

The runtime core that orchestrates event flow execution, persistence, observer notification, and side-effect retries. It glues your `EventFlow` definitions together with an `IEventStoreRepo` implementation and emits every lifecycle outcome through an observable stream.

## Installation

```bash
yarn add @schemeless/event-store
```

You will also need one of the persistence adapters (for example `@schemeless/event-store-adapter-typeorm` or `@schemeless/event-store-adapter-dynamodb`).

## Define event flows

An event flow describes how a domain event is received, validated, applied, and enriched with consequent events or side effects. Each handler is optional, so you can start with a bare minimum and grow behaviour over time.

```ts
import { EventFlow } from '@schemeless/event-store';

export const userRegisteredFlow: EventFlow = {
  domain: 'user',
  type: 'registered',
  receive: (eventStore) => async (eventInput) => eventStore.receive(userRegisteredFlow)(eventInput),
  validate: async (event) => {
    if (!event.payload.email) {
      throw new Error('email is required');
    }
  },
  apply: async (event) => {
    // Update projections, write to read models, etc.
  },
};
```

You can attach additional hooks such as `sideEffect` (retryable asynchronous work) or `createConsequentEvents` (fan out new root events) by setting the corresponding properties on the flow object.

### Creating consequent events

When an event spawns additional events via `createConsequentEvents`, the framework automatically maintains the causal relationship:

```ts
export const orderPlacedFlow: EventFlow = {
  domain: 'order',
  type: 'placed',
  createConsequentEvents: (parentEvent) => [
    {
      domain: 'account',
      type: 'transfer',
      payload: {
        fromAccountId: parentEvent.payload.buyerAccountId,
        toAccountId: parentEvent.payload.sellerAccountId,
        amount: parentEvent.payload.total,
      },
      // No need to set causationId or correlationId
      // The framework handles this automatically:
      // - causationId = parentEvent.id
      // - correlationId = parentEvent.correlationId
    },
  ],
};
```

This ensures all derived events share the same `correlationId` (for grouping) while each maintains a `causationId` pointer to its immediate parent (for chain traversal).

## Build the store

`makeEventStore` wires your repository and flows together, returning queues, a `receive` helper, and a replay function. Success observers are processed on a dedicated queue so long-running reactions do not block the main command pipeline.

```ts
import { makeEventStore, sideEffectFinishedPromise } from '@schemeless/event-store';
import { EventStoreRepo as TypeOrmRepo } from '@schemeless/event-store-adapter-typeorm';

const repo = new TypeOrmRepo({ type: 'sqlite', database: ':memory:' });
const buildStore = makeEventStore(repo);

const eventStore = await buildStore([userRegisteredFlow]);

const [created] = await eventStore.receive(userRegisteredFlow)({
  payload: { id: '123', email: 'user@example.com' },
});

await sideEffectFinishedPromise(eventStore); // Wait until the side-effect queue drains.
```

## Performance & Concurrency

You can configure the concurrency level for the internal queues to optimize throughput. By default, all queues run sequentially (`concurrent: 1`) to guarantee strict ordering.

### Configurable Concurrency

Pass `EventStoreOptions` to `makeEventStore` to enable parallel processing:

```ts
const eventStore = await makeEventStore(repo, {
  mainQueueConcurrent: 5,       // Process 5 main events in parallel
  sideEffectQueueConcurrent: 10, // Process 10 side effects in parallel
  observerQueueConcurrent: 5,    // Process 5 observers in parallel
})([userRegisteredFlow]);
```

> **Warning:** increasing `mainQueueConcurrent` > 1 effectively processes events in parallel. While `better-queue` attempts to respect order, high concurrency may affect strict sequential consistency for dependent events if they arrive simultaneously. Use with caution/testing if your event logic depends on strict global ordering.


### Key-Based Partitioning (Sharding)

To solve race conditions with global parallelism, we support **Key-Based Partitioning**. This ensures events for the same entity (e.g., `userId`) are processed sequentially, while different entities are processed in parallel.

1.  **Define Shard Key**: Implement `getShardKey` in your `EventFlow`:
    ```typescript
    const UserFlow: EventFlow = {
      // ...
      getShardKey: (event) => event.payload.userId,
    };
    ```

2.  **Enable Concurrency**:
    ```typescript
    const store = await makeEventStore(..., {
      mainQueueConcurrent: 10, // 10 parallel shards
    });
    ```

👉 **[Read the Full Migration Guide](MIGRATION.md)** for detailed implementation steps.

## Snapshot Support (Performance)

For aggregates with thousands of events, replaying from the beginning (Event Sourcing) can be slow. Snapshotting solves this by saving the calculated state at a specific point in time.

### Using `getAggregate`

The framework provides a `getAggregate` helper that automatically:
1.  Tries to load a snapshot.
2.  Fetches **only** the events that happened after the snapshot.
3.  Reduces them to get the final state.

```typescript
const { state, sequence } = await eventStore.getAggregate(
  'user',           // domain
  '123',            // identifier
  userReducer,      // your reducer function
  { balance: 0 }    // initial state
);
```

### Adapter Requirements

To enable this feature, your `IEventStoreRepo` adapter must implement:

1.  **`getStreamEvents(domain, identifier, fromSequence)`**:
    - **MUST** use an efficient index (e.g., GSI in DynamoDB, composite index in SQL).
    - **Do NOT** use full table scans.
2.  **`getSnapshot(domain, identifier)`** (Optional but recommended):
    - Returns the latest snapshot.
3.  **`saveSnapshot`** (Optional):
    - Persists a new snapshot.

> **Note:** Even without snapshot support (`getSnapshot` returns null), `getAggregate` is still useful if your adapter implements `getStreamEvents`, as it provides a standard way to reconstruct state.

### `EventStoreOptions` Reference

| property                    | type     | default | description                                                                                                      |
| --------------------------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `mainQueueConcurrent`       | `number` | `1`     | Number of events processed in parallel by the main queue. Set > 1 for high throughput at the cost of strict ordering. |
| `sideEffectQueueConcurrent` | `number` | `1`     | Number of side effects processed in parallel. Safe to increase as side effects are retryable and asynchronous.    |
| `observerQueueConcurrent`   | `number` | `1`     | Number of observers processed in parallel. Safe to increase if observers are independent.                         |


### Fire-and-Forget Observers

For observers that perform non-critical, time-consuming tasks (like sending analytics or notifications) where you don't want to block the main event processing flow, use `fireAndForget: true`.

```ts
const analyticsObserver: SuccessEventObserver = {
  filters: [{ domain: 'user', type: 'registered' }],
  priority: 1,
  fireAndForget: true, // Run asynchronously, do not wait
  apply: async (event) => {
      await sendAnalytics(event);
  },
};
```

- **Non-blocking**: The main `receive()` call returns immediately after persistence, without waiting for this observer.
- **Error Isolation**: If this observer throws an error, it is logged but does **not** fail the main event flow.



The returned object exposes:

- `receive` – enqueues events and persists them once every validation step passes.
- `mainQueue` and `sideEffectQueue` – observable queues that process lifecycle work and retryable side effects.
- `output$` – an RxJS stream of every processed event with a success, invalid, canceled, or side-effect state.
- `replay` – streams stored events back through the flows and success observers, enabling projection rebuilds.

> **Important:** The queues only drain while `output$` has at least one active subscriber. `makeEventStore` keeps an internal subscription alive so processing starts immediately, but if you ever tear that subscription down (for example, when customising the stream in tests) be sure to attach your own subscriber right away or new commands will hang in the queue.

## Observers and replay

Register success observers when constructing the store to react to committed events without interfering with the main execution path. During replays the same observer queue is used, so you can reuse the exact logic for live and historical processing.

```ts
const logObserver = {
  filters: [{ domain: 'user', type: 'registered' }],
  priority: 100,
  apply: async (event) => {
    console.log('User registered:', event.payload.email);
  },
};

const eventStore = await buildStore([userRegisteredFlow], [logObserver]);
await eventStore.replay();
```

`replay` batches historical records, ensures each event is re-applied in chronological order, and pushes them through the observer queue so read models stay consistent after deployments or migrations.

## Graceful Shutdown

To prevent data loss or resource leaks during application shutdown (or testing), use the `shutdown` method. This stops accepting new events, drains existing queues, and closes repository connections.

```ts
// 30 second timeout
await eventStore.shutdown(30000);
```

This is particularly useful for:
- **Jest Tests**: Preventing "Store is not a constructor" or "file after teardown" errors.
- **Kubernetes**: Handling `SIGTERM` signals gracefully.
- **Updates**: Ensuring queues are empty before deploying new versions.

## Cascading Revert

Sometimes you need to undo an event and all its derived effects. The framework provides a built-in **revert** mechanism that traverses the causal chain and generates compensating events.

### Define the compensate hook

Each event flow can define a `compensate` hook that returns one or more compensating events:

```ts
export const orderPlacedFlow: EventFlow = {
  domain: 'order',
  type: 'placed',
  receive: (es) => es.receive(orderPlacedFlow),

  compensate: (originalEvent) => ({
    domain: 'order',
    type: 'voided',
    payload: {
      orderId: originalEvent.payload.orderId,
      reason: 'Reverted via framework',
    },
  }),
};
```

The framework adds metadata to each compensating event (`meta.isCompensating = true`, `meta.compensatesEventId`).

### Check if an event can be reverted

Before attempting a revert, check if the event tree is fully covered:

```ts
const result = await eventStore.canRevert(eventId);

if (!result.canRevert) {
  console.log('Cannot revert:', result.reason);
  console.log('Missing hooks:', result.missingCompensateEvents);
}
```

> **Strict mode:** If any event in the tree (including descendants) lacks a `compensate` hook, the revert will fail. This ensures data consistency.

### Preview a revert

See what would be affected without making changes:

```ts
const preview = await eventStore.previewRevert(eventId);

console.log('Root event:', preview.rootEvent.id);
console.log('Descendants:', preview.descendantEvents.length);
console.log('Total affected:', preview.totalEventCount);
```

### Execute a revert

Revert the event and all its descendants:

```ts
const result = await eventStore.revert(eventId);

console.log('Reverted:', result.revertedEventId);
console.log('Compensation events:', result.compensatingEvents);
console.log('Child results:', result.childResults); // Nested results
```

The revert processes events depth-first, starting from the leaves and working up to the root. This ensures that dependent events are compensated before their parents.

> **Root events only:** Only events without a `causationId` (root events) can be reverted. Attempting to revert intermediate events will throw an error.

## Schema Versioning & Upcasting

To support evolving event schemas over time (e.g., changing a price field from a number to an object), you can define a `schemaVersion` and an `upcast` hook in your `EventFlow`.

### How it works

1.  **Tagging**: New events are automatically tagged with the flow's current `schemaVersion` in `event.meta.schemaVersion`.
2.  **Upcasting**: When an older event (lower version) is processed (during `receive` or `replay`), the `upcast` hook is called to migrate it to the current structure.
3.  **Pipeline**: Upcasting happens **before** validation, so your `validate` and `apply` logic only ever needs to handle the *current* schema version.

### Example

```typescript
interface OrderPlacedPayloadV1 {
  price: number;
}

interface OrderPlacedPayloadV2 {
  price: { amount: number; currency: string };
}

// The flow definition uses the LATEST payload type
export const orderPlacedFlow: EventFlow<OrderPlacedPayloadV2> = {
  domain: 'order',
  type: 'placed',
  
  // 1. Set the current version
  schemaVersion: 2,

  // 2. Define how to migrate from older versions
  upcast: (event, fromVersion) => {
    if (fromVersion < 2) {
      // Migrate V1 -> V2
      return {
        ...event,
        payload: {
          ...event.payload,
          price: { amount: event.payload.price, currency: 'USD' }, // Default to USD
        },
      };
    }
    // Return void if no changes needed
  },

  // 3. Validation and Application logic only sees V2
  validate: async (event) => {
    // event.payload.price is guaranteed to be { amount, currency }
    if (event.payload.price.amount < 0) throw new Error('Negative price');
  },
};
```
