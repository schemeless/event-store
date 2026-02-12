# Schemeless Event Store

[![npm version](https://img.shields.io/npm/v/@schemeless/event-store?label=npm%20%40schemeless%2Fevent-store)](https://www.npmjs.com/package/@schemeless/event-store)
[![Publish Workflow](https://github.com/schemeless/event-store/actions/workflows/publish.yml/badge.svg)](https://github.com/schemeless/event-store/actions/workflows/publish.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

A batteries-included event sourcing toolkit for Node.js services. This monorepo provides a runtime (`@schemeless/event-store`), shared types (`@schemeless/event-store-types`), and persistence adapters for SQL, DynamoDB, and mobile/offline use cases.

## Documentation language

- Current primary documentation language: English
- Multilingual direction: add Simplified Chinese (`README.zh-CN.md`) and localized docs under `docs/i18n/zh-CN/`
- This README keeps section boundaries stable so language variants can stay aligned

## What this project gives you

- Event flows as first-class units (`receive`, `validate`, `apply`, `sideEffect`, `createConsequentEvents`)
- Ordered processing with configurable queue concurrency
- Replay support for rebuilding projections
- Observer pipeline for post-commit reactions
- Revert APIs (`canRevert`, `previewRevert`, `revert`) based on compensating events
- Adapter-driven storage so runtime code is database-agnostic

## Is this a fit?

Use this if:

- You want event sourcing with explicit lifecycle hooks
- You need deterministic replay and traceability (`correlationId`, `causationId`)
- You want pluggable persistence adapters in a TypeScript-first codebase

Probably not a fit if:

- You only need a simple CRUD data layer
- You do not need replay, event history, or causal chains

## Install

Install the runtime and types:

```bash
yarn add @schemeless/event-store @schemeless/event-store-types
# or: npm i @schemeless/event-store @schemeless/event-store-types
```

Pick an adapter (example: TypeORM):

```bash
yarn add @schemeless/event-store-adapter-typeorm typeorm reflect-metadata sqlite3
# or: npm i @schemeless/event-store-adapter-typeorm typeorm reflect-metadata sqlite3
```

Available adapters in this monorepo:

- `@schemeless/event-store-adapter-typeorm`
- `@schemeless/event-store-adapter-typeorm-v3`
- `@schemeless/event-store-adapter-prisma`
- `@schemeless/event-store-adapter-mikroorm`
- `@schemeless/event-store-adapter-dynamodb`
- `@schemeless/event-store-adapter-watermelondb`
- `@schemeless/event-store-adapter-null`

## Quick start (5 minutes)

```ts
import 'reflect-metadata';
import { EventFlow, makeEventStore } from '@schemeless/event-store';
import { EventStoreRepo as TypeOrmRepo } from '@schemeless/event-store-adapter-typeorm';

type UserRegisteredPayload = {
  userId: string;
  email: string;
};

const userRegisteredFlow: EventFlow<UserRegisteredPayload> = {
  domain: 'user',
  type: 'registered',
  receive: (eventStore) => (eventInput) => eventStore.receive(userRegisteredFlow)(eventInput),
  validate: (event) => {
    if (!event.payload.email.includes('@')) {
      throw new Error('invalid email');
    }
  },
  apply: async (event) => {
    // Update projection/read model here
    console.log('applied event', event.id, event.payload.userId);
  },
};

async function main() {
  const repo = new TypeOrmRepo({
    name: 'quick-start',
    type: 'sqlite',
    database: ':memory:',
    dropSchema: true,
    synchronize: true,
    logging: false,
  });

  const store = await makeEventStore(repo)([userRegisteredFlow]);

  const [created] = await store.receive(userRegisteredFlow)({
    payload: { userId: 'u-1', email: 'user@example.com' },
    identifier: 'u-1',
  });

  console.log('created event id:', created.id);
  await store.shutdown();
}

main().catch(console.error);
```

## Adapter capability matrix

| Adapter package | Backend | Replay (`getAllEvents`) | OCC (`expectedSequence`) | Revert helpers (`getEventById` + `findByCausationId`) |
| --- | --- | --- | --- | --- |
| `@schemeless/event-store-adapter-typeorm` | SQL via TypeORM | Yes | Yes | Yes |
| `@schemeless/event-store-adapter-typeorm-v3` | SQL via TypeORM v3 flavor | Yes | No | Yes |
| `@schemeless/event-store-adapter-prisma` | SQL via Prisma | Yes | No | Yes |
| `@schemeless/event-store-adapter-mikroorm` | SQL via MikroORM | Yes | No | Yes |
| `@schemeless/event-store-adapter-dynamodb` | DynamoDB (+ optional S3 payload offload) | Yes | Yes | Yes |
| `@schemeless/event-store-adapter-watermelondb` | WatermelonDB / React Native SQLite | Yes | No | Yes |
| `@schemeless/event-store-adapter-null` | No-op stub | No | No | Partial (stubbed) |

Note: `getAggregate` requires `repo.getStreamEvents(...)`. Built-in adapters currently do not implement `getStreamEvents`, so aggregate replay capability is unavailable by default.

## Core workflows

### 1) Receive events

`store.receive(flow)(input)` is the recommended ingestion path. It generates event identifiers/timestamps, handles lifecycle hooks, persists created events, and fans out side effects.

### 2) Replay history

Use replay to rebuild projections:

```ts
await store.replay();
```

You can also resume replay from an event id checkpoint:

```ts
await store.replay('last-processed-event-id');
```

### 3) Observe successful events

Register success observers when constructing the store:

```ts
const observers = [
  {
    filters: [{ domain: 'user', type: 'registered' }],
    priority: 1,
    fireAndForget: true,
    apply: async (event) => {
      // async notification, analytics, etc.
    },
  },
];

const store = await makeEventStore(repo)([userRegisteredFlow], observers);
```

Behavior notes:

- `fireAndForget: true` does not block the main receive path
- fire-and-forget observer failures are isolated from main event success/failure

### 3.5) Monitor lifecycle events with `output$`

```ts
const sub = store.output$.subscribe((eventOutput) => {
  console.log(eventOutput.state, eventOutput.event.id);
});

// later
sub.unsubscribe();
```

### 4) Revert event trees

```ts
const check = await store.canRevert(rootEventId);
if (check.canRevert) {
  const preview = await store.previewRevert(rootEventId);
  const result = await store.revert(rootEventId);
}
```

Only root events can be reverted. Every event in the causal tree must define `compensate`.

### 5) Optimistic concurrency control (OCC)

If you use repository-level writes directly, pass `expectedSequence`:

```ts
import { ConcurrencyError, type CreatedEvent } from '@schemeless/event-store-types';

const expectedSequence = await repo.getStreamSequence('account', 'user-123');

const nextEvent: CreatedEvent<{ amount: number }> = {
  id: 'evt-account-user-123-0002',
  domain: 'account',
  type: 'debited',
  identifier: 'user-123',
  payload: { amount: 100 },
  created: new Date(),
};

try {
  await repo.storeEvents([nextEvent], { expectedSequence });
} catch (error) {
  if (error instanceof ConcurrencyError) {
    console.log(`Expected ${error.expectedSequence}, but found ${error.actualSequence}`);
  }
}
```

Important: direct `repo.storeEvents(...)` expects `CreatedEvent[]` (including `id` and `created`). Most applications should prefer `store.receive(...)`, which creates those fields for you.

## Performance and concurrency

By default, queues are sequential (`1`) for strict ordering. You can tune queue concurrency:

```ts
const store = await makeEventStore(repo, {
  mainQueueConcurrent: 5,
  sideEffectQueueConcurrent: 10,
  observerQueueConcurrent: 5,
})(eventFlows, observers);
```

Guidance:

- Increase `sideEffectQueueConcurrent` first for I/O-heavy work
- Increase `observerQueueConcurrent` when observers are independent
- Increase `mainQueueConcurrent` only if you understand ordering tradeoffs

## Monorepo layout

```txt
packages/
  event-store/                 Core runtime
  event-store-react-native/    React Native build of the runtime
  event-store-types/           Shared types
  event-store-adapter-*/       Persistence adapters
examples/
  example-domain-pacakges/     Sample domains and flows
  example-service/             Example service integration
```

## Local development

```bash
yarn install
yarn bootstrap
yarn test
yarn prepare
```

Workspace notes:

- Uses Yarn classic (`yarn@1.22.22`) and Lerna
- `yarn bootstrap` runs workspace `prepublish` builds
- `yarn lerna-test` runs package-level test scripts

## Try examples quickly

Fastest low-friction path:

```bash
yarn workspace @schemeless/example-domain test
```

Full service example (requires MySQL + Redis and env setup):

```bash
cd examples/example-service
npm run dev:db:sync
npm run start
```

## Documentation map

- Architecture: [`docs/architecture.md`](docs/architecture.md)
- EventFlow reference: [`docs/event-flow-reference.md`](docs/event-flow-reference.md)
- OCC and concurrency: [`docs/occ-and-concurrency.md`](docs/occ-and-concurrency.md)
- Revert guide: [`docs/revert.md`](docs/revert.md)
- Adapter selection guide: [`docs/adapters.md`](docs/adapters.md)
- Runtime deep dive: [`packages/event-store/readme.md`](packages/event-store/readme.md)
- Concurrency migration notes: [`packages/event-store/MIGRATION.md`](packages/event-store/MIGRATION.md)
- OCC migration notes: [`packages/event-store/OCC_MIGRATION.md`](packages/event-store/OCC_MIGRATION.md)
- Schema versioning/upcasting: [`packages/event-store/SCHEMA_VERSIONING.md`](packages/event-store/SCHEMA_VERSIONING.md)
- TypeORM adapter doc: [`packages/event-store-adapter-typeorm/readme.md`](packages/event-store-adapter-typeorm/readme.md)
- Prisma adapter doc: [`packages/event-store-adapter-prisma/readme.md`](packages/event-store-adapter-prisma/readme.md)
- MikroORM adapter doc: [`packages/event-store-adapter-mikroorm/readme.md`](packages/event-store-adapter-mikroorm/readme.md)
- DynamoDB adapter doc: [`packages/event-store-adapter-dynamodb/readme.md`](packages/event-store-adapter-dynamodb/readme.md)
- WatermelonDB adapter doc: [`packages/event-store-adapter-watermelondb/readme.md`](packages/event-store-adapter-watermelondb/readme.md)

## Contributing

- Prefer Yarn commands over npm equivalents for repo development
- Keep docs in sync when changing public API or adapter behavior
- Run tests before opening a pull request

## License

MIT. See [`LICENSE`](./LICENSE).
