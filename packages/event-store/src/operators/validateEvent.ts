import { logEvent } from '../util/logEvent';
import { CreatedEvent, EventFlow } from '../EventStore.types';

export const validateEvent = async (eventFlow: EventFlow<any>, event: CreatedEvent<any>): Promise<void> => {
  try {
    const error = eventFlow.validator ? await eventFlow.validator(event) : undefined;
    if (error instanceof Error) throw error;
  } catch (error) {
    logEvent(event, '⚠️', 'unverified', error.message);
    throw error;
  }
  logEvent(event, '☑️', 'verified');
};
