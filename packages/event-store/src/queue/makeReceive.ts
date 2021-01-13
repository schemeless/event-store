import type { BaseEventInput, CreatedEvent, EventFlow, EventTaskAndError } from '@schemeless/event-store-types';
import { makeMainQueue } from './makeMainQueue';
import { makeObserverQueue } from './makeObserverQueue';
import { SuccessEventObserver } from '@schemeless/event-store-types';

export const makeReceive = (
  mainQueue: ReturnType<typeof makeMainQueue>,
  successEventObservers: SuccessEventObserver<any>[] = []
) => <PartialPayload, Payload extends PartialPayload>(eventFlow: EventFlow<PartialPayload, Payload>) => (
  eventInput: BaseEventInput<PartialPayload>
): Promise<[CreatedEvent<Payload>, ...Array<CreatedEvent<any>>]> => {
  const event = Object.assign({}, eventInput, {
    domain: eventFlow.domain,
    type: eventFlow.type,
  });
  return new Promise((resolve, reject) => {
    mainQueue.push(
      event,
      (err: EventTaskAndError, doneEvents: [CreatedEvent<Payload>, ...Array<CreatedEvent<any>>]) => {
        if (err) {
          reject(err.error);
        } else {
          const observerQueue = makeObserverQueue(successEventObservers);
          observerQueue.processed$.subscribe();
          observerQueue.queueInstance.drained$.subscribe(() => resolve(doneEvents));
          doneEvents.forEach((event) => observerQueue.push(event));
        }
      }
    );
  });
};
