# OCC and Concurrency

V6 uses stream-level optimistic concurrency control.

## Rule

For a given aggregate stream:

1. hydrate current state from snapshot + stream
2. decide next events
3. append with `expectedVersion`
4. fail if another writer committed first

## Why

This keeps correctness in the event log, not in process-local locks.

That means:

- different instances can safely race on the same aggregate
- only one append succeeds for a given expected version
- the loser gets a `StreamConcurrencyError`

## Error

Adapters should throw `StreamConcurrencyError` with:

- `domain`
- `identifier`
- `expectedVersion`
- `actualVersion`
