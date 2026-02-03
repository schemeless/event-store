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

### Traceability IDs

The event store uses several ID fields to track causation and correlation across event chains:

- **`correlationId`** – Groups all events originating from the same root command. The framework inherits this from parent events or creates it for root events. Developers can optionally pass this from external systems (e.g., HTTP request headers).
- **`causationId`** – Links each event to its immediate parent. This field is **managed exclusively by the framework** via `createConsequentEvents` or `sideEffect` handlers.
- **`identifier`** – Developer-provided field to record who or what triggered the event (e.g., user ID, service name).
- **`trackingId`** – Developer-provided external reference for cross-system tracing.

> **Important:** Do not manually set `causationId` in your event inputs. The framework automatically populates this field based on the event creation context to ensure chain integrity.

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

### Revert support

To enable revert operations, adapters should also implement two additional optional methods:

```ts
class CustomRepo implements IEventStoreRepo {
  // ... existing methods ...

  async getEventById(id: string) {
    // Return a single event by ID, or null if not found
  }

  async findByCausationId(causationId: string) {
    // Return all events where causationId equals the given value
    // Used to traverse the event tree during reverts
  }
}
```

> **Note:** For DynamoDB adapters, consider adding a Global Secondary Index on `causationId` for better performance.

## Revert types

The package exports types for the revert API:

```ts
import { CanRevertResult, PreviewRevertResult, RevertResult } from '@schemeless/event-store-types';
```

- `CanRevertResult` – Indicates whether an event can be reverted, with reasons if not
- `PreviewRevertResult` – Shows which events would be affected by a revert
- `RevertResult` – Contains the outcome of a revert operation, including generated compensating events
