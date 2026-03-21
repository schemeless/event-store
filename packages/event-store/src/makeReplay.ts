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
import { makeObserverQueue } from './queue/makeObserverQueue';
import { aggregateKey } from './eventLifeCycle/aggregateStateCache';
import { isAggregateEventFlow } from './operators/isAggregateEventFlow';

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
    const aggregateStateByEventId = new Map<string, unknown>();
    const observerQueue = makeObserverQueue(successEventObservers, {
      getAggregateState: (event) => aggregateStateByEventId.get(event.id),
      hasAggregateState: (event) => aggregateStateByEventId.has(event.id),
    });
    const hasAggregateObserverForEvent = (event: CreatedEvent<any>): boolean =>
      successEventObservers.some(
        (observer) =>
          (observer as any).aggregate === true &&
          observer.filters.some((filter) => filter.domain === event.domain && filter.type === event.type)
      );
    const subscription = observerQueue.processed$.subscribe({
      next: ({ event }) => {
        aggregateStateByEventId.delete(event.id);
      },
    });
    observerQueue.queueInstance.drained$.subscribe(() => logger.debug(`observerQueue drained`));
    for await (const events of eventStoreIterator) {
      if (events.length > 0) {
        logger.info(`replaying ${events.length}`);
        await events.reduce<Promise<any>>(async (acc, currentEvent) => {
          if (acc) await acc;
          Object.assign(currentEvent, { created: new Date(currentEvent.created) });
          const EventFlow = getEventFlow(eventFlowMap)(currentEvent);
          logEvent(currentEvent as CreatedEvent<any>, '✅️️', 'Apply');
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
                currentEvent as CreatedEvent<any>,
                currentState as any
              );
              if (typeof replayApplyState === 'undefined') {
                throw new Error(
                  `AggregateEventFlow ${aggregateEventFlow.domain}/${aggregateEventFlow.type} apply() must return state`
                );
              }
            }
            const nextState = aggregateEventFlow.aggregate.reducer(
              currentState as any,
              currentEvent as CreatedEvent<any>
            );

            if (typeof nextState === 'undefined') {
              throw new Error(
                `AggregateEventFlow ${aggregateEventFlow.domain}/${aggregateEventFlow.type} reducer() must return state`
              );
            }

            aggregateStateByAggregateKey.set(key, nextState);
            if (hasAggregateObserverForEvent(currentEvent)) {
              aggregateStateByEventId.set(currentEvent.id, nextState);
            }
          } else if (EventFlow.apply) {
            await EventFlow.apply(currentEvent as CreatedEvent<any>);
          }
          observerQueue.push(currentEvent as CreatedEvent<any>);
        }, null);
      } else {
        logger.info(`replay apply done, waiting for observer finished`);
        break;
      }
    }
  };
