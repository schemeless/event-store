import type {
  AggregateEventObserver,
  CreatedEvent,
  EventFlow,
  IEventStoreRepo,
  SuccessEventObserver,
} from '@schemeless/event-store-types';
import { registerEventFlowTypes } from './operators/registerEventFlowTypes';
import { logger } from './util/logger';
import { getEventFlow } from './operators/getEventFlow';
import { logEvent } from './util/logEvent';
import { isAggregateEventFlow } from './operators/isAggregateEventFlow';
import { runObservers, ProcessedEventWithState } from './pipeline/ObserverRunner';

// A simple utility to scope aggregate keys per domain.
const aggregateKey = (domain: string, id: string) => `${domain}__${id}`;

export const makeReplay =
  (
    eventFlows: EventFlow[],
    successEventObservers: Array<SuccessEventObserver<any> | AggregateEventObserver<any, any>> = [],
    eventStoreRepo: IEventStoreRepo
  ) =>
  async (startFromId?: string) => {
    const eventFlowMap = registerEventFlowTypes({}, eventFlows);
    let pageSize = 200;
    logger.info('replay starting');
    const eventStoreIterator = await eventStoreRepo.getAllEvents(pageSize, startFromId);
    const aggregateStateByAggregateKey = new Map<string, unknown>();

    for await (const events of eventStoreIterator) {
      if (events.length > 0) {
        logger.info(`replaying ${events.length}`);
        
        for (const rawEvent of events) {
          Object.assign(rawEvent, { created: new Date(rawEvent.created) });
          const currentEvent = rawEvent as CreatedEvent<any>;
          const EventFlow = getEventFlow(eventFlowMap)(currentEvent);
          logEvent(currentEvent, '✅️️', 'Apply');
          
          let aggregateState: unknown = undefined;

          if (isAggregateEventFlow(EventFlow)) {
            const aggregateEventFlow = EventFlow as any;
            const identifier = aggregateEventFlow.aggregate.getIdentifier?.(currentEvent) ?? currentEvent.identifier;
            if (!identifier) {
              throw new Error(
                `AggregateEventFlow ${aggregateEventFlow.domain}/${aggregateEventFlow.type} requires an identifier`
              );
            }

            const key = aggregateKey(aggregateEventFlow.domain, identifier);
            const currentState = aggregateStateByAggregateKey.has(key)
              ? aggregateStateByAggregateKey.get(key)
              : aggregateEventFlow.aggregate.initialState;
              
            if (aggregateEventFlow.apply) {
              const replayApplyState = await aggregateEventFlow.apply(
                currentEvent,
                currentState
              );
              if (typeof replayApplyState === 'undefined') {
                throw new Error(
                  `AggregateEventFlow ${aggregateEventFlow.domain}/${aggregateEventFlow.type} apply() must return state`
                );
              }
            }
            
            const nextState = aggregateEventFlow.aggregate.reducer(
              currentState,
              currentEvent
            );

            if (typeof nextState === 'undefined') {
              throw new Error(
                `AggregateEventFlow ${aggregateEventFlow.domain}/${aggregateEventFlow.type} reducer() must return state`
              );
            }

            aggregateStateByAggregateKey.set(key, nextState);
            aggregateState = nextState;
          } else if (EventFlow.apply) {
            await EventFlow.apply(currentEvent);
          }
          
          const processed: ProcessedEventWithState = {
            event: currentEvent,
            aggregateState,
          };
          
          await runObservers([processed], successEventObservers);
        }
      } else {
        logger.info(`replay apply done, waiting for observer finished`);
        break;
      }
    }
  };
