# Redesign V6 Plan

This directory contains the implementation plan for the V6 redesign described in:

- [RFC: Split Event Store Into Core + Aggregate Runtime](/Users/akino/Projects/event-store/docs/rfcs/event-store-core-aggregate-redesign.md)

## Goal

Build the best end-state architecture from first principles, without preserving the current `EventFlow` model.

The target system is:

- `@schemeless/event-store-core`
- `@schemeless/event-store-aggregate`
- explicit adapter capabilities
- projection rebuild as a core concern
- aggregate command handling as a separate runtime concern

## Implementation Order

The implementation is intentionally sequenced from the most stable foundation outward:

1. Build `event-store-core`
2. Redefine adapter contracts
3. Build `event-store-aggregate`
4. Prove the model with one end-to-end aggregate
5. Upgrade key adapters and projection paths
6. Publish migration guidance and remove old architecture

## Why This Order

This order minimizes architectural thrash:

- `core` defines the storage and replay boundary
- adapter contracts define concurrency and recovery guarantees
- aggregate runtime can then depend on stable infrastructure
- one real aggregate validates the model before broad migration
- adapter migration happens after the target runtime is proven
- migration docs and deletion happen last, once the new system is real

## Files

- `01-core.md`
- `02-adapter-contracts.md`
- `03-aggregate-runtime.md`
- `04-reference-aggregate.md`
- `05-adapters-and-projections.md`
- `06-migration-and-removal.md`

## Rules For Execution

- Do not add compatibility shims for `EventFlow` unless the plan explicitly says so.
- Do not implement aggregate semantics inside `core`.
- Do not use replay as aggregate startup recovery.
- Do not let projection correctness become a requirement for aggregate writes.
- Prefer deleting ambiguous APIs over renaming them in place.
