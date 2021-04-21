import type { CreatedEvent, EventFlow } from '@schemeless/event-store-types';
import { logEvent } from '../util/logEvent';

export const apply = (eventFlow: EventFlow<any>) => async (event: CreatedEvent<any>) => {
  logEvent(event, '✅️', 'Apply');
  if (!eventFlow.apply) return event;
  await eventFlow.apply(event);
  return event
};
