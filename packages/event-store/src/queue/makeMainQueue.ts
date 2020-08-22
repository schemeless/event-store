import { createRxQueue } from './RxQueue';
import * as Rx from 'rxjs/operators';
import { BaseEvent, CreatedEvent, EventFlow, EventTaskAndError } from '../EventStore.types';
import { combineLatest, Observable } from 'rxjs';
import { logEvent } from '../util/logEvent';
import { registerEventFlowTypes } from '../operators/registerEventFlowTypes';
import { applyRootEventAndCollectSucceed } from '../operators/applyRootEventAndCollectSucceed';
import { cleanupAndCancelFailedEvent } from '../operators/cleanupAndCancelFailedEvent';
import { racedQueueFailedOrDrained } from '../operators/racedQueueFailedOrDrained';
import { makeApplyQueue } from './makeApplyQueue';

export const makeMainQueue = (eventFlows: EventFlow<any>[]) => {
  const mainQueue = createRxQueue<BaseEvent<any>, any>('main', { concurrent: 1 });
  const eventFlowMap = registerEventFlowTypes({}, eventFlows);

  const processed$ = mainQueue.process$.pipe(
    Rx.concatMap(({ task, done: mainQueueDone }) => {
      const applyQueue = makeApplyQueue();
      logEvent(task, '✨', 'received');
      applyQueue.push({ currentEvent: task });
      return combineLatest([
        applyRootEventAndCollectSucceed(eventFlowMap, applyQueue),
        racedQueueFailedOrDrained(applyQueue)
      ]).pipe(
        Rx.take(1),
        cleanupAndCancelFailedEvent(eventFlowMap, mainQueueDone, task),
        Rx.tap(() => applyQueue.queueInstance.destroy(() => undefined)),
        Rx.tap(() => logEvent(task, '🏁', 'finished'))
      );
    })
  ) as Observable<[CreatedEvent<any>[], EventTaskAndError]>;

  return {
    processed$,
    queueInstance: mainQueue,
    push: mainQueue.push.bind(mainQueue) as typeof mainQueue.push
  };
};
