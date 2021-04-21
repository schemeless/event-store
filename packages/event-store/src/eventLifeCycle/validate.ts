import { logEvent } from '../util/logEvent';
import type { CreatedEvent, EventFlow } from '@schemeless/event-store-types';

export const validate = (eventFlow: EventFlow<any>) => async (event: CreatedEvent<any>) => {
  try {
    const error = eventFlow.validate ? await eventFlow.validate(event) : undefined;
    if (error instanceof Error) throw error;
  } catch (error) {
    logEvent(event, '⚠️', 'unverified', error.message);
    throw error;
  }
  logEvent(event, '☑️', 'verified');
  return event
};
