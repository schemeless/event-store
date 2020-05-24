import { Job, Queue } from 'bull';
import { CreatedEvent, EventFlowMap } from '../EventStore.types';
import { Observable, of, OperatorFunction } from 'rxjs';
import * as Rx from 'rxjs/operators';
import { logger } from '../util/logger';
import { validateEvent } from './validateEvent.operator';
import { logEvent } from '../util/logEvent';
import { getConsequentEventInputs } from './getConsequentEvent.opeartor';
import { defaultEventCreator, getEventFlow } from '../util/helpers';

export const applyEvent = (
  applyQueue: Queue<CreatedEvent<any>>,
  eventFlowMap: EventFlowMap
): OperatorFunction<any, CreatedEvent<any> | Error> => ($input: Observable<Job<CreatedEvent<any>>>) =>
  $input.pipe(
    Rx.mergeMap((job: Job<CreatedEvent<any>>) => {
      const event = job.data;
      logger.debug(`applying event: ${event.domain} ${event.type}`);
      const EventFlow = getEventFlow(eventFlowMap, event);
      return of([EventFlow, event]).pipe(
        validateEvent,
        Rx.mergeMap(async ({ event, EventFlow }) => {
          logEvent(event, '✅️', 'Apply');
          if (EventFlow.executor) {
            await EventFlow.executor(event);
          }
          return { EventFlow, event };
        }),
        getConsequentEventInputs,
        // put ConsequentEvents into apply queue
        Rx.flatMap(async ({ consequentEvents, event }) => {
          await consequentEvents.reduce<Promise<any>>(async (acc, currentConsequentEvent) => {
            if (acc) await acc;
            const currentEvent = defaultEventCreator(currentConsequentEvent, event);
            await applyQueue.add(currentEvent);
          }, null);
          return event;
        }),
        Rx.catchError((validateError, ob$) => {
          logEvent(event, '⚠️', 'Invalid', validateError);
          return of(validateError);
        })
      );
    })
  );
