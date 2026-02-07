# OCC Improvements Migration Guide

This guide helps you adopt the latest Optimistic Concurrency Control (OCC) improvements in `@schemeless/event-store` adapters.

## What Changed?

### DynamoDB Adapter (`@schemeless/event-store-adapter-dynamodb`)

**Fixed**: Duplicate S3 uploads when storing large batches (>25 items).

- **Before**: Recursively chunking batches would trigger S3 upload for each chunk.
- **After**: S3 offload happens once before chunking begins.

**Impact**: ✅ No breaking changes. Performance improvement only.

### TypeORM Adapter (`@schemeless/event-store-adapter-typeorm`)

**Enhanced**: Error handling for concurrency conflicts.

- **Added**: Support for MySQL `ER_DUP_ENTRY` error code.
- **Improved**: `ConcurrencyError` now includes the actual current sequence (re-queried from DB).

**Impact**: ✅ No breaking changes. Better error messages.

---

## Usage Recommendations

### 1. Using `expectedSequence` with Multi-Stream Batches

When batching events across multiple streams:

```ts
await repo.storeEvents([
  { domain: 'Account', identifier: 'user-1', payload: {...} },
  { domain: 'Account', identifier: 'user-2', payload: {...} },
], { expectedSequence: 3 });
```

**Behavior**: The `expectedSequence` check applies to **each stream independently**.

- `user-1` stream must be at sequence 3.
- `user-2` stream must be at sequence 3.

**Recommendation**:
- For multi-stream batches, omit `expectedSequence` unless you're certain all streams are at the same version.
- Use per-stream version checks before batching if strict control is needed.

### 2. Handling Large Batches (>25 items)

DynamoDB limits `TransactWriteItems` to 25 operations. The adapter handles this automatically:

```ts
const events = Array.from({ length: 100 }, (_, i) => ({
  domain: 'Test',
  type: 'created',
  payload: { index: i },
  identifier: 'batch-test',
}));

// Automatically chunked into 4 batches of 25
await repo.storeEvents(events);
```

**S3 Offloading**: If any event's payload exceeds the size limit, it's uploaded to S3 **once** before chunking.

### 3. Error Handling

All adapters throw `ConcurrencyError` consistently:

```ts
import { ConcurrencyError } from '@schemeless/event-store-types';

try {
  await repo.storeEvents(events, { expectedSequence: current });
} catch (error) {
  if (error instanceof ConcurrencyError) {
    console.log(`Conflict: expected ${error.expected}, found ${error.found}`);
    // Retry logic here
  }
}
```

**TypeORM-Specific**: The adapter now re-queries the database to provide the accurate current sequence in `error.found`.

---

## Testing Your Integration

### Verify Large Batch Handling

```ts
const largePayload = { data: 'x'.repeat(500_000) }; // >400KB
const events = Array.from({ length: 30 }, () => ({
  domain: 'Test',
  type: 'large',
  payload: largePayload,
  identifier: 'batch',
}));

await repo.storeEvents(events);

// Verify: All 30 events stored, S3 upload happened once per event
const stored = await repo.getAllEvents('Test', 'batch');
expect(stored.length).toBe(30);
```

### Verify Concurrency Protection

```ts
const current = await repo.getStreamSequence('Account', 'user-1');

// Simulate race condition
const promises = [
  repo.storeEvents([event1], { expectedSequence: current }),
  repo.storeEvents([event2], { expectedSequence: current }),
];

const results = await Promise.allSettled(promises);

// One should succeed, one should reject with ConcurrencyError
const rejected = results.filter(r => r.status === 'rejected');
expect(rejected.length).toBe(1);
expect(rejected[0].reason).toBeInstanceOf(ConcurrencyError);
```

---

## Upgrade Checklist

- [ ] Update to latest version: `yarn upgrade @schemeless/event-store-adapter-*`
- [ ] Review code using `expectedSequence` with multi-stream batches
- [ ] Update error handling to utilize `ConcurrencyError.found` for better diagnostics
- [ ] Run integration tests to verify large batch handling
- [ ] (Optional) Add concurrency tests to your suite

---

## Questions?

- Check the [CHANGELOG](../../CHANGELOG.md) for detailed release notes.
- Review test files: `EventStore.dynamodb.batch.test.ts`, `EventStore.concurrency.test.ts`.
