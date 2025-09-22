# @schemeless/event-store-adapter-null

A no-op `IEventStoreRepo` implementation. Use it when you want to exercise event flows without touching a database—for example in unit tests or command handlers that you are validating in isolation.

## Installation

```bash
yarn add @schemeless/event-store-adapter-null
```

## Usage

```ts
import { EventStoreRepo as NullRepo } from '@schemeless/event-store-adapter-null';
import { makeEventStore } from '@schemeless/event-store';

const repo = new NullRepo();
const eventStore = await makeEventStore(repo)(eventFlows);

await eventStore.receive(flow)({ payload: { /* ... */ } });
```

The repository exposes the same API surface as the production adapters, but `storeEvents` is a no-op and `resetStore` simply logs that no action is required. Because nothing is persisted you should only use this adapter in tests or ephemeral environments.
