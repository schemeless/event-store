import { logger } from './util/logger';
import { ConnectionOptions } from 'typeorm';
import * as Rx from 'rxjs/operators';
import { logEvent } from './util/logEvent';
import { EventStoreRepo } from './repo/EventStore.repo';
import { BaseEventInput, CreatedEvent, EventFlow, EventTaskAndError } from './EventStore.types';
import { makeMainQueue } from './makeMainQueue';
import { Observable } from 'rxjs';
import { registerEventFlowTypes } from './operators/registerEventFlowTypes';
import { getEventFlow } from './operators/getEventFlow';

const makeReceiver = (mainQueue: ReturnType<typeof makeMainQueue>) => (eventFlow: EventFlow) => (
  eventInput: BaseEventInput<any>
): Promise<CreatedEvent<any>[]> => {
  const event = Object.assign({}, eventInput, {
    domain: eventFlow.domain,
    type: eventFlow.type
  });
  return new Promise((resolve, reject) => {
    mainQueue.push(event, (err: EventTaskAndError, doneEvents: CreatedEvent<any>[]) =>
      err ? reject(err) : resolve(doneEvents)
    );
  });
};

const makeReplay = (eventFlows: EventFlow[], eventStoreRepo: EventStoreRepo) => async () => {
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
        logEvent(currentEvent, '✅️️', 'Apply');
        if (EventFlow.executor) {
          await EventFlow.executor(currentEvent);
        }
      }, null);
      page++;
    } else {
      logger.info(`replay finished pages ${page}`);
      break;
    }
  }
};

export type EventStore = {
  mainQueue: ReturnType<typeof makeMainQueue>;
  eventStoreRepo: EventStoreRepo;
  receiver: ReturnType<typeof makeReceiver>;
  replay: ReturnType<typeof makeReplay>;
  mainQueueProcessed$: Observable<void>;
};

const makeEventStore = (connectionOptions: ConnectionOptions) => async (
  eventFlows: EventFlow[]
): Promise<EventStore> => {
  const eventStoreRepo = new EventStoreRepo(connectionOptions);
  const mainQueue = makeMainQueue(eventFlows);

  await this.eventStoreRepo.init();

  const mainQueueProcessed$ = mainQueue.processed$.pipe(
    // todo do side effect
    Rx.concatMap(async ([doneEvents, eventTaskAndError]) => {
      if (!eventTaskAndError) {
        return eventStoreRepo.storeEvents(doneEvents);
      } else {
        // todo store failed event
      }
    })
  );

  return {
    mainQueue,
    eventStoreRepo,
    receiver: makeReceiver(mainQueue),
    replay: makeReplay(eventFlows, eventStoreRepo),
    mainQueueProcessed$
  };
};
