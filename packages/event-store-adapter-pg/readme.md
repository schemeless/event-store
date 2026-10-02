# @schemeless/event-store-adapter-pg

PostgreSQL adapter for the V6 event-store contracts.

For the adapter contract and semantics, see [Adapters](../../docs/adapters.md).

## Install

```bash
yarn add @schemeless/event-store-adapter-pg pg
```

## Usage

```ts
import { PgEventStoreAdapter } from '@schemeless/event-store-adapter-pg';

const adapter = new PgEventStoreAdapter({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'postgres',
  database: 'event_store',
});

await adapter.init();
```

## Atomic multi-stream commands (V6 RC.6)

`appendBatch(events, expectedVersions): Promise<void>` is an optional capability
exported as `BatchEventStoreAdapter` from `@schemeless/event-store-types`.
Use `supportsAppendBatch(adapter)` to detect it; core and SQLite do not require it.
Each written `(domain, identifier)` needs exactly one expected version. Additional
entries validate read-only dependencies, including empty streams at version zero.
Versions must be non-negative safe integers. Identifiers follow V6 rules: omit
`identifier` for the legacy domain-only stream; `''` and whitespace are invalid.
Duplicate entries and missing write versions throw `InvalidStreamBatchError`.

```ts
await adapter.appendBatch(
  [cashEvent, assetEvent, anotherCashEvent],
  [
    { domain: 'cash', identifier: 'account-1', expectedVersion: 8 },
    { domain: 'asset', identifier: 'holding-1', expectedVersion: 3 },
  ],
);
```

All checks and inserts share one transaction. Locks include empty streams and
read-only dependencies and remain held until commit/rollback. Locks are acquired
in a deterministic order. Inserts keep the supplied order (including interleaved
streams), and each stream receives consecutive sequences. `append` and
`appendToStream` use the same write path. Input objects are not mutated.
There is no database/table-wide append lock. Stream lock keys incorporate the
actual table OID, so qualified and unqualified names of the same table share locks.
A very rare 64-bit hash collision can serialize unrelated streams without weakening
correctness. Locks are cooperative: **all writers must use RC.6 or later**;
old adapters/direct event-table writes do not follow this protocol.

## Events and consumer receipts in one transaction

`adapter.withTransaction(async tx => ...)` is the one supported composition API.
`tx.execute(sql, values)` runs parameterized consumer SQL on the same checked-out
PostgreSQL connection as every scoped adapter method. Its pg result types stay in
the PostgreSQL package. The callback scope excludes lifecycle/transaction methods.
Nested transactions are rejected; there are no savepoints or global transaction
variables. Do not call the root adapter from inside the callback.

Create your own receipt/authorization/outbox tables through your normal migrations.
The following table and command details are consumer examples, not library models:

```sql
CREATE TABLE command_receipts (
  command_id text PRIMARY KEY,
  result jsonb
);
```

```ts
// Decide and perform LLM/network work BEFORE opening the transaction.
// expectedVersions must describe the state used to make the decision.
const result = await adapter.withTransaction(async tx => {
  // A unique claim handles concurrent delivery, including the first delivery.
  const claim = await tx.execute(
    'INSERT INTO command_receipts (command_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING command_id',
    [commandId],
  );
  if (claim.rowCount === 0) {
    const saved = await tx.execute(
      'SELECT result FROM command_receipts WHERE command_id = $1', [commandId],
    );
    return saved.rows[0].result;
  }

  // Consumer-defined authorization must be checked here and protected against
  // concurrent revocation (e.g. SELECT ... FOR SHARE on the authorization row).
  await assertAuthorizedUsing(tx.execute.bind(tx));
  await tx.appendBatch(events, expectedVersions);
  await tx.execute(
    'UPDATE command_receipts SET result = $2 WHERE command_id = $1',
    [commandId, receipt],
  );
  return receipt;
});
```

A failed receipt/outbox insert or callback exception rolls back the events and
consumer SQL together. The receipt claim also rolls back on failure. A caught
append/SQL failure poisons the scope and cannot accidentally commit earlier
writes. The scoped adapter never commits on append, releases/ends the pool, or
survives the callback. Escaped iterators are invalidated too. Always await every
operation; do not launch background tasks or use parallel appends in the callback.
Only **one append call per transaction** is allowed: collect the entire write and
dependency set in that call, preventing lock-order inversions across calls.

`execute` accepts one `SELECT`, `INSERT`, `UPDATE`, `DELETE`, or `WITH` statement,
without semicolons; bind values rather than embedding literals. Transaction control,
DDL, and session settings are outside this API. This is an API for trusted
consumer SQL, not a sandbox for arbitrary SQL. Do not call functions that change
transaction/session state or modify event-table rows. Do not wait for an LLM or
external network in the transaction.

## Isolation, conflicts and retries

Transactions explicitly use **READ COMMITTED**. After all stream locks are held,
versions are read from one statement snapshot and checked before any insert.
A dependency writer follows the same protocol and cannot change a checked version
until the command commits. Consumer SQL needs its own row locks/constraints for
permission and deduplication state; stream locks do not protect consumer tables.
Acquire those consumer locks in a consistent order **before** the batch; release
all of them only by finishing the transaction.

