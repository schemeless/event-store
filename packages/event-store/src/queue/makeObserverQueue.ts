import { CreatedEvent, EventObserverState, SuccessEventObserver } from '@schemeless/event-store-types';
import { createRxQueue } from './RxQueue';
import * as R from 'ramda';
import * as Rx from 'rxjs/operators';
import { logEvent } from '../util/logEvent';
import { Observable } from 'rxjs';
import { EventOutput } from '../EventStore.types';
import { logger } from '../util/logger';

type ObserverMap = { [domainType: string]: SuccessEventObserver[] };

const makeObserverMap = (successEventObservers: SuccessEventObserver[]) => {
  const observerMap: ObserverMap = successEventObservers.reduce((acc, observer) => {
    observer.filters.forEach((filter) => {
      const domainType = filter.domain + '__' + filter.type;
      const savedObservers = acc[domainType] || [];
      acc[domainType] = [...savedObservers, observer];
    });
    return acc;
  }, {});

  return observerMap;
};

export interface ObserverQueueOptions {
  concurrent?: number;
}

export const makeObserverQueue = (
  successEventObservers: SuccessEventObserver<any>[],
  options: ObserverQueueOptions = {}
) => {
  const { concurrent = 1 } = options;
  const observerQueue = createRxQueue<CreatedEvent<any>, any>('applySuccessEventObservers', {
    concurrent,
  });

  const observerMap = makeObserverMap(successEventObservers);

  const processed$: Observable<EventOutput> = observerQueue.process$.pipe(
    Rx.mergeMap(async ({ done, task: createdEvent }) => {
      const thisDomainType = createdEvent.domain + '__' + createdEvent.type;
      const observersToApply = observerMap[thisDomainType];
      if (!observersToApply || observersToApply.length === 0) {
        logEvent(createdEvent, '👀', 'No observers to apply');
        done();
        return null;
      } else {
        // apply observers
        const orderedObserversToApply = R.sortBy(R.prop('priority'))(observersToApply);
        for (const observerToApply of orderedObserversToApply) {
          if (observerToApply.fireAndForget) {
            // Fire and forget: execute without waiting
            Promise.resolve()
              .then(() => observerToApply.apply(createdEvent))
              .catch((err) => {
                logger.error(`Fire-and-forget observer failed: ${err}`);
              });
          } else {
            await observerToApply.apply(createdEvent);
          }
        }
        logEvent(createdEvent, '👀', 'Applied observers');
        done();
        return { state: EventObserverState.success, event: createdEvent };
      }
    }),
    Rx.filter((r) => !!r)
  );

  return {
    processed$,
    queueInstance: observerQueue,
    push: observerQueue.push.bind(observerQueue) as typeof observerQueue.push,
  };
};
