# Step 4: Prove the Model With One Reference Aggregate

## Objective

Use one realistic aggregate to validate the redesign end-to-end before migrating broader surfaces.

The reference aggregate should be concrete enough to exercise:

- command handling
- hydration
- OCC
- projection updates
- read-model rebuild
- snapshot-assisted recovery

## Recommended Aggregate

Use a `CashAccount` aggregate with commands such as:

- `OpenCashAccount`
- `DepositCash`
- `WithdrawCash`

And events such as:

- `CashAccountOpened`
- `CashDeposited`
- `CashWithdrawn`

## Why This Aggregate

It is small enough to understand, but rich enough to test:

- stateful business rules
- identifier stability
- non-trivial event evolution
- observer-driven projection updates

## Required Work

1. Implement aggregate definition using the new runtime
2. Implement one read-model observer set for balances/account summaries
3. Add a rebuild flow that reconstructs those read models from persisted events
4. Add snapshot-assisted hydrate coverage
5. Add OCC conflict scenarios

## Tests

Add an end-to-end scenario covering:

1. open account
2. deposit funds
3. withdraw funds
4. reject over-withdraw
5. rebuild read models from scratch
6. hydrate after restart using snapshot + trailing events
7. concurrent writes causing one OCC failure

## Exit Criteria

- one aggregate is fully functional on the new architecture
- aggregate writes do not rely on projection freshness
- rebuild of read models is fully separate from aggregate hydration
- the example is strong enough to serve as migration documentation later
