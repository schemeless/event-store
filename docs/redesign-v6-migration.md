# V6 Migration Guide

V6 is a breaking redesign. The old `@schemeless/event-store` package has been removed.
This guide covers everything you need to move to the new packages.

## Install

```bash
yarn add \
  @schemeless/event-store-core@next \
  @schemeless/event-store-aggregate@next \
  @schemeless/event-store-types@next
```

Pick an adapter:

```bash
# PostgreSQL
yarn add @schemeless/event-store-adapter-pg@next pg

# Expo SQLite (React Native)
yarn add @schemeless/event-store-adapter-expo-sqlite@next expo-sqlite
```

Then remove the old package:

```bash
yarn remove @schemeless/event-store
```

---

## Breaking changes

### 1. Package split

| Old                       | New                                                                  |
| ------------------------- | -------------------------------------------------------------------- |
| `@schemeless/event-store` | `@schemeless/event-store-core` + `@schemeless/event-store-aggregate` |
| `makeEventStore()`        | `makeEventStoreCore(adapter)` + `makeAggregateRuntime(adapter)`      |

### 2. `EventFlow` / `AggregateEventFlow` removed

These abstractions no longer exist. Replace with `AggregateDefinition`:

**Before:**

```ts
import { makeEventStore } from '@schemeless/event-store';

const accountFlow: AggregateEventFlow = {
  type: 'Account',
  validate: (input, state) => {
    /* ... */
  },
  apply: (state, event) => {
    /* ... */
  },
  createConsequentEvents: (input, state) => [
    /* events */
  ],
};

await eventStore.submit(accountFlow, command);
```

**After:**

```ts
import { makeAggregateRuntime } from '@schemeless/event-store-aggregate';
import type { AggregateDefinition } from '@schemeless/event-store-aggregate';

const AccountAggregate: AggregateDefinition<Command, Event, State> = {
  name: 'Account',
  domain: 'account',
  getIdentifier: (command) => command.accountId,
  initialState: { opened: false, balance: 0 },
  precondition: (command, state) => {
    /* throws on invalid */
  },
  evolve: (state, event) => {
    /* return next state */
  },
  decide: (command, state) => [
    /* return events */
  ],
};

const runtime = makeAggregateRuntime(adapter);
await runtime.handle(AccountAggregate, command);
```

### 3. `replay()` removed → `rebuildReadModels()`

**Before:**

```ts
await eventStore.replay();
```

**After:**

```ts
const core = makeEventStoreCore(adapter);
await core.rebuildReadModels({ observers });
```

`rebuildReadModels` no longer hydrates aggregates. It only drives observers over the full event log.

### 4. `core.export()` is now a stream

**Before:**

```ts
const events = await core.export(); // returns PersistedEvent[]
await fs.writeFile('backup.json', JSON.stringify(events));
```

**After:**

```ts
const events = [];
for await (const page of core.export()) {
  events.push(...page);
}
await fs.writeFile('backup.json', JSON.stringify(events));
```

For large stores, process pages directly instead of collecting:

```ts
for await (const page of core.export()) {
  await otherStore.import(page);
}
```

### 5. `core.scan()` no longer returns a Promise

**Before:**

```ts
const iterator = await core.scan({ pageSize: 100 });
for await (const page of iterator) {
  /* ... */
}
```

**After:**

```ts
for await (const page of core.scan({ pageSize: 100 })) {
  /* ... */
}
```

### 6. `ConcurrencyError` renamed to `StreamConcurrencyError`

All adapters now throw `StreamConcurrencyError` (from `@schemeless/event-store-types`) on OCC conflicts.

**Before:**

```ts
import { ConcurrencyError } from '@schemeless/event-store';

try {
  await eventStore.submit(flow, command);
} catch (e) {
  if (e instanceof ConcurrencyError) {
    /* retry */
  }
}
```

**After:**

```ts
import { StreamConcurrencyError } from '@schemeless/event-store-types';

try {
  await runtime.handle(AccountAggregate, command);
} catch (e) {
  if (e instanceof StreamConcurrencyError) {
    /* retry */
  }
}
```

### 7. Observer `onError` replaces silent swallowing

`fireAndForget` observers that throw will now call `onError` if provided,
or fall back to `console.error`. Previously errors were silently ignored.

```ts
const observer = {
  name: 'my-projection',
  filters: [{ domain: 'account', type: 'AccountOpened' }],
  fireAndForget: true,
  onError: (error, event) => {
    myLogger.error('observer failed', { error, eventId: event.id });
  },
  apply: async (event) => {
    /* ... */
  },
};
```

---

## New behaviours

### Snapshot auto-save

`handle()` now automatically calls `saveSnapshot()` after each successful append (if your adapter supports it). No action required — snapshots are an optimisation and failure to save does not affect correctness.

### `getIdentifier` only receives `Command`

The type signature of `getIdentifier` changed from `(command: Command | Event) => string` to `(command: Command) => string`. If you had a union type, remove the `Event` branch.

---

## Database migration (PostgreSQL)

If you are upgrading an existing PostgreSQL event store, call `adapter.init()` on first boot.
V6 adds a `_snapshots` table and a unique index on `(domain, identifier, sequence)`.

`init()` is idempotent and safe to call on an already-initialised database.
It will also normalise any legacy `NULL` identifier rows to `''` before creating the index.

```ts
const adapter = new PgEventStoreAdapter({
  /* pool config */
});
await adapter.init(); // run once on startup
```

---

## Example

A complete reference aggregate (cash account with deposits, withdrawals, OCC, and snapshot) is available at:

- npm: `@schemeless/event-store-cash-account-example@next`
- source: [`packages/event-store-cash-account-example`](../packages/event-store-cash-account-example)
