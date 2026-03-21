import { logEvent } from '../util/logEvent';
import type { CreatedEvent, EventFlow, IEventStoreEntity } from '@schemeless/event-store-types';
import { AggregateError, ValidationError } from '@schemeless/event-store-types';
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
        throw new AggregateError(eventFlow, 'no_identifier');
      }

      if (!aggregateStateCache.hasByEventId(event.id)) {
        const cachedState = aggregateStateCache.hasByAggregateKey(eventFlow.domain, identifier)
          ? aggregateStateCache.getByAggregateKey(eventFlow.domain, identifier)
          : undefined;

        if (aggregateStateCache.hasByAggregateKey(eventFlow.domain, identifier)) {
          aggregateStateCache.set(event.id, eventFlow.domain, identifier, cachedState);
        } else {
          if (!getAggregate) {
            throw new AggregateError(eventFlow, 'no_loader');
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
      if (error instanceof Error) throw new ValidationError(eventFlow, event.id, error);
    } else {
      const error = eventFlow.validate ? await eventFlow.validate(event) : undefined;
      if (error instanceof Error) throw new ValidationError(eventFlow, event.id, error);
    }
  } catch (error) {
    logEvent(event, '⚠️', 'unverified', error instanceof Error ? error.message : String(error));
    throw error;
  }
  logEvent(event, '☑️', 'verified');
};
