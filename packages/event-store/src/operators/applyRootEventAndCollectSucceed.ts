import type { CreatedEvent, EventFlowMap, EventTaskAndError } from '@schemeless/event-store-types';
import { defaultEventCreator } from './defaultEventCreator';
import * as Rx from 'rxjs/operators';
import { ApplyQueue } from '../queue/RxQueue';
import { validateAndApply } from '../eventLifeCycle/validateAndApply';
import { createConsequentEventInputs } from '../eventLifeCycle/createConsequentEvents';
import { isEventTaskError } from './isEventTaskError';
import { getEventFlow } from './getEventFlow'

const applyRootEvent = (eventFlowMap: EventFlowMap, applyQueue: ApplyQueue) => async (
  { task, done: applyQueueDone },
  drained
) => {
  const createdEvent = defaultEventCreator(task.currentEvent, task.causalEvent);
  try {
    const eventFlow = getEventFlow(eventFlowMap)(createdEvent);
    const preAppliedEvent = await validateAndApply(eventFlow)(createdEvent);
    const { consequentEvents } = await createConsequentEventInputs(eventFlow)(preAppliedEvent);
    consequentEvents.forEach((currentEvent) => {
      applyQueue.push({ currentEvent, causalEvent: preAppliedEvent });
    });
    applyQueueDone(null, preAppliedEvent);
    return preAppliedEvent;
  } catch (e) {
    applyQueueDone({ task: createdEvent, error: e });
    return { task: createdEvent, error: e } as EventTaskAndError;
  }
};

export const applyRootEventAndCollectSucceed = (eventFlowMap: EventFlowMap, applyQueue: ApplyQueue) =>
  applyQueue.process$.pipe(
    Rx.mergeMap(applyRootEvent(eventFlowMap, applyQueue)),
    Rx.scan(
      (acc, eventOrError: EventTaskAndError) => (isEventTaskError(eventOrError) ? acc : [...acc, eventOrError]),
      [] as CreatedEvent<any>[]
    )
  );
