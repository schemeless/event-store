# Revert Guide

Revert support lets you undo a root event and its descendants by generating compensating events.

## APIs

- `canRevert(eventId)`: validates if a revert is possible
- `previewRevert(eventId)`: shows impacted event tree
- `revert(eventId)`: executes revert and persists compensating events

## Preconditions

Revert requires repository support for:

- `getEventById(id)`
- `findByCausationId(causationId)`

And flow-level support:

- every event in the target tree must provide `compensate`

## Root-event restriction

Only root events are revertable. A root event has no `causationId`.

Attempting to revert non-root events fails by design.

## Compensate contract

`compensate(originalEvent)` should return one or more base events that semantically reverse the original effect.

The framework automatically populates the following metadata for compensating events:

- `id`: Unique ULID for the new event.
- `created`: Current timestamp.
- `causationId`: Points to the ID of the event being reverted.
- `correlationId`: Inherited from the original event.
- `identifier`: Inherited from the original event.
- `meta.schemaVersion`: Injected from the target flow's `schemaVersion`.
- `meta.isCompensating`: Set to `true`.
- `meta.compensatesEventId`: Set to the ID of the event being reverted.

Recommendations:

- Keep compensation idempotent at business level
- You only need to return the business payload; the framework handles the event system fields.
- Validate compensation events with the same rigor as normal events

## Safe workflow

1. call `canRevert`
2. if allowed, call `previewRevert`
3. show preview to operator/user
4. execute `revert`
5. monitor output stream and observers

## Example

```ts
const check = await store.canRevert(rootEventId);
if (!check.canRevert) {
  throw new Error(check.reason ?? 'cannot revert');
}

const preview = await store.previewRevert(rootEventId);
console.log('events to revert:', preview.eventsToRevert.length);

const result = await store.revert(rootEventId);
console.log('generated compensating events:', result.compensatingEvents.length);
```

## Operational note

Revert is a domain operation, not just a technical rollback. Define compensation semantics with product/domain stakeholders before enabling it in production workflows.
