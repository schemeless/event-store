import { CreatedEvent, EventObserverState, EventOutput, SuccessEventObserver } from '../EventStore.types';
import { createRxQueue } from './RxQueue';
import * as Rx from 'rxjs/operators';
import { logEvent } from '../util/logEvent';
import { Observable } from 'rxjs';

export const makeObserverQueue = (successEventObservers: SuccessEventObserver<any>[]) => {
  const observerQueue = createRxQueue<CreatedEvent<any>, any>('applySuccessEventObservers', {
    concurrent: 1
  });
  type ObserverMap = { [domainType: string]: SuccessEventObserver<any>[] };
  const observerMap: ObserverMap = successEventObservers.reduce((acc, observer) => {
    observer.filters.forEach(filter => {
      const domainType = filter.domain + '__' + filter.type;
      const savedObservers = acc[domainType] || [];
      acc[domainType] = [...savedObservers, observer];
    });
    return acc;
  }, {});

  const processed$: Observable<EventOutput> = observerQueue.process$.pipe(
    Rx.mergeMap(async ({ done, task: createdEvent }) => {
      const thisDomainType = createdEvent.domain + '__' + createdEvent.type;
      const observersToApply = observerMap[thisDomainType];
      if (!observersToApply || observersToApply.length === 0) {
        logEvent(createdEvent, '👀', 'OB:NA');
        done();
        return null;
      } else {
        // apply observers
        await Promise.all(observersToApply.map(o => o.apply(createdEvent)));
        logEvent(createdEvent, '👀', 'OB:OK');
        done();
        return { state: EventObserverState.success, event: createdEvent };
      }
    }),
    Rx.filter(r => !!r)
  );

  return {
    processed$,
    queueInstance: observerQueue,
    push: observerQueue.push.bind(observerQueue) as typeof observerQueue.push
  };
};
