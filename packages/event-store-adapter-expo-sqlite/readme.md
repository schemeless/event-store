# @schemeless/event-store-adapter-expo-sqlite

Expo SQLite adapter for the V6 event-store contracts.

For the adapter contract and semantics, see [Adapters](../../docs/adapters.md).

## Install

```bash
yarn add @schemeless/event-store-adapter-expo-sqlite expo-sqlite
```

## Usage

```ts
import { openDatabaseAsync } from 'expo-sqlite';
import { ExpoSqliteEventStoreAdapter } from '@schemeless/event-store-adapter-expo-sqlite';

const db = await openDatabaseAsync('events.db');
const adapter = new ExpoSqliteEventStoreAdapter(db);

await adapter.init();
```

## Atomic batches

The adapter implements the optional `BatchEventStoreAdapter` contract. Detect it
with `supportsAppendBatch(adapter)`; core does not require it.

```ts
const expected = await adapter.getStreamVersions([
  { domain: 'cash', identifier: 'account-1' },
  { domain: 'asset', identifier: 'holding-1' },
]);
// Read state and decide outside the transaction, retaining the versions of all
// streams used by the decision; a changed version rejects the entire batch.
await adapter.appendBatch([cashEvent, assetEvent, anotherCashEvent], expected);
```

Every written stream needs exactly one expected version; extra entries check
read-only dependencies. Versions are non-negative safe integers. Omit identifier
for a legacy domain-only stream; empty or whitespace identifiers are invalid.
`getStreamVersions` reads the requested versions from one transaction snapshot,
including version zero for absent streams. An empty event batch can check dependencies.

All version checks and event inserts use the same exclusive transaction connection.
The adapter obtains SQLite's writer reservation before reading versions, including
for empty streams. Input event order is preserved and stream sequences advance
independently. Failures roll back the whole batch. `StreamConcurrencyError` reports
version conflicts; duplicate IDs throw `DuplicateEventError`. Invalid batch metadata
throws `InvalidStreamBatchError` or `InvalidIdentifierError`.

SQLite has one writer per database, including across different streams. Competing
native connections can return `SQLITE_BUSY`/database-locked errors rather than wait.
Retry busy errors only after rollback with bounded backoff; reload and re-decide on
version conflicts. Do not retry after a successful commit merely because a subsequent
projection or response failed. All event writers must follow this adapter's protocol.

This uses Expo's native `withExclusiveTransactionAsync` (not supported on web).
Configure connection contention policy in your application. There is no consumer
transaction scope API: an external `db.withTransactionAsync` does not encompass
adapter writes, which run on a separate connection. Do not nest them to save receipts.
For events plus consumer receipts in one transaction, use the PostgreSQL adapter.

The adapter sees all rows in its configured tables; database/table separation and
authorization are the consumer's responsibility. Existing event bodies and sequences
are unchanged. SQLite replay uses rowid insertion order: stop writers for complete
rebuild/export, and do not delete/reset event rows while consuming. Rowids can be reused
after deletion; this is not a durable checkpoint across resets. No incremental vector
log capability is advertised.

## Validation

Run `yarn test` with Node 22.13+ (Node's built-in SQLite module). The integration
suite uses real SQLite transactions and separate worker connections through an Expo
API-shaped bridge. Mock tests cover compatibility; native Expo iOS/Android connection
creation and web remain separate, unverified platform boundaries.
