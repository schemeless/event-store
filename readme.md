# Schemeless Event Store

A batteries-included event sourcing toolkit for Node.js services. The monorepo provides the core event store runtime, strongly typed definitions for authoring event flows, and persistence adapters that let you capture and replay events through DynamoDB, TypeORM-backed SQL databases, or in-memory stubs.

## Why Schemeless?

Event sourced systems thrive on consistent lifecycle handling. This project focuses on:

- **Event flows as the source of truth.** Each flow describes how a domain event is received, validated, persisted, and fanned out into consequent events or side effects ([EventStore.types.ts](packages/event-store-types/src/EventStore.types.ts#L26-L76), [makeValidateAndApply.ts](packages/event-store/src/eventLifeCycle/makeValidateAndApply.ts#L1-L13)).
- **Deterministic processing pipelines.** The core runtime coordinates a single `mainQueue` for authoring events, a `sideEffectQueue` for asynchronous work with retry semantics, and observer queues for notifying subscribers ([makeEventStore.ts](packages/event-store/src/makeEventStore.ts#L17-L54), [makeMainQueue.ts](packages/event-store/src/queue/makeMainQueue.ts#L1-L36), [makeSideEffectQueue.ts](packages/event-store/src/queue/makeSideEffectQueue.ts#L1-L49)).
- **Replayable state.** Any `IEventStoreRepo` implementation can stream historical events back through your flows so projections and observers stay consistent ([makeReplay.ts](packages/event-store/src/makeReplay.ts#L1-L36), [Repo.types.ts](packages/event-store-types/src/Repo.types.ts#L18-L26)).

## Core Concepts

### Event flows

An event flow couples domain semantics with lifecycle hooks:

- `receive` defines how raw input is transformed into one or more created events (including consequent events via `createConsequentEvents`) ([EventStore.types.ts](packages/event-store-types/src/EventStore.types.ts#L42-L74), [applyRootEventAndCollectSucceed.ts](packages/event-store/src/operators/applyRootEventAndCollectSucceed.ts#L1-L27)).
- `validate`, `preApply`, and `apply` execute sequentially to guarantee each created event is consistent and side-effect free before it is committed ([validate.ts](packages/event-store/src/eventLifeCycle/validate.ts#L1-L13), [preApply.ts](packages/event-store/src/eventLifeCycle/preApply.ts#L1-L9), [apply.ts](packages/event-store/src/eventLifeCycle/apply.ts#L1-L8)).
- `sideEffect` handles asynchronous integrations, automatically retrying according to `meta.sideEffectFailedRetryAllowed` and enqueueing additional root events if necessary ([EventStore.types.ts](packages/event-store/src/EventStore.types.ts#L31-L59), [makeSideEffectQueue.ts](packages/event-store/src/queue/makeSideEffectQueue.ts#L10-L43)).
- `createConsequentEvents` lets a successful event spawn more work that re-enters the main queue with preserved causation metadata ([EventStore.types.ts](packages/event-store-types/src/EventStore.types.ts#L61-L74), [defaultEventCreator.ts](packages/event-store/src/operators/defaultEventCreator.ts#L1-L21)).

Every event passes through a default creator that assigns ULID-based identifiers, correlation IDs, and causation IDs so downstream consumers always have traceability ([defaultEventCreator.ts](packages/event-store/src/operators/defaultEventCreator.ts#L1-L21), [ulid.ts](packages/event-store/src/util/ulid.ts#L1-L8)).

### Persistence adapters

Adapters implement the `IEventStoreRepo` contract so the runtime can initialise storage, persist created events, paginate through history, and reset state during tests ([Repo.types.ts](packages/event-store-types/src/Repo.types.ts#L1-L26)). This repository includes:

- `@schemeless/event-store` – Core runtime that exposes `makeEventStore`, queues, and the `output$` observable stream for monitoring progress ([makeEventStore.ts](packages/event-store/src/makeEventStore.ts#L17-L54), [EventStore.types.ts](packages/event-store/src/EventStore.types.ts#L13-L28)).
- `@schemeless/event-store-types` – Shared TypeScript definitions for events, event flows, observers, and repository interfaces ([EventStore.types.ts](packages/event-store-types/src/EventStore.types.ts#L1-L78), [Repo.types.ts](packages/event-store-types/src/Repo.types.ts#L1-L26)).
- `@schemeless/event-store-adapter-typeorm` – SQL-backed repository that persists events through TypeORM, supports SQLite quirks, and resets schemas via migrations ([EventStore.repo.ts](packages/event-store-adapter-typeorm/src/EventStore.repo.ts#L1-L65)).
- `@schemeless/event-store-adapter-dynamodb` – DynamoDB + S3 repository that transparently offloads oversized payloads while keeping table size under AWS limits ([EventStore.dynamodb.repo.ts](packages/event-store-adapter-dynamodb/src/EventStore.dynamodb.repo.ts#L1-L97)).
- `@schemeless/event-store-adapter-null` – No-op adapter useful for unit tests and dry runs where persistence is unnecessary ([EventStore.repo.ts](packages/event-store-adapter-null/src/EventStore.repo.ts#L1-L19)).
- `@schemeless/dynamodb-orm` – Lightweight helpers around the AWS Data Mapper used by the DynamoDB adapter ([index.ts](packages/dynamodb-orm/src/index.ts#L1-L3)).

Feel free to add your own adapter by implementing the same interface.

### Observability and replay

The `output$` observable emits every success, validation error, cancellation, and side-effect result in order, enabling custom metrics or logging pipelines ([makeEventStore.ts](packages/event-store/src/makeEventStore.ts#L41-L54), [EventStore.types.ts](packages/event-store/src/EventStore.types.ts#L13-L28)). For long-running services, `replay` rehydrates projections by running stored events back through each flow and its success observers ([makeReplay.ts](packages/event-store/src/makeReplay.ts#L1-L36)). Success observers process completed events in priority order using a dedicated queue so they can remain isolated from the main command pipeline ([makeReceive.ts](packages/event-store/src/queue/makeReceive.ts#L1-L27)).

## Monorepo layout

```
packages/
  event-store/                 Core runtime implementation
  event-store-types/           Shared type definitions
  event-store-adapter-*/       Persistence implementations (TypeORM, DynamoDB, null)
  dynamodb-orm/                AWS Data Mapper helpers
examples/
  example-domain-pacakges/     Sample event flows and domains
  example-service/             Demo service wiring the store together
```

Each package has its own `package.json` with scripts such as `test`, `compile`, and `prepublish` so you can iterate in isolation.

## Getting started

1. **Install dependencies**

   ```bash
   yarn install
   ```

   The workspace uses Yarn classic (v1) with Lerna for orchestration.

2. **Bootstrap the packages**

   ```bash
   yarn bootstrap
   ```

   This installs dependencies and runs `prepublish` in each workspace to build the TypeScript sources ahead of local development.

3. **Run the test suite**

   ```bash
   yarn test
   ```

   Use `yarn lerna-test` to execute package-specific test scripts, or target a single workspace with `yarn workspace <package-name> test`.

4. **Prepare distribution builds**

   ```bash
   yarn prepare
   ```

   This runs each package's `prepublish` script, compiling TypeScript into the `dist` directories.

## Authoring a new event flow

1. **Model the domain event** by creating an `EventFlow` object that at least defines `domain`, `type`, and a `receive` handler returning the created event(s).
2. **Implement lifecycle hooks** such as `validate` and `apply` to enforce invariants and update projections.
3. **Register the flow** when building the store:

   ```ts
   import { makeEventStore } from '@schemeless/event-store';
   import { EventStoreRepo as TypeOrmRepo } from '@schemeless/event-store-adapter-typeorm';

   const eventFlows = [userRegisteredFlow, userEmailVerifiedFlow];
   const repo = new TypeOrmRepo({ type: 'sqlite', database: ':memory:' });
   const buildEventStore = makeEventStore(repo);
   const eventStore = await buildEventStore(eventFlows);

   const [created] = await eventStore.receive(userRegisteredFlow)({
     payload: { id: '123', email: 'user@example.com' },
   });
   ```

4. **React to completed events** by registering success observers when initialising the store. Observers receive events after they are persisted, enabling notification systems or read model updates without slowing down the main queue.

5. **Replay history** via `await eventStore.replay()` whenever you need to rebuild projections from storage.

## Examples and local tooling

The [`examples/`](examples) directory showcases reference flows and a sample service that wires adapters together. Use these as a starting point for your own domains or for integration testing.

## Contributing

- Follow the existing TypeScript style (the project relies on Prettier defaults) and avoid wrapping imports with `try/catch`.
- Prefer Yarn commands over npm equivalents.
- Run `yarn test` before opening a pull request, and ensure documentation stays up to date when you add new packages or commands.

## License

This repository is released under the MIT license. See the individual `package.json` files for author details and versioning.
