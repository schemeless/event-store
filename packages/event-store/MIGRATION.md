# Event Store Sharding Migration Guide

This guide details how to adopt the new Key-Based Partitioning (Sharding) feature in `@schemeless/event-store` to achieve high-throughput parallel processing while maintaining data consistency.

## 🚀 Overview

**Before**: Global parallelism (`concurrent > 1`) caused race conditions for events belonging to the same entity.
**After**: Events are routed to shards based on a key (e.g., `userId`).
- **Same Key**: Strict sequential processing (Safety ✅)
- **Different Keys**: Parallel processing (Speed 🚀)

---

## 📦 1. Upgrade Packages

Ensure all packages are updated to the latest version verifying the sharding implementation.

```bash
yarn upgrade @schemeless/event-store @schemeless/event-store-types
```

---

## 🛠 2. Implementation Steps

### Step A: Define Shard Keys in EventFlows

For every `EventFlow` where order matters (e.g., per-user, per-order), implement the `getShardKey` method.

**Example: User Domain**
```typescript
const UserCreated: EventFlow<{ userId: string; email: string }> = {
  domain: 'user',
  type: 'created',
  // 🔑 KEY STEP: Map the event to a specific shard key
  getShardKey: (event) => event.payload.userId,
  
  receive: (es) => es.receive(UserCreated),
  apply: async (event) => { /* ... */ }
};
```

**Example: Order Domain**
```typescript
const OrderPlaced: EventFlow<{ orderId: string; userId: string }> = {
  domain: 'order',
  type: 'placed',
  // 💡 Tip: You can shard by orderId OR userId depending on your consistency boundary
  getShardKey: (event) => event.payload.orderId,
  // ...
};
```

> **Fallback Behavior**: If `getShardKey` is missing, the system falls back to `event.identifier`, and finally to Shard 0 (Serial).

### Step B: Configure Event Store Concurrency

Update your `makeEventStore` configuration to enable multiple partitions.

```typescript
const store = await makeEventStore(
  [UserCreated, OrderPlaced, ...],
  repo,
  observers,
  {
    // ⚡️ Enable 10 parallel lanes
    mainQueueConcurrent: 10,
    
    // ⚡️ Enable 10 parallel lanes for side effects
    sideEffectQueueConcurrent: 10, 
  }
);
```

**Recommended Configuration**:
- **Low Load**: `concurrent: 1` (Default, Backward Compatible)
- **High Load**: `concurrent: 10-50` (Depending on DB connection limits)

---

## ⚠️ 3. Important Considerations

### Side Effects
Side effects (events triggered by other events) automatically inherit the sharding logic of the *new* event they create.
- If `UserCreated` (Shard A) triggers `SendEmail` (Shard B), they run in their respective lanes.
- You do **not** need to manually manage context or keys between parent and child events.

### Observers
Observers currently run in a **Global Serial Queue** (`concurrent: 1`).
- This ensures Read Models are updated reliably in order.
- Sharding for observers is planned for Phase 2.

### Breaking Changes?
- **No**. The implementation is fully backward compatible.
- If you don't implement `getShardKey` and keep `concurrent: 1`, it behaves exactly as before.

---

## ✅ 4. Verification

After deploying, monitor your logs for:
1. **Parallel Execution**: You should see events from different users processing momentarily overlapping in time.
2. **Correct Ordering**: You should NEVER see `Seq 2` start before `Seq 1` for the *same* user finishes.

### Troubleshooting
If you suspect race conditions:
1. Check `getShardKey` implementation (is it returning undefined?).
2. Verify `mainQueueConcurrent > 1`.
