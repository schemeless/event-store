# Step 6: Publish Migration Guide and Remove Old Architecture

## Objective

Once the new architecture is proven, publish a strong migration guide and remove the old abstraction model rather than running both systems in parallel.

This step is intentionally last.

## Scope

Remove or deprecate:

- old `EventFlow`
- old `AggregateEventFlow`
- overloaded `replay()` semantics
- old aggregate-aware hooks in the current package surface

Publish:

- migration guide
- architecture guide
- one complete example aggregate

## Required Work

1. Write migration documentation from old concepts to new concepts
2. Replace old docs with core/aggregate terminology
3. Remove dead code and outdated tests
4. Remove compatibility APIs unless there is an explicit business reason not to
5. Update package READMEs and top-level architecture docs

## Migration Mapping To Document

- `validate` -> `precondition` or `validateEvent`
- aggregate `apply` -> `evolve`
- `createConsequentEvents` -> return `Event[]` from `decide`
- `replay()` -> `rebuildReadModels()`
- `submit(flow, input)` -> `aggregateRuntime.handle(aggregate, command)`

## Documentation Deliverables

- V6 migration guide
- package-level READMEs for core and aggregate
- updated architecture doc
- adapter capability matrix
- one `CashAccount` example walkthrough

## Deletion Rules

- do not keep dual write-side models longer than necessary
- prefer deleting ambiguous abstractions over preserving them behind aliases
- keep historical docs only as migration references

## Exit Criteria

- old architecture is removed or clearly isolated as unsupported
- migration guide is sufficient for downstream adoption
- public docs no longer present replay as aggregate recovery
- the repository presents one coherent architecture, not two competing ones
