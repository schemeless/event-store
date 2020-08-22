import { CreatedEvent, EventFlowMap } from '../EventStore.types';
import { defaultEventCreator } from './defaultEventCreator';
import { makeValidateAndExecute } from './makeValidateAndExecute';
import * as Rx from 'rxjs/operators';
import { ApplyQueue } from '../queue/RxQueue';
import { makeGetConsequentEventInputs } from './makeGetConsequentEvent';

type EventError = { task: CreatedEvent<any>; error: Error };

const applyRootEvent = (eventFlowMap: EventFlowMap, applyQueue: ApplyQueue) => async ({ task, done }, drained) => {
  const createdEvent = defaultEventCreator(task.currentEvent, task.causalEvent);
  try {
    await makeValidateAndExecute(eventFlowMap)(createdEvent);
    const { consequentEvents } = await makeGetConsequentEventInputs(eventFlowMap)(createdEvent);
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
