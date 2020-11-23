import { BaseEvent, CreatedEvent, EventFlow } from '@schemeless/event-store-types';
import { EventStoreRepo } from './repo/EventStore.repo';
import { registerEventFlowTypes } from './operators/registerEventFlowTypes';
import { logger } from './util/logger';
import { getEventFlow } from './operators/getEventFlow';
import { logEvent } from './util/logEvent';

export const makeReplay = (eventFlows: EventFlow[], eventStoreRepo: EventStoreRepo) => async () => {
  const eventFlowMap = registerEventFlowTypes({}, eventFlows);
  let page = 0;
  logger.info('replay starting');
  while (true) {
    const events = await eventStoreRepo.getAllEvents(page);
    if (events.length > 0) {
      logger.info(`page, ${page}. replaying ${events.length}`);
      await events.reduce<Promise<any>>(async (acc, currentEvent) => {
        if (acc) await acc;
        const EventFlow = getEventFlow(eventFlowMap)(currentEvent);
        currentEvent.payload = JSON.parse(currentEvent.payload);
        logEvent(currentEvent as CreatedEvent<any>, '✅️️', 'Apply');
        if (EventFlow.apply) {
          await EventFlow.apply(currentEvent as CreatedEvent<any>);
        }
      }, null);
      page++;
    } else {
      logger.info(`replay finished pages ${page}`);
      break;
    }
  }
};
