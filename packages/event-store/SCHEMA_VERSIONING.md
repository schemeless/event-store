# Schema Versioning & Upcasting Guide

As your application evolves, the structure of your events (Payload) will inevitably change. **Schema Versioning** allows you to evolve your event definitions without breaking existing data or complicating your business logic.

## The Problem

Imagine you have an `OrderPlaced` event:

```typescript
// Version 1
interface OrderPlacedPayload {
  price: number; // e.g., 100
}
```

Three months later, you need to support multiple currencies:

```typescript
// Version 2
interface OrderPlacedPayload {
  price: { amount: number; currency: string }; // e.g., { amount: 100, currency: 'USD' }
}
```

Without versioning, your consumers (projections, side effects) would need to handle both structures:

```typescript
// ❌ The Anti-Pattern: Spaghetti Code
if (typeof event.payload.price === 'number') {
  // handle V1
} else {
  // handle V2
}
```

## The Solution: Upcasting

**Upcasting** is the process of transforming an old event (V1) into the new structure (V2) **before** it reaches your business logic. This ensures your code only ever deals with the *latest* version.

### How it works in @schemeless/event-store

1.  **Define Version**: You tag your `EventFlow` with a `schemaVersion`.
2.  **Define Upcaster**: You provide an `upcast` hook to migrate older data.
3.  **Automatic Migration**: When the system reads an event (during correct or replay), it checks `event.meta.schemaVersion`. If it's older than the flow's version, it runs the upcaster.

## Implementation

### 1. Define your Payloads

Always define interfaces for your versions.

```typescript
interface OrderPlacedPayloadV1 {
  price: number;
}

interface OrderPlacedPayloadV2 {
  price: { amount: number; currency: string };
}
```

### 2. Configure the EventFlow

Use the **latest** payload type in your `EventFlow` generic.

```typescript
import { EventFlow } from '@schemeless/event-store-types';

export const OrderPlaced: EventFlow<OrderPlacedPayloadV2> = {
  domain: 'order',
  type: 'placed',

  // ✅ Set the CURRENT version
  schemaVersion: 2,

  // ✅ Define the migration logic
  upcast: (event, fromVersion) => {
    if (fromVersion < 2) {
      // Migrate V1 -> V2
      const oldPayload = event.payload as unknown as OrderPlacedPayloadV1;
      return {
        ...event,
        payload: {
          ...oldPayload,
          price: {
            amount: oldPayload.price,
            currency: 'USD', // Default value
          },
        },
      };
    }
    // Return void if no changes are needed
  },

  // ✅ Business logic only sees V2
  apply: async (event) => {
    console.log(event.payload.price.currency); // Safe!
  },
};
```

## Frequently Asked Questions

### When does upcasting happen?
- **Receive**: When you store a new event, it is automatically stamped with the current `schemaVersion`.
- **Replay**: When you replay history to rebuild read models, old events are upcasted on-the-fly.
- **Runtime**: Even during normal processing, if you read an old event from the store (e.g., for validation contexts), it gets upcasted.

### Does it modify the database?
**No.** The raw event in the database remains immutable (V1). Upcasting happens in memory when the event is loaded. This preserves the "Source of Truth" and allows you to fix/change upcasting logic if you made a mistake.

### Can I chain versions (V1 -> V2 -> V3)?
Yes. Your `upcast` function should handle the progression.

```typescript
upcast: (event, fromVersion) => {
  let payload = event.payload;
  
  if (fromVersion < 2) {
    payload = migrateV1toV2(payload);
  }
  if (fromVersion < 3) {
    payload = migrateV2toV3(payload);
  }
  
  return { ...event, payload };
}
```
