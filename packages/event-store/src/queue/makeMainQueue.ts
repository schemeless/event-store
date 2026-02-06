import { createRxQueue } from './RxQueue';
import * as Rx from 'rxjs/operators';
import type { BaseEvent, CreatedEvent, EventFlow, EventTaskAndError } from '@schemeless/event-store-types';
import { combineLatest, merge, Observable } from 'rxjs';
import { logEvent } from '../util/logEvent';
import { registerEventFlowTypes } from '../operators/registerEventFlowTypes';
import { applyRootEventAndCollectSucceed } from '../operators/applyRootEventAndCollectSucceed';
import { cleanupAndCancelFailedEvent } from '../operators/cleanupAndCancelFailedEvent';
import { racedQueueFailedOrDrained } from '../operators/racedQueueFailedOrDrained';
import { makeApplyQueue } from './makeApplyQueue';
import { getPartitionIndex, hashString } from './shardUtils';

export interface MainQueueOptions {
  concurrent?: number;
}

export const makeMainQueue = (eventFlows: EventFlow<any>[], options: MainQueueOptions = {}) => {
  const { concurrent = 1 } = options;
  const eventFlowMap = registerEventFlowTypes({}, eventFlows);

  // Create array of partition queues (each with concurrency 1 for strict ordering)
  const numPartitions = concurrent;
  const partitionQueues = Array.from({ length: numPartitions }, (_, i) =>
    createRxQueue<BaseEvent<any>, any>(`main-${i}`, { concurrent: 1 })
  );

  // Route events to correct partition
  const getPartition = (event: BaseEvent<any>): number => {
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
    Rx.mergeMap(({ task, done: mainQueueDone }) => {
      const applyQueue = makeApplyQueue();
      logEvent(task, '✨', 'received');
      applyQueue.push({ currentEvent: task });
      return combineLatest([
        applyRootEventAndCollectSucceed(eventFlowMap, applyQueue),
        racedQueueFailedOrDrained(applyQueue),
      ]).pipe(
        Rx.take(1),
        cleanupAndCancelFailedEvent(eventFlowMap, mainQueueDone, task),
        Rx.tap(() => applyQueue.queueInstance.destroy(() => undefined)),
        Rx.tap(() => logEvent(task, '🏁', 'finished'))
      );
    })
  ) as Observable<[CreatedEvent<any>[], EventTaskAndError]>;

  // Custom push that routes to correct partition
  const push = (task: BaseEvent<any>, cb?: (err: any, result: any) => void) => {
    const partitionIndex = getPartition(task);
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

export type mainQueueType = ReturnType<typeof makeMainQueue>;
