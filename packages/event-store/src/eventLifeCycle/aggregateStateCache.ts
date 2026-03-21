import type { CreatedEvent, EventFlowMap } from '@schemeless/event-store-types';
import { getEventFlow } from '../operators/getEventFlow';
import { isAggregateEventFlow } from '../operators/isAggregateEventFlow';

const makeAggregateKey = (domain: string, identifier: string) => `${domain}::${identifier}`;

const byEventId = new Map<string, unknown>();
const byAggregateKey = new Map<string, unknown>();

export const aggregateStateCache = {
  set: <State>(eventId: string, domain: string, identifier: string, state: State): void => {
    byEventId.set(eventId, state);
    byAggregateKey.set(makeAggregateKey(domain, identifier), state);
  },
  getByEventId: <State>(eventId: string): State | undefined => byEventId.get(eventId) as State | undefined,
  hasByEventId: (eventId: string): boolean => byEventId.has(eventId),
  deleteByEventId: (eventId: string): void => {
    byEventId.delete(eventId);
  },
  getByAggregateKey: <State>(domain: string, identifier: string): State | undefined =>
    byAggregateKey.get(makeAggregateKey(domain, identifier)) as State | undefined,
  hasByAggregateKey: (domain: string, identifier: string): boolean =>
    byAggregateKey.has(makeAggregateKey(domain, identifier)),
  deleteByAggregateKey: (domain: string, identifier: string): void => {
    byAggregateKey.delete(makeAggregateKey(domain, identifier));
  },
};

export const aggregateKey = makeAggregateKey;

export const clearAggregateStateForEvents = (eventFlowMap: EventFlowMap, events: CreatedEvent<any>[]): void => {
  for (const event of events) {
    try {
      const eventFlow = getEventFlow(eventFlowMap)(event);
      if (!isAggregateEventFlow(eventFlow)) continue;

      const identifier = eventFlow.aggregate.getIdentifier?.(event) ?? event.identifier;
      if (!identifier) continue;

      aggregateStateCache.deleteByEventId(event.id);
      aggregateStateCache.deleteByAggregateKey(eventFlow.domain, identifier);
    } catch {
      // Best-effort cleanup.
    }
  }
};
