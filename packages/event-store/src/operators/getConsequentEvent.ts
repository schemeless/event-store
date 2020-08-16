import * as R from 'ramda';
import { logEvent } from '../util/logEvent';
import { EventFlow, BaseEvent, CreatedEvent } from '../EventStore.types';

export const getConsequentEventInputs = async (
  EventFlow: EventFlow<any>,
  event: CreatedEvent<any>
): Promise<{ consequentEvents: BaseEvent<any>[]; event: CreatedEvent<any> }> => {
  const consequentEvents: BaseEvent<any>[] = EventFlow.consequentEventsCreator
    ? await EventFlow.consequentEventsCreator(event)
    : [];
  if (consequentEvents.length) {
    logEvent(event, '🏭', 'subEvents', consequentEvents.map(R.prop('type')));
  } else {
    logEvent(event, '👌️', 'noSub');
  }
  return { consequentEvents, event };
};
