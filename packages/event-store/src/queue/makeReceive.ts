import type {
  AggregateEventObserver,
  BaseEventInput,
  CreatedEvent,
  EventFlow,
  EventFlowMap,
  EventTaskAndError,
  SuccessEventObserver,
} from '@schemeless/event-store-types';
import { makeMainQueue } from './makeMainQueue';
import { makeObserverQueue } from './makeObserverQueue';
import { aggregateStateCache, clearAggregateStateForEvents } from '../eventLifeCycle/aggregateStateCache';
import type { Subscription } from 'rxjs';

export interface ReceiveOptions {
  observerQueueConcurrent?: number;
  eventFlowMap?: EventFlowMap;
}

export const makeReceive =
  (
    mainQueue: ReturnType<typeof makeMainQueue>,
    successEventObservers: Array<SuccessEventObserver<any> | AggregateEventObserver<any, any>> = [],
    options: ReceiveOptions = {}
  ) =>
  <PartialPayload, Payload extends PartialPayload>(eventFlow: EventFlow<PartialPayload, Payload>) =>
  (eventInput: BaseEventInput<PartialPayload>): Promise<[CreatedEvent<Payload>, ...Array<CreatedEvent<any>>]> => {
    const event = Object.assign({}, eventInput, {
      domain: eventFlow.domain,
      type: eventFlow.type,
      created: eventInput.created || undefined,
      meta: {
        ...(eventInput.meta || {}),
        schemaVersion: eventFlow.schemaVersion || 1,
      },
    });
    return new Promise((resolve, reject) => {
      mainQueue.push(
        event,
        (err: EventTaskAndError, doneEvents: [CreatedEvent<Payload>, ...Array<CreatedEvent<any>>]) => {
          if (err) {
            if (options.eventFlowMap) {
              clearAggregateStateForEvents(options.eventFlowMap, [err.task, ...(doneEvents || [])]);
            }
            reject(err.error);
          } else {
            const observerQueue = makeObserverQueue(successEventObservers, {
              concurrent: options.observerQueueConcurrent ?? 1,
              getAggregateState: (doneEvent) => aggregateStateCache.getByEventId(doneEvent.id),
              hasAggregateState: (doneEvent) => aggregateStateCache.hasByEventId(doneEvent.id),
            });
            let settled = false;
            let processedSubscription: Subscription | undefined;
            let drainedSubscription: Subscription | undefined;

            const finishSuccess = () => {
              if (settled) return;
              settled = true;
              if (options.eventFlowMap) {
                clearAggregateStateForEvents(options.eventFlowMap, doneEvents || []);
              }
              processedSubscription?.unsubscribe();
              drainedSubscription?.unsubscribe();
              resolve(doneEvents);
            };
            const finishError = (error: any) => {
              if (settled) return;
              settled = true;
              if (options.eventFlowMap) {
                clearAggregateStateForEvents(options.eventFlowMap, doneEvents || []);
              }
              processedSubscription?.unsubscribe();
              drainedSubscription?.unsubscribe();
              reject(error);
            };

            processedSubscription = observerQueue.processed$.subscribe({
              error: finishError,
            });
            drainedSubscription = observerQueue.queueInstance.drained$.subscribe(() => finishSuccess());
            doneEvents.forEach((event) => observerQueue.push(event));
          }
        }
      );
    });
  };
