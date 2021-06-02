import type { CreatedEvent, EventFlow, IEventStoreRepo } from '@schemeless/event-store-types';
import { registerEventFlowTypes } from './operators/registerEventFlowTypes';
import { logger } from './util/logger';
import { getEventFlow } from './operators/getEventFlow';
import { logEvent } from './util/logEvent';
import { SuccessEventObserver } from '@schemeless/event-store-types';
import { makeObserverQueue } from './queue/makeObserverQueue';

export const makeReplay = (
  eventFlows: EventFlow[],
  successEventObservers: SuccessEventObserver<any>[] = [],
  eventStoreRepo: IEventStoreRepo
) => async () => {
  const eventFlowMap = registerEventFlowTypes({}, eventFlows);
  let pageSize = 200;
  logger.info('replay starting');
  const eventStoreIterator = await eventStoreRepo.getAllEvents(pageSize);
  const observerQueue = makeObserverQueue(successEventObservers);
  const subscription = observerQueue.processed$.subscribe();
  observerQueue.queueInstance.drained$.subscribe(() => logger.debug(`observerQueue drained`));
  for await (const events of eventStoreIterator) {
    if (events.length > 0) {
      logger.info(`replaying ${events.length}`);
      await events.reduce<Promise<any>>(async (acc, currentEvent) => {
        if (acc) await acc;
        Object.assign(currentEvent, { created: new Date(currentEvent.created) });
        const EventFlow = getEventFlow(eventFlowMap)(currentEvent);
        logEvent(currentEvent as CreatedEvent<any>, '✅️️', 'Apply');
        if (EventFlow.apply) {
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
