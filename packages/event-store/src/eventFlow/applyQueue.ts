import * as R from 'ramda'
import * as Queue from 'better-queue'
import {
  BaseEvent,
  CreatedEvent,
  EventFlowMap, EventTaskAndError
} from '@schemeless/event-store-types'
import { logEvent } from '../util/logEvent'
import { ProcessFunctionCb } from 'better-queue'
import { defaultEventCreator } from '../operators/defaultEventCreator'
import { getEventFlow } from '../operators/getEventFlow'
import { validateAndApply } from '../eventLifeCycle/validateAndApply'
import { createConsequentEventInputs } from '../eventLifeCycle/createConsequentEvents'
import { ApplyQueue } from '../queue/RxQueue'

type Task = { causalEvent?: CreatedEvent<any>; currentEvent: BaseEvent<any> },
type Result = CreatedEvent<any>

const applyRootEvent = (eventFlowMap: EventFlowMap, applyQueue: Queue<Task, Result>) => async (
  { task, done: applyQueueDone },
) => {
  const createdEvent = defaultEventCreator(task.currentEvent, task.causalEvent);
  try {
    const eventFlow = getEventFlow(eventFlowMap)(createdEvent);
    const preAppliedEvent = await validateAndApply(eventFlow)(createdEvent);
    const { consequentEvents } = await createConsequentEventInputs(eventFlow)(preAppliedEvent);
    R.pipe(
      R.map((event: BaseEvent<any, any>) => ({currentEvent: event, causalEvent: preAppliedEvent})),
      R.forEach((t) => applyQueue.push(t)),
    )(consequentEvents)

    applyQueueDone(null, preAppliedEvent);
    applyQueue.destroy(() => null)
    return preAppliedEvent;
  } catch (e) {
    applyQueueDone({ task: createdEvent, error: e });
    applyQueue.destroy(() => null)
    return { task: createdEvent, error: e } as EventTaskAndError;
  }
};

const applyQueue =  (
  fn: Queue.ProcessFunction<Task, Result>,
  queueOptions: Omit<Queue.QueueOptions<Task, Result>, 'process'>,
) => {
  const applyQueue = new Queue<Task, Result>(fn, queueOptions)

  // applyQueue.

  return applyQueue
}
