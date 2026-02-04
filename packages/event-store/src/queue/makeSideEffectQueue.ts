import { BaseEvent, CreatedEvent, EventFlow, SideEffectsState } from '@schemeless/event-store-types';
import { createRxQueue } from './RxQueue';
import { registerEventFlowTypes } from '../operators/registerEventFlowTypes';
import * as Rx from 'rxjs/operators';
import { logEvent } from '../util/logEvent';
import { getEventFlow } from '../operators/getEventFlow';
import { logger } from '../util/logger';
import { mainQueueType } from './makeMainQueue';

export interface SideEffectQueueOptions {
  concurrent?: number;
}

export const makeSideEffectQueue = (
  eventFlows: EventFlow[],
  mainQueue: mainQueueType,
  options: SideEffectQueueOptions = {}
) => {
  const { concurrent = 1 } = options;
  const sideEffectQueue = createRxQueue<{ retryCount: number; event: CreatedEvent<any> }, any>('sideEffect', {
    concurrent,
  });
  const eventFlowMap = registerEventFlowTypes({}, eventFlows);

  const processed$ = sideEffectQueue.process$.pipe(
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
              sideEffectQueue.push({ retryCount: retryCount + 1, event });
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
  return {
    processed$,
    queueInstance: sideEffectQueue,
    push: sideEffectQueue.push.bind(sideEffectQueue) as typeof sideEffectQueue.push,
  };
};
