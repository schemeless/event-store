import * as Rx from 'rxjs/operators';
import {
  CreatedEvent,
  EventFlow,
  EventOutputState,
  EventTaskAndError,
  IEventStoreRepo,
  SuccessEventObserver,
} from '@schemeless/event-store-types';
import { makeMainQueue } from './queue/makeMainQueue';
import { makeReceive } from './queue/makeReceive';
import { makeReplay } from './makeReplay';
import { makeSideEffectQueue } from './queue/makeSideEffectQueue';
import { from, merge } from 'rxjs';
import { EventStore } from './EventStore.types';

export const makeEventStore =
  (eventStoreRepo: IEventStoreRepo) =>
  async (eventFlows: EventFlow[], successEventObservers: SuccessEventObserver<any>[] = []): Promise<EventStore> => {
    const mainQueue = makeMainQueue(eventFlows);
    const sideEffectQueue = makeSideEffectQueue(eventFlows, mainQueue);

    await eventStoreRepo.init();

    const mainQueueProcessed$ = mainQueue.processed$.pipe(
      Rx.concatMap(async ([doneEvents, eventTaskAndError]): Promise<[CreatedEvent<any>[], EventTaskAndError]> => {
        if (!eventTaskAndError) {
          await eventStoreRepo.storeEvents(doneEvents);
          doneEvents.forEach((event) => sideEffectQueue.push({ event, retryCount: 0 }));
          return [doneEvents, eventTaskAndError];
        } else {
          // todo store failed event
          return [doneEvents, eventTaskAndError];
        }
      }),
      Rx.mergeMap(([doneEvents, eventTaskAndError]) => {
        if (!eventTaskAndError) {
          return from(
            doneEvents.map((e) => ({
              event: e,
              state: EventOutputState.success,
            }))
          );
        } else {
          return from(
            [{ event: eventTaskAndError.task, state: EventOutputState.invalid, error: eventTaskAndError.error }].concat(
              doneEvents.map((e) => ({ event: e, state: EventOutputState.canceled, error: undefined }))
            )
          );
        }
      })
    );

    const doneAndSideEffect$ = merge(mainQueueProcessed$, sideEffectQueue.processed$).pipe(Rx.share());
    // const { result$, observerQueue } = assignObserver(doneAndSideEffect$, successEventObservers);
    const output$ = doneAndSideEffect$;
    // Ensure queues start draining even if callers only subscribe later.
    output$.subscribe(() => undefined);

    return {
      mainQueue,
      sideEffectQueue,
      receive: makeReceive(mainQueue, successEventObservers),
      replay: makeReplay(eventFlows, successEventObservers, eventStoreRepo),
      eventStoreRepo: eventStoreRepo,
      output$,
    };
  };
