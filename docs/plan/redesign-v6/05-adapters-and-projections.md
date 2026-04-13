# Step 5: Upgrade Key Adapters and Projection Paths

## Objective

Bring the most important adapters onto the new capability model and prove that projections and aggregate storage can remain decoupled.

This step is about validating the architecture under real storage constraints.

## Scope

Prioritize adapters that matter most for the repository's likely users:

- `pg`
- `expo-sqlite`

Other adapters can follow later once the pattern is stable.

## Required Work

1. Update key adapters to implement new capability interfaces
2. Add single-stream `appendToStream(expectedVersion)` support where correctness is required
3. Add snapshot read/write support where practical
4. Ensure projection rebuild works independently from aggregate hydration
5. Document capability differences per adapter

## Adapter Matrix To Produce

For each adapter, document:

- supports core event log
- supports stream query
- supports optimistic concurrency
- supports snapshot
- suitable for multi-instance aggregate writes

## Projection Work

Add one or more example projection paths showing:

- aggregate uses event-store adapter
- projection uses projection adapter
- rebuild only affects projections
- aggregate command handling still works after projection reset

## Tests

Add tests for:

- stream query semantics on upgraded adapters
- OCC correctness on adapters that claim support
- commit-order scan/export semantics on adapters that claim support
- snapshot read/write on adapters that claim support
- projection rebuild after projection data deletion
- aggregate writes continuing to work even when projection state is empty or stale

## Exit Criteria

- at least two key adapters support the new model end-to-end
- projection correctness is visibly decoupled from aggregate correctness
- capability documentation exists for all maintained adapters
