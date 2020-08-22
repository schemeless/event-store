import { ConnectionOptions } from 'typeorm';
import * as Rx from 'rxjs/operators';
import { EventStoreRepo } from './repo/EventStore.repo';
import { CreatedEvent, EventFlow, EventOutputState, EventStore, EventTaskAndError } from './EventStore.types';
import { makeMainQueue } from './queue/makeMainQueue';
import { makeReceive } from './queue/makeReceive';
import { makeReplay } from './makeReplay';
import { makeSideEffectQueue } from './queue/makeSideEffectQueue';
import { from, merge } from 'rxjs';

export const makeEventStore = (connectionOptions: ConnectionOptions) => async (
  eventFlows: EventFlow[]
): Promise<EventStore> => {
  const eventStoreRepo = new EventStoreRepo(connectionOptions);
  const mainQueue = makeMainQueue(eventFlows);
  const sideEffectQueue = makeSideEffectQueue(eventFlows);

  await eventStoreRepo.init();

  const mainQueueProcessed$ = mainQueue.processed$.pipe(
    Rx.concatMap(
      async ([doneEvents, eventTaskAndError]): Promise<[CreatedEvent<any>[], EventTaskAndError]> => {
        if (!eventTaskAndError) {
          await eventStoreRepo.storeEvents(doneEvents);
          doneEvents.forEach(event => sideEffectQueue.push({ event, retryCount: 0 }));
          return [doneEvents, eventTaskAndError];
        } else {
          // todo store failed event
          return [doneEvents, eventTaskAndError];
        }
      }
    ),
    Rx.mergeMap(([doneEvents, eventTaskAndError]) => {
      if (!eventTaskAndError) {
        return from(
          doneEvents.map(e => ({
            event: e,
            state: EventOutputState.done
          }))
        );
      } else {
        return from(
          [{ event: eventTaskAndError.task, state: EventOutputState.invalid, error: eventTaskAndError.error }].concat(
            doneEvents.map(e => ({ event: e, state: EventOutputState.canceled, error: undefined }))
          )
        );
      }
    })
  );

  const output$ = merge(mainQueueProcessed$, sideEffectQueue.processed$);

  return {
    mainQueue,
    eventStoreRepo,
    receive: makeReceive(mainQueue),
    replay: makeReplay(eventFlows, eventStoreRepo),
    output$
  };
};
