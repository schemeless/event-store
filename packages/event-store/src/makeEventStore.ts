import * as Rx from 'rxjs/operators';
import {
  CreatedEvent,
  EventFlow,
  EventFlowMap,
  EventOutputState,
  EventTaskAndError,
  IEventStoreEntity,
  IEventStoreRepo,
  SuccessEventObserver,
} from '@schemeless/event-store-types';
import { makeMainQueue } from './queue/makeMainQueue';
import { makeReceive } from './queue/makeReceive';
import { makeReplay } from './makeReplay';
import { makeSideEffectQueue } from './queue/makeSideEffectQueue';
import { from, merge } from 'rxjs';
import { AggregateResult, EventStore, EventStoreOptions } from './EventStore.types';
import { makeRevert } from './revert/makeRevert';

export const makeEventStore =
  (eventStoreRepo: IEventStoreRepo, options: EventStoreOptions = {}) =>
  async (eventFlows: EventFlow[], successEventObservers: SuccessEventObserver<any>[] = []): Promise<EventStore> => {
    const { mainQueueConcurrent = 1, sideEffectQueueConcurrent = 1, observerQueueConcurrent = 1 } = options;

    const mainQueue = makeMainQueue(eventFlows, { concurrent: mainQueueConcurrent });
    const sideEffectQueue = makeSideEffectQueue(eventFlows, mainQueue, { concurrent: sideEffectQueueConcurrent });

    await eventStoreRepo.init();

    const declaredAggregateCapability = eventStoreRepo.capabilities?.aggregate;
    const capabilities: EventStore['capabilities'] = {
      aggregate: declaredAggregateCapability ?? !!eventStoreRepo.getStreamEvents,
    };

    // Build event flow map for revert lookups
    const eventFlowMap: EventFlowMap = {};
    for (const flow of eventFlows) {
      const key = `${flow.domain}__${flow.type}`;
      eventFlowMap[key] = flow;
    }

    let pendingMainPipelineTasks = 0;
    let resolveMainPipelineIdle: (() => void) | null = null;
    const waitForMainPipelineIdle = (): Promise<void> =>
      pendingMainPipelineTasks === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            resolveMainPipelineIdle = resolve;
          });
    const markMainPipelineTaskStart = () => {
      pendingMainPipelineTasks += 1;
    };
    const markMainPipelineTaskDone = () => {
      pendingMainPipelineTasks = Math.max(0, pendingMainPipelineTasks - 1);
      if (pendingMainPipelineTasks === 0 && resolveMainPipelineIdle) {
        const resolve = resolveMainPipelineIdle;
        resolveMainPipelineIdle = null;
        resolve();
      }
    };

    const mainQueueProcessed$ = mainQueue.processed$.pipe(
      Rx.tap(() => {
        markMainPipelineTaskStart();
      }),
      Rx.concatMap(async ([doneEvents, eventTaskAndError]): Promise<[CreatedEvent<any>[], EventTaskAndError]> => {
        try {
          if (!eventTaskAndError) {
            await eventStoreRepo.storeEvents(doneEvents);
            doneEvents.forEach((event) => sideEffectQueue.push({ event, retryCount: 0 }));
            return [doneEvents, eventTaskAndError];
          } else {
            // todo store failed event
            return [doneEvents, eventTaskAndError];
          }
        } finally {
          markMainPipelineTaskDone();
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
    const outputSubscription = output$.subscribe(() => undefined);

    // Create revert functions
    const { canRevert, previewRevert, revert } = makeRevert({
      repo: eventStoreRepo,
      eventFlowMap,
      storeEvents: (events) => eventStoreRepo.storeEvents(events),
    });

    const hasPendingQueueTasks = (queue: {
      partitionQueues?: Array<{ queueSize$?: { getValue: () => number | null } }>;
    }) => (queue.partitionQueues || []).some((partitionQueue) => (partitionQueue.queueSize$?.getValue() ?? 0) > 0);

    // Graceful shutdown implementation
    const shutdown = async (timeout = 5000): Promise<void> => {
      const shutdownPromise = (async () => {
        // 1. Repeatedly settle main/side-effect pipelines until both are idle.
        // Side effects can enqueue follow-up main events, so one pass is not enough.
        for (let i = 0; i < 12; i += 1) {
          await mainQueue.drain();
          await waitForMainPipelineIdle();
          await sideEffectQueue.drain();

          if (
            pendingMainPipelineTasks === 0 &&
            !hasPendingQueueTasks(mainQueue) &&
            !hasPendingQueueTasks(sideEffectQueue)
          ) {
            break;
          }
        }

        // 2. Stop queues and destroy resources.
        mainQueue.pause();
        sideEffectQueue.pause();
        await Promise.all([mainQueue.destroy(), sideEffectQueue.destroy()]);

        // 3. Close repo if it supports closing
        if (eventStoreRepo.close) {
          await eventStoreRepo.close();
        }
      })();

      // Timeout protection
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('EventStore shutdown timeout'));
        }, timeout);
        const nodeTimer = timer as ReturnType<typeof setTimeout> & { unref?: () => void };
        nodeTimer.unref?.();
      });

      try {
        await Promise.race([shutdownPromise, timeoutPromise]);
      } finally {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        outputSubscription.unsubscribe();
      }
    };

    const getAggregate: EventStore['getAggregate'] = async <State>(
      domain: string,
      identifier: string,
      reducer: (state: State, event: IEventStoreEntity) => State,
      initialState: State
    ): Promise<AggregateResult<State>> => {
      const getStreamEvents = eventStoreRepo.getStreamEvents?.bind(eventStoreRepo);
      if (!capabilities.aggregate || !getStreamEvents) {
        const repoName = eventStoreRepo.constructor?.name || 'IEventStoreRepo';
        const reason =
          declaredAggregateCapability === false
            ? `${repoName} declares capabilities.aggregate=false`
            : `${repoName} does not implement getStreamEvents(domain, identifier, fromSequence)`;
        throw new Error(
          `getAggregate is unavailable for this repository. ${reason}. ` +
            `Use an adapter that implements getStreamEvents, or avoid getAggregate and validate from projections/OCC.`
        );
      }

      let state = initialState;
      let sequence = 0;

      // Try snapshot
      if (eventStoreRepo.getSnapshot) {
        const snapshot = await eventStoreRepo.getSnapshot<State>(domain, identifier);
        if (snapshot) {
          state = snapshot.state;
          sequence = snapshot.sequence;
        }
      }

      // Replay events
      // Optimization: If possible, we could pass sequence to getStreamEvents to fetch only necessary events.
      // The implementation plan says use getStreamEvents.
      const events = await getStreamEvents(domain, identifier, sequence);
      for (const event of events) {
        state = reducer(state, event);
        sequence = event.sequence || 0;
      }

      return { state, sequence };
    };

    return {
      mainQueue,
      sideEffectQueue,
      receive: makeReceive(mainQueue, successEventObservers, {
        observerQueueConcurrent,
      }),
      replay: makeReplay(eventFlows, successEventObservers, eventStoreRepo),
      eventStoreRepo: eventStoreRepo,
      capabilities,
      output$,
      getAggregate,
      canRevert,
      previewRevert,
      revert,
      shutdown,
    };
  };
