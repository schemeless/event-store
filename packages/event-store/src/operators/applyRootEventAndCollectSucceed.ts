import { CreatedEvent, EventFlowMap } from '../EventStore.types';
import { defaultEventCreator } from './defaultEventCreator';
import { applyMainFlow } from './applyMainFlow';
import * as Rx from 'rxjs/operators';
import { ApplyQueue } from '../queue/RxQueue';

type EventError = { task: CreatedEvent<any>; error: Error };

const applyRootEvent = (eventFlowMap: EventFlowMap, applyQueue: ApplyQueue) => async ({ task, done }, drained) => {
  const createdEvent = defaultEventCreator(task.currentEvent, task.causalEvent);
  try {
    const consequentEvents = await applyMainFlow(eventFlowMap)(createdEvent);
    consequentEvents.forEach(currentEvent => {
      applyQueue.push({ currentEvent, causalEvent: createdEvent });
    });
    done(null, createdEvent);
    return createdEvent;
  } catch (e) {
    done({ task: createdEvent, error: e });
    return { task: createdEvent, error: e } as EventError;
  }
};

const isError = (eventOrError: CreatedEvent<any> | EventError): eventOrError is EventError =>
  (eventOrError as EventError).error != null;

export const applyRootEventAndCollectSucceed = (eventFlowMap: EventFlowMap, applyQueue: ApplyQueue) =>
  applyQueue.process$.pipe(
    Rx.mergeMap(applyRootEvent(eventFlowMap, applyQueue)),
    Rx.scan(
      (acc, eventOrError: EventError) => (isError(eventOrError) ? acc : [...acc, eventOrError]),
      [] as CreatedEvent<any>[]
    )
  );
