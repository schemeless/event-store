import { randomUUID } from 'crypto';
import type { PersistedEvent } from '@schemeless/event-store-types';
import type {
  CanRevertResult,
  CompensationRegistry,
  EventStoreRevert,
  PreviewRevertResult,
  RevertableEventStoreAdapter,
  RevertResult,
} from './types';

/**
 * Recursively collects all descendant events in post-order (leaves first).
 * Post-order ensures we compensate leaf events before their parents.
 */
async function collectDescendantsPostOrder(
  adapter: RevertableEventStoreAdapter,
  eventId: string
): Promise<PersistedEvent[]> {
  const children = await adapter.findByCausationId(eventId);
  const result: PersistedEvent[] = [];
  for (const child of children) {
    const childDescendants = await collectDescendantsPostOrder(adapter, child.id);
    result.push(...childDescendants);
    result.push(child);
  }
  return result;
}

function buildCompensatingEvent(original: PersistedEvent, compensated: PersistedEvent): PersistedEvent {
  return {
    ...compensated,
    id: randomUUID(),
    correlationId: original.correlationId ?? original.id,
    causationId: original.id,
    meta: {
      ...((compensated as any).meta ?? {}),
      isCompensating: true,
      compensatesEventId: original.id,
    },
    created: new Date(),
    sequence: undefined,
  };
}

export function makeEventStoreRevert(
  adapter: RevertableEventStoreAdapter,
  registry: CompensationRegistry
): EventStoreRevert {
  async function getRootAndDescendants(eventId: string): Promise<{
    root: PersistedEvent;
    descendants: PersistedEvent[];
  }> {
    const root = await adapter.getEventById(eventId);
    if (!root) {
      throw new Error(`Event not found: ${eventId}`);
    }
    const descendants = await collectDescendantsPostOrder(adapter, eventId);
    return { root, descendants };
  }

  return {
    async canRevert(eventId) {
      const { root, descendants } = await getRootAndDescendants(eventId);
      const allEvents = [...descendants, root];
      const blocked: CanRevertResult['blockedBy'] = [];

      for (const event of allEvents) {
        if (!registry.get(event.domain, event.type)) {
          blocked.push({
            eventId: event.id,
            domain: event.domain,
            type: event.type,
            reason: `No compensation registered for ${event.domain}::${event.type}`,
          });
        }
      }

      if (blocked.length > 0) {
        return { canRevert: false, blockedBy: blocked };
      }
      return { canRevert: true };
    },

    async previewRevert(eventId) {
      const { root, descendants } = await getRootAndDescendants(eventId);
      return { rootEvent: root, descendantEvents: descendants };
    },

    async revert(eventId) {
      const { root, descendants } = await getRootAndDescendants(eventId);

      // Validate all events have compensation before touching the store.
      const allEvents = [...descendants, root];
      for (const event of allEvents) {
        if (!registry.get(event.domain, event.type)) {
          throw new Error(
            `Cannot revert: no compensation registered for ${event.domain}::${event.type} (eventId: ${event.id})`
          );
        }
      }

      // Generate compensating events in post-order (leaves first, root last).
      const compensatingEvents: PersistedEvent[] = [];
      for (const event of allEvents) {
        const compensateFn = registry.get(event.domain, event.type)!;
        const compensated = compensateFn(event);
        const raw = Array.isArray(compensated) ? compensated : [compensated];
        for (const c of raw) {
          compensatingEvents.push(buildCompensatingEvent(event, c as PersistedEvent));
        }
      }

      await adapter.append(compensatingEvents);
      return { compensatingEvents };
    },
  };
}
