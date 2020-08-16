import { CreatedEvent, EventFlow } from '../EventStore.types';
import { logEvent } from '../util/logEvent';

export const executeEvent = async (eventFlow: EventFlow<any>, event: CreatedEvent<any>): Promise<void> => {
  logEvent(event, '✅️', 'Apply');
  if (!eventFlow.executor) return;
  return eventFlow.executor(event);
};
