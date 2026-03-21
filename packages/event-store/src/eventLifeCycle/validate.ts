import { logEvent } from '../util/logEvent';
import type { CreatedEvent, EventFlow, IEventStoreEntity } from '@schemeless/event-store-types';
import { isAggregateEventFlow } from '../operators/isAggregateEventFlow';
import { aggregateStateCache } from './aggregateStateCache';

type AggregateLoader = <State>(
  domain: string,
  identifier: string,
  reducer: (state: State, event: IEventStoreEntity) => State,
  initialState: State
) => Promise<{ state: State; sequence: number }>;

export const validate = async (
  eventFlow: EventFlow<any, any, any>,
  event: CreatedEvent<any, any>,
  getAggregate?: AggregateLoader
): Promise<void> => {
  try {
    if (isAggregateEventFlow(eventFlow)) {
      const identifier = eventFlow.aggregate.getIdentifier?.(event) ?? event.identifier;
      if (!identifier) {
        throw new Error(`AggregateEventFlow ${eventFlow.domain}/${eventFlow.type} requires an identifier`);
      }

      if (!aggregateStateCache.hasByEventId(event.id)) {
        const cachedState = aggregateStateCache.hasByAggregateKey(eventFlow.domain, identifier)
          ? aggregateStateCache.getByAggregateKey(eventFlow.domain, identifier)
          : undefined;

        if (aggregateStateCache.hasByAggregateKey(eventFlow.domain, identifier)) {
          aggregateStateCache.set(event.id, eventFlow.domain, identifier, cachedState);
        } else {
          if (!getAggregate) {
            throw new Error(
              `AggregateEventFlow ${eventFlow.domain}/${eventFlow.type} requires getAggregate() support to load state`
            );
          }
          const { state } = await getAggregate(
            eventFlow.domain,
            identifier,
            eventFlow.aggregate.reducer,
            eventFlow.aggregate.initialState
          );
          aggregateStateCache.set(event.id, eventFlow.domain, identifier, state);
        }
      }

      const state = aggregateStateCache.getByEventId(event.id);
      const error = eventFlow.validate ? await eventFlow.validate(event, state as any) : undefined;
      if (error instanceof Error) throw error;
    } else {
      const error = eventFlow.validate ? await eventFlow.validate(event) : undefined;
      if (error instanceof Error) throw error;
    }
  } catch (error) {
    logEvent(event, '⚠️', 'unverified', error.message);
    throw error;
  }
  logEvent(event, '☑️', 'verified');
};
