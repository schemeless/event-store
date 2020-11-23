import { BaseEvent, CreatedEvent, EventFlowMap } from '@schemeless/event-store-types';
import * as Queue from 'better-queue';
import { from, of, pipe } from 'rxjs';
import * as Rx from 'rxjs/operators';
import { getEventFlow } from './getEventFlow';
import { logEvent } from '../util/logEvent';

const cancelEvent = (eventFlowMap: EventFlowMap) => async (event: CreatedEvent<any>) => {
  const eventFlow = getEventFlow(eventFlowMap)(event);
  if (eventFlow.cancelApply) {
    logEvent(event, '❌', 'cancel');
    await eventFlow.cancelApply(event);
  } else {
    logEvent(event, '🤔️', 'noCancel?');
  }
  return event;
};

export const cleanupAndCancelFailedEvent = (
  eventFlowMap: EventFlowMap,
  done: Queue.ProcessFunctionCb<any>,
  event: BaseEvent<any>
) =>
  pipe(
    // call event canceler if failed
    Rx.concatMap(([doneEvents, eventTaskAndError]) => {
      if (eventTaskAndError && doneEvents.length > 0) {
        return of(doneEvents).pipe(
          Rx.concatMap((events) => from(events).pipe(Rx.mergeMap(cancelEvent(eventFlowMap)))),
          Rx.mapTo([doneEvents, eventTaskAndError])
        );
      } else {
        return of([doneEvents, eventTaskAndError]);
      }
    }),
    Rx.tap(([doneEvents, eventTaskAndError]) => done(eventTaskAndError, doneEvents))
  );
