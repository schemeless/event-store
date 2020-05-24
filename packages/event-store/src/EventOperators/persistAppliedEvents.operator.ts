import { Observable, pipe } from 'rxjs';
import * as Rx from 'rxjs/operators';
import { CreatedEvent, EventFlowMap } from '../EventStore.types';
import * as R from 'ramda';
import { logger } from '../util/logger';
import { getEventFlow } from '../util/helpers';
import { logEvent } from '../util/logEvent';
import * as Bull from 'bull';
import { EventStoreRepo } from '../EventStore.repo';

export const persistAppliedEvents = (eventFlowMap: EventFlowMap, eventStoreRepo: EventStoreRepo) =>
  pipe(
    Rx.mergeMap<[Bull.DoneCallback, (Error | CreatedEvent<any>)[]], Promise<void>>(
      async ([done, eventsAndMaybeError]) => {
        const lastOne: Error | CreatedEvent<any> = R.last(eventsAndMaybeError);
        const isLastOneError = lastOne instanceof Error;
        logger.debug('isLastOneError ', isLastOneError);
        if (isLastOneError) {
          // roll backing
          const events = R.filter(current => !(current instanceof Error))(eventsAndMaybeError) as CreatedEvent<any>[];
          logger.debug(`${events.length} events to rollback`);
          await events.reduce<Promise<any>>(async (acc, currentEvent) => {
            if (acc) await acc;
            const EventFlow = getEventFlow(eventFlowMap, currentEvent);
            logEvent(currentEvent, '❌', 'cancel');
            EventFlow.executorCanceler && (await EventFlow.executorCanceler(currentEvent));
          }, null);
        } else {
          const events = eventsAndMaybeError as CreatedEvent<any>[];
          R.map(event => logEvent(event, '📝', 'persist'), events);
          await eventStoreRepo.storeEvents(events);
        }

        done(lastOne instanceof Error ? lastOne : null);
      }
    )
  );
