import type { CreatedEvent, EventFlow } from '@schemeless/event-store-types';
import { logEvent } from '../util/logEvent';

export const apply = async (eventFlow: EventFlow<any>, event: CreatedEvent<any>): Promise<void> => {
  logEvent(event, '✅️', 'Apply');
  if (!eventFlow.apply) return;
  return eventFlow.apply(event);
};
