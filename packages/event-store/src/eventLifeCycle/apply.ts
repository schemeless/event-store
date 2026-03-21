import type { CreatedEvent, EventFlow, IEventStoreEntity } from '@schemeless/event-store-types';
import { logEvent } from '../util/logEvent';
import { AggregateError } from '@schemeless/event-store-types';
import { isAggregateEventFlow } from '../operators/isAggregateEventFlow';
import { aggregateStateCache } from './aggregateStateCache';

type AggregateLoader = <State>(
  domain: string,
  identifier: string,
  reducer: (state: State, event: IEventStoreEntity) => State,
  initialState: State
) => Promise<{ state: State; sequence: number }>;

export const apply = async (
  eventFlow: EventFlow<any, any, any>,
  event: CreatedEvent<any, any>,
  getAggregate?: AggregateLoader
): Promise<void> => {
  logEvent(event, '✅️', 'Apply');
  if (!isAggregateEventFlow(eventFlow)) {
    if (!eventFlow.apply) return;
    return eventFlow.apply(event);
  }

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

  const currentState = aggregateStateCache.getByEventId(event.id);

  if (!eventFlow.apply) {
    aggregateStateCache.set(event.id, eventFlow.domain, identifier, currentState as any);
    return;
  }

  const nextState = await eventFlow.apply(event, currentState as any);
  if (typeof nextState === 'undefined') {
    throw new AggregateError(eventFlow, 'apply_must_return_state');
  }

  aggregateStateCache.set(event.id, eventFlow.domain, identifier, nextState);
};
