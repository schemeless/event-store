# Example Domain Packages

This workspace contains a set of opinionated domain modules that showcase how to build event-sourced features on top of `@schemeless/event-store`. Each module exports its TypeORM projections, query helpers, and event flows so you can compose them into a runnable service or reuse individual pieces in your own experiments.

## Aggregated exports

The package root bundles everything that the sample service needs:

- `featureEntities` collects every projection entity so a TypeORM connection can be initialised with a single array import.
- `allEventFlows` flattens the event flow lists from every domain so the event store can register them in one step.
- `AccountPackage`, `AttachmentPackage`, `OrderPackage`, `PostPackage`, and `ProfilePackage` expose their module-specific queries, entities, and individual flows when you only need a subset.

```ts
import { allEventFlows, featureEntities } from '@schemeless/example-domain';
import { makeEventStore } from '@schemeless/event-store';
import { EventStoreRepo as TypeOrmRepo } from '@schemeless/event-store-adapter-typeorm';

const repo = new TypeOrmRepo({ type: 'sqlite', database: ':memory:' });
const buildStore = makeEventStore(repo);
const eventStore = await buildStore(allEventFlows);
```

Once a TypeORM connection is bootstrapped with `featureEntities`, you can plug the exported queries into resolvers, REST handlers, or CLI tools. The example GraphQL service under `examples/example-service` wires these exports together through shared helpers such as `getProjectiveDbConnection`.

## Domain modules

### Account

The account module models custodial token accounts together with their balances and transaction history. It exports both the `AccountEntity` and `AccountTokenBalanceEntity` projections, the `AccountQuery` helper, and the event flows declared in `AccountPackage.EventFlows`:

- **AccountCreationRequested → AccountCreated** – generates a fresh account identifier and persists the initial record.
- **AccountCredit / AccountDebit** – increments or decrements token balances with validation that the account exists and that the amount is positive.
- **AccountDeposited** – captures attendance or top-up rewards and fans out to the credit flow while updating the account’s attendance timestamp.
- **AccountTransferred** – orchestrates an internal transfer by emitting debit and credit consequent events.
- **AccountTraded** – records marketplace settlements by crediting both counterparties with the swapped tokens.
- **AccountClosed** – marks an account inactive once every token balance reaches zero.

These flows log to the shared `pino` logger from the example service and rely on the `AccountQuery` helpers for invariant checks.

### Attachment

Attachments model user-uploaded images. The `ImageAttachmentEntity` stores file metadata, while the query helpers expose common lookup patterns. Two flows illustrate how to react to different storage backends:

- **AttachmentS3ImageUploaded** persists the image dimensions and S3 location returned by an upload pipeline.
- **AttachmentCOSImageUploaded** mirrors the same behaviour for Tencent COS uploads.

Both flows create or update projection records immediately so downstream consumers can display newly uploaded images without replaying historical events.

### Order

The order module demonstrates a simple order book that trades a base token for user-minted tokens. Its projections include `OrderEntity` and `OrderMatchedRecordEntity`, while the `OrderQuery` helpers expose filtered reads for resolvers and matching logic. The exported event flows cover the full lifecycle:

- **OrderPlaceRequested** – validates ownership, balance sufficiency, and duplicate placements before emitting an `OrderPlaced` event with a generated order ID.
- **OrderPlaced** – persists the order, debits the buyer’s base token (or the seller’s inventory), and triggers matching attempts.
- **OrderTryMatched** – updates last-match timestamps and searches for compatible counterparties before producing `OrderMatched` events.
- **OrderMatched** – adjusts the open quantities on both orders, records a match entry, and emits `AccountTraded` to settle balances. When an initiating order still has volume remaining it recursively requeues `OrderTryMatched`.
- **OrderCancelled** – transitions an order to `CANCELLED` and refunds the locked funds by crediting the appropriate token.

Constants such as `OrderStatus`, `OrderType`, and the shared `config.baseToken` determine how funds are debited or refunded, keeping the matching logic declarative.

### Post

Posts represent user-generated content that doubles as a token issuance trigger. The single `PostCreated` flow enforces uniqueness by ID and user-scoped UID, credits the author’s first account with a default token allowance, and persists the `PostEntity` projection with a verified status. Queries expose helpers for listing posts, resolving by token ID, or fetching the latest post for a user.

### Profile

Profiles tie external identities (Auth0 or Weixin) to local accounts. The `ProfileIdentityCreated` flow prevents duplicate usernames, stores provider-specific identity metadata, and, when necessary, emits `AccountCreationRequested` so every identity starts with a custodial account. The `ProfileEntity` keeps denormalised identity lists and provider-specific identifiers that the GraphQL service hides from public APIs, while the queries expose lookups by username, provider subject, or ID.

## Testing and scripts

Run the package tests with:

```bash
yarn workspace @schemeless/example-domain test
```

The Jest configuration lives alongside the sources and uses `ts-jest` so you can author tests in TypeScript. The tests initialise in-memory SQLite databases via the shared helpers from the example service, ensuring the projections and flows stay in sync.

## Extending the examples

Feel free to fork these modules when experimenting with new domains. A typical workflow is:

1. Clone one of the modules and rename the entities and flows to suit your domain.
2. Update `featureEntities` and `allEventFlows` to include your new module so the service bootstrap picks it up automatically.
3. Expand the example service or your own adapters to subscribe to the new flows.

Because the modules embrace the same event-store abstractions used by the production packages, they double as integration tests for new adapters or queue implementations.
