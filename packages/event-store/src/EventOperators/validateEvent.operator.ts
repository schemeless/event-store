import { pipe } from 'rxjs';
import * as Rx from 'rxjs/operators';
import { logEvent } from '../util/logEvent';
import { CreatedEvent, EventFlow } from '../EventStore.types';

export const validateEvent = pipe(
  Rx.mergeMap(
    async ([EventFlow, event]: [EventFlow<any>, CreatedEvent<any>]): Promise<{
      EventFlow: EventFlow<any>;
      event: CreatedEvent<any>;
    }> => {
      logEvent(event, '🔍', 'verify');
      const error = EventFlow.validator ? await EventFlow.validator(event) : undefined;
      if (error instanceof Error) throw error;
      return { event, EventFlow };
    }
  )
);
