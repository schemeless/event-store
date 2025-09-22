# @schemeless/event-store-types

Shared TypeScript definitions used by the event store runtime, adapters, and application code. Import these contracts when authoring event flows, observers, or custom persistence layers.

## Installation

```bash
yarn add @schemeless/event-store-types
```

## Event primitives

The package defines the shape of event inputs, created events, and the lifecycle metadata that flows through the runtime.

```ts
import { BaseEventInput, CreatedEvent, EventFlow } from '@schemeless/event-store-types';

const draft: BaseEventInput<{ id: string }> = {
  payload: { id: '123' },
};

const eventFlow: EventFlow = {
  domain: 'user',
  type: 'registered',
  receive: (eventStore) => eventStore.receive(eventFlow),
};
```

`CreatedEvent` extends the base shape with generated identifiers and timestamps, while `SideEffectsState`, `EventOutputState`, and `EventObserverState` describe the possible outcomes emitted by the runtime.

## Repository contracts

`Repo.types` exposes the `IEventStoreRepo` and `IEventStoreEntity` interfaces. Adapters implement these to integrate with the core runtime.

```ts
import { IEventStoreRepo } from '@schemeless/event-store-types';

class CustomRepo implements IEventStoreRepo {
  async init() {}
  async getAllEvents(pageSize: number) {
    // return an async iterator of stored events
  }
  createEventEntity(event) {
    return event;
  }
  async storeEvents(events) {}
  async resetStore() {}
}
```

The iterator returned by `getAllEvents` yields arrays of `IEventStoreEntity` records. Each record includes identifiers, correlation/causation metadata, and the `created` timestamp so replays can process history in order.
