import { CreatedEvent, EventFlowMap } from '../EventStore.types';
import { defaultEventCreator } from './defaultEventCreator';
import * as Rx from 'rxjs/operators';
import { ApplyQueue } from '../queue/RxQueue';
import { makeValidateAndApply } from '../eventLifeCycle/makeValidateAndApply';
import { makeCreateConsequentEventInputs } from '../eventLifeCycle/createConsequentEvents';

type EventError = { task: CreatedEvent<any>; error: Error };

const applyRootEvent = (eventFlowMap: EventFlowMap, applyQueue: ApplyQueue) => async (
  { task, done: applyQueueDone },
  drained
) => {
  const createdEvent = defaultEventCreator(task.currentEvent, task.causalEvent);
  try {
    const preAppliedEvent = await makeValidateAndApply(eventFlowMap)(createdEvent);
    const { consequentEvents } = await makeCreateConsequentEventInputs(eventFlowMap)(preAppliedEvent);
    consequentEvents.forEach(currentEvent => {
      applyQueue.push({ currentEvent, causalEvent: preAppliedEvent });
    });
    applyQueueDone(null, preAppliedEvent);
    return preAppliedEvent;
  } catch (e) {
    applyQueueDone({ task: createdEvent, error: e });
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
