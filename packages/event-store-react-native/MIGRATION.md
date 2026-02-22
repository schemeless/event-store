# `@schemeless/event-store-react-native` Migration Guide

> [!IMPORTANT] > **DEPRICATION NOTICE**: As of v3.1.0, this package is deprecated.
> React Native users should migration to the core [`@schemeless/event-store`](../event-store) package.
>
> **How to migrate:**
>
> 1. Uninstall `@schemeless/event-store-react-native`.
> 2. Install `@schemeless/event-store`.
> 3. Update all imports from `@schemeless/event-store-react-native` to `@schemeless/event-store`.
> 4. You can also uninstall `react-native-better-queue` as it is no longer needed.

This guide is for teams upgrading React Native apps from `2.8.x`.

## Target Versions

Use aligned package versions to avoid type/runtime drift:

```bash
yarn add \
  @schemeless/event-store-react-native@^3.0.3 \
  @schemeless/event-store-types@^3.0.1 \
  @schemeless/event-store-adapter-watermelondb@^3.0.1
```

If your app uses a different repo adapter, upgrade it to `^3.0.1` as well.

## Summary of What Changed Since 2.8.x

1. `mainQueueConcurrent > 1` now uses key-based partitioning (sharding) instead of naive global parallel processing.
2. Schema versioning and upcasting are now first-class (`schemaVersion`, `upcast`).
3. `getAggregate` was introduced in v3, but it is adapter-capability dependent.
4. Runtime includes stronger shutdown/drain reliability fixes in `3.0.3`.
5. Manual `causationId` assignment is deprecated; framework-managed causation is the intended path.

## Step 1: React Native Prerequisite Check

If your app (or dependencies) uses `uuid`, ensure `crypto.getRandomValues` is polyfilled:

```bash
npm install react-native-get-random-values
npx pod-install
```

```js
// app entry (once)
import 'react-native-get-random-values';
```

## Step 2: Audit Concurrency Behavior (Important)

From `2.9.0+`, parallel main queue processing is sharded.

- Before: `mainQueueConcurrent > 1` could race globally.
- Now: same shard key is processed sequentially; different shard keys can run in parallel.

If you rely on parallel throughput, explicitly define `getShardKey` on event flows where ordering boundaries matter:

```ts
const AccountDebitedFlow: EventFlow = {
  domain: 'account',
  type: 'debited',
  getShardKey: (event) => event.payload.accountId,
  receive: (es) => es.receive(AccountDebitedFlow),
};
```

Fallback order is: `getShardKey(event)` -> `event.identifier` -> shard `0` (serial lane).

## Step 3: Adopt Schema Versioning / Upcasting

For evolving payloads, add `schemaVersion` and `upcast`:

```ts
const OrderPlacedFlow: EventFlow<OrderV2> = {
  domain: 'order',
  type: 'placed',
  schemaVersion: 2,
  upcast: (event, fromVersion) => {
    if (fromVersion < 2) {
      return {
        ...event,
        payload: {
          ...event.payload,
          price: { amount: event.payload.price, currency: 'USD' },
        },
      };
    }
  },
  receive: (es) => es.receive(OrderPlacedFlow),
};
```

## Step 4: Gate `getAggregate` by Capability

`getAggregate` exists in v3, but only works when adapter capability is available.

Always guard calls:

```ts
if (eventStore.capabilities.aggregate) {
  const agg = await eventStore.getAggregate('account', accountId, reducer, initialState);
}
```

For `@schemeless/event-store-adapter-watermelondb@3.0.1`, aggregate replay capability is not declared/provided (no `getStreamEvents`), so `getAggregate` is typically unavailable.

## Step 5: Revert Feature Readiness

If you use `revert`/`canRevert`/`previewRevert`:

1. Ensure flows define `compensate` where needed.
2. Ensure adapter supports `getEventById` and `findByCausationId`.
3. Revert root events only (events without `causationId`).

`@schemeless/event-store-adapter-watermelondb` includes `getEventById` and `findByCausationId` in current versions.

## Step 6: Remove Manual `causationId` Usage

Manual `causationId` assignment is deprecated and emits runtime warnings in v3.
Do not set it manually in new code; let the framework derive causation for consequent events and side effects.

## Step 7: Shutdown and Lifecycle

On app teardown (or integration tests), call:

```ts
await eventStore.shutdown(5000);
```

`3.0.3` includes queue drain/shutdown reliability fixes; still treat `shutdown()` as mandatory for clean exits.

## Migration Checklist

- [ ] Upgrade RN runtime/types/adapter versions together.
- [ ] Add `react-native-get-random-values` polyfill if `uuid` is used.
- [ ] Audit all flows for shard key correctness when concurrency > 1.
- [ ] Add `schemaVersion`/`upcast` for changed payload schemas.
- [ ] Guard all `getAggregate` calls with `eventStore.capabilities.aggregate`.
- [ ] Remove manual `causationId` assignments.
- [ ] Ensure `shutdown()` is called during app/test teardown.
