import * as Rx from 'rxjs/operators';
import {
  CreatedEvent,
  EventFlow,
  EventFlowMap,
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
import { EventStore, EventStoreOptions } from './EventStore.types';
import { makeRevert } from './revert/makeRevert';

export const makeEventStore =
  (eventStoreRepo: IEventStoreRepo, options: EventStoreOptions = {}) =>
    async (eventFlows: EventFlow[], successEventObservers: SuccessEventObserver<any>[] = []): Promise<EventStore> => {
      const {
        mainQueueConcurrent = 1,
        sideEffectQueueConcurrent = 1,
        observerQueueConcurrent = 1,
      } = options;

      const mainQueue = makeMainQueue(eventFlows, { concurrent: mainQueueConcurrent });
      const sideEffectQueue = makeSideEffectQueue(eventFlows, mainQueue, { concurrent: sideEffectQueueConcurrent });

      await eventStoreRepo.init();

      // Build event flow map for revert lookups
      const eventFlowMap: EventFlowMap = {};
      for (const flow of eventFlows) {
        const key = `${flow.domain}__${flow.type}`;
        eventFlowMap[key] = flow;
      }

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

      // Create revert functions
      const { canRevert, previewRevert, revert } = makeRevert({
        repo: eventStoreRepo,
        eventFlowMap,
        storeEvents: (events) => eventStoreRepo.storeEvents(events),
      });

      // Graceful shutdown implementation
      const shutdown = async (timeout = 5000): Promise<void> => {
        const shutdownPromise = (async () => {
          // 1. Pause queues to stop accepting new tasks
          mainQueue.queueInstance.pause();
          sideEffectQueue.queueInstance.pause();

          // 2. Wait for queues to drain
          await Promise.all([mainQueue.queueInstance.drain(), sideEffectQueue.queueInstance.drain()]);

          // 3. Destroy queues
          await Promise.all([mainQueue.queueInstance.destroy(), sideEffectQueue.queueInstance.destroy()]);

          // 4. Close repo if it supports closing
          if (eventStoreRepo.close) {
            await eventStoreRepo.close();
          }
        })();

        // Timeout protection
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('EventStore shutdown timeout')), timeout)
        );

        await Promise.race([shutdownPromise, timeoutPromise]);
      };

      return {
        mainQueue,
        sideEffectQueue,
        receive: makeReceive(mainQueue, successEventObservers, {
          observerQueueConcurrent,
        }),
        replay: makeReplay(eventFlows, successEventObservers, eventStoreRepo),
        eventStoreRepo: eventStoreRepo,
        output$,
        canRevert,
        previewRevert,
        revert,
        shutdown,
      };
    };
