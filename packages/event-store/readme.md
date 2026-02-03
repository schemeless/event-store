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
