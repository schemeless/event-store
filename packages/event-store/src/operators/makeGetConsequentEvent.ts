import * as R from 'ramda';
import { logEvent } from '../util/logEvent';
import { BaseEvent, CreatedEvent, EventFlowMap } from '../EventStore.types';
import { getEventFlow } from './getEventFlow';

export const makeGetConsequentEventInputs = (eventFlowMap: EventFlowMap) => async (
  event: CreatedEvent<any>
): Promise<{ consequentEvents: BaseEvent<any>[]; event: CreatedEvent<any> }> => {
  const eventFlow = getEventFlow(eventFlowMap)(event);
  const consequentEvents: BaseEvent<any>[] = eventFlow.consequentEventsCreator
    ? await eventFlow.consequentEventsCreator(event)
    : [];
  if (consequentEvents.length) {
    logEvent(event, '🏭', 'subEvents', consequentEvents.map(R.prop('type')));
  } else {
    logEvent(event, '👌️', 'noSub');
  }
  return { consequentEvents, event };
};
