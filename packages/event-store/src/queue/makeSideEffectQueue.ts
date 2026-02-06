import { BaseEvent, CreatedEvent, EventFlow, SideEffectsState } from '@schemeless/event-store-types';
import { createRxQueue } from './RxQueue';
import { registerEventFlowTypes } from '../operators/registerEventFlowTypes';
import * as Rx from 'rxjs/operators';
import { logEvent } from '../util/logEvent';
import { getEventFlow } from '../operators/getEventFlow';
import { logger } from '../util/logger';
import { mainQueueType } from './makeMainQueue';
import { merge } from 'rxjs';
import { getPartitionIndex } from './shardUtils';

export interface SideEffectQueueOptions {
  concurrent?: number;
}

export const makeSideEffectQueue = (
  eventFlows: EventFlow[],
  mainQueue: mainQueueType,
  options: SideEffectQueueOptions = {}
) => {
  const { concurrent = 1 } = options;
  const eventFlowMap = registerEventFlowTypes({}, eventFlows);

  // Create array of partition queues (each with concurrency 1 for strict ordering)
  const numPartitions = concurrent;
  const partitionQueues = Array.from({ length: numPartitions }, (_, i) =>
    createRxQueue<{ retryCount: number; event: CreatedEvent<any> }, any>(`sideEffect-${i}`, {
      concurrent: 1,
    })
  );

  // Route events to correct partition (same logic as mainQueue)
  const getPartition = (event: CreatedEvent<any>): number => {
    const flow = eventFlowMap[`${event.domain}__${event.type}`];
    const key = flow?.getShardKey?.(event) ?? event.identifier ?? '';
    if (!key) return 0;
    return getPartitionIndex(key, numPartitions);
  };

  // Merge all partition process$ streams
  // Use mergeMap (NOT concatMap!) to allow parallel execution across partitions
  // Safety: Each partition queue has concurrent:1, so it won't emit next event
  // until current one calls done(). This guarantees per-partition ordering while
  // allowing different partitions to run in parallel.
  const processed$ = merge(...partitionQueues.map(pq => pq.process$)).pipe(
    Rx.mergeMap(
      async ({ task: { retryCount, event }, done }): Promise<{ state: SideEffectsState; event: CreatedEvent<any> }> => {
        const eventFlow: EventFlow = getEventFlow(eventFlowMap)(event);
        if (!eventFlow.sideEffect) {
          logEvent(event, '🌠', 'SideEffect:N/A');
          done();
          return { event, state: SideEffectsState.done };
        } else {
          try {
            const nextEvents: BaseEvent<any>[] = ((await eventFlow.sideEffect(event)) as unknown) as BaseEvent<any>[];
            logEvent(event, '🌠', 'SideEffect:Done');
            if (nextEvents?.length) {
              nextEvents.forEach((nextEvent) => {
                mainQueue.push(nextEvent);
              });
            }
            done();
            return { event, state: SideEffectsState.done };
          } catch (error) {
            logger.error(error.toString());
            const sideEffectFailedRetryAllowed = eventFlow.meta?.sideEffectFailedRetryAllowed;
            if (sideEffectFailedRetryAllowed && retryCount < sideEffectFailedRetryAllowed) {
              logEvent(event, '🌠', 'SE:Retry:' + retryCount);
              push({ retryCount: retryCount + 1, event });
              done();
              return { event, state: SideEffectsState.retry };
            } else {
              logEvent(event, '🌠', 'SE:FAILED:' + retryCount);
              done();
              return { event, state: SideEffectsState.fail };
            }
          }
        }
      }
    )
  );

  // Custom push that routes to correct partition
  const push = (task: { retryCount: number; event: CreatedEvent<any> }, cb?: (err: any, result: any) => void) => {
    const partitionIndex = getPartition(task.event);
    partitionQueues[partitionIndex].push(task, cb);
  };

  // Lifecycle methods for all partitions
  const pause = (): void => {
    partitionQueues.forEach(pq => pq.pause());
  };

  const resume = (): void => {
    partitionQueues.forEach(pq => pq.resume());
  };

  const drain = async (): Promise<void> => {
    await Promise.all(partitionQueues.map(pq => pq.drain()));
  };

  const destroy = async (): Promise<void> => {
    await Promise.all(partitionQueues.map(pq => pq.destroy()));
  };

  return {
    processed$,
    queueInstance: partitionQueues[0], // For compatibility, expose first queue
    partitionQueues, // Expose all partitions for advanced use
    push,
    pause,
    resume,
    drain,
    destroy,
  };
};