- `StreamConcurrencyError` includes domain, identifier, expected and actual version.
  Reload the decision's state and re-decide; do not blindly retry stale expectations.
- Duplicate event IDs throw `DuplicateEventError`; they do not silently deduplicate
  a partially matching command. Command replay is the consumer's receipt protocol.
- PostgreSQL `40001` (serialization failure), `40P01` (deadlock), and lock/statement
  timeouts require rollback and a bounded retry of the **whole callback** with fresh
  reads. The library does not retry consumer side effects automatically. Sorted
  batch locks avoid the event-stream order deadlock; consumer SQL can still deadlock.
- A connection loss during COMMIT can leave the outcome unknown. Retry/query the
  same command ID through the durable claim/receipt protocol, never invent a new ID.

## Decision baseline: stream versions, not a global head ID

`getStreamVersions([{ domain, identifier }, ...])` reads a finite dependency vector
from one PostgreSQL statement snapshot; missing streams return version zero.
Pass that vector into `appendBatch` to check it atomically with the writes.
The baseline's range is **exactly the listed streams in this physical event table**.
Bind the vector to the state/projection checkpoint used to decide. Reading a fresh
vector after reading an old projection does not validate that old projection.

There is deliberately no adapter-wide `expectedHeadId` guarantee. Neither `MAX(id)`
nor `MAX(position)` validates a decision: new, unlisted streams are phantoms outside
a finite vector. For a decision that depends on an entire consumer scope, the
consumer can maintain one explicit revision stream **per decision scope**, append a
revision event in every scope-changing batch, and include that stream's expected
version in the command. This serializes that consumer scope, while other scopes
remain independent. It is a consumer convention, not a tenant/ledger model in this
library. Reading the projection and its revision checkpoint must be consistent.
If every relevant writer cannot participate, this baseline is insufficient; use
consumer-owned serializable state/CDC and a decision contract that covers phantoms.

## Concurrent incremental log consumption

The existing `position` is a PostgreSQL sequence allocation order, **not commit
order**. Transaction A can allocate 1, B allocate and commit 2, then A commit 1.
`getAllEvents(pageSize, startFromId)` keeps its compatible allocation-order behavior;
resuming from B can miss A. Use it for quiescent export/import/rebuild, not as a
concurrent incremental consumer cursor. No existing event body or stream sequence
is rewritten by this release.

`getLogPage(cursor = [], pageSize = 100)` is an optional
`IncrementalEventStoreAdapter` capability (detect with `supportsIncrementalLog`).
It returns `{ events, cursor }`, where cursor is a per-stream version vector using
`ExpectedStreamVersion[]`. Persist the **whole returned vector** with your projection
updates, and poll again even after an empty page. The checkpoint is scoped to this
physical table and its lifecycle; never reuse it for another table or after reset,
restore, or destructive migration.

```ts
let cursor: ExpectedStreamVersion[] = savedCheckpoint ?? [];
const page = await adapter.getLogPage(cursor, 100);
// Commit projection changes and page.cursor together in the consumer database.
await saveProjectionAndCheckpoint(page.events, page.cursor);
cursor = page.cursor;
```

Each call sees committed rows at its statement snapshot. Rows are delivered in
position order **within that page**; checkpoints advance only for delivered streams.
A lower-position event committing later on a different stream is still returned
on a subsequent page. Stream locking prevents late lower sequences within one
stream. Newly introduced streams start at zero. This gives no-loss incremental
consumption with consumer checkpoint durability and at-least-once crash handling;
it does **not** create a total commit order, global cross-page causal order, or
transaction-sized pages. A multi-stream batch can span pages. Consumers needing
atomic batch projection or a globally ordered feed should use PostgreSQL logical
decoding/CDC and its transaction boundaries instead. Do not run two consumers
updating the same checkpoint without consumer-side coordination.

The vector grows with stream count and is sent as JSON to each page query; this
simple contract is intended for bounded stream populations. Continuous unbounded
writes can starve older pages; finite/backlog-draining workloads are the tested
no-loss boundary. Use CDC when those ceilings matter. Legacy rows with NULL
sequence cause a typed error when encountered; offline migration/export is required,
and this release does not synthesize or rewrite their sequences.

## Data scope and deployment

The adapter sees **all rows in its configured event and snapshot tables**. It does
not enforce tenants, ledger IDs, user authorization, or row-level security. The
consumer owns isolation (separate databases/tables, database roles, or a carefully
validated RLS design). Do not treat a stream domain/identifier as a security boundary.
Initialize/migrate with writers stopped; `init()` includes legacy schema normalization
and sequence setup. Upgrade all writers together. PostgreSQL 15 is tested; other
versions, custom RLS, replica reads, and logical-decoding integrations are not tested
by this release. The adapter's pool remains owned by the root adapter; only root
`close()` ends it.

## Validation

Run the real PostgreSQL suites (they never silently skip):

```sh
docker run -d --name event-store-v6-pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=event_store_test -p 55432:5432 postgres:15-alpine
yarn install --frozen-lockfile
yarn lerna run compile
PGPORT=55432 yarn test
```

See [RC.6 validation record](../../docs/releases/6.0.0-rc.6.md) for exact results
and acceptance coverage.
