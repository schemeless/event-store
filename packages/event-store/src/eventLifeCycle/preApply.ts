import { CreatedEvent, EventFlow } from '@schemeless/event-store-types';
import { logEvent } from '../util/logEvent';

export const preApply = async (eventFlow: EventFlow<any>, event: CreatedEvent<any>): Promise<CreatedEvent<any>> => {
  logEvent(event, '🪁️', 'PreApply');
  if (!eventFlow.preApply) return event;
  const remakeEvent = await eventFlow.preApply(event);
  return remakeEvent || event;
};
