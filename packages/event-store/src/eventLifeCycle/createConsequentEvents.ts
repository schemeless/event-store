import * as R from 'ramda';
import { BaseEvent, CreatedEvent, EventFlowMap } from '@schemeless/event-store-types';
import { logEvent } from '../util/logEvent';
import { getEventFlow } from '../operators/getEventFlow';

export const makeCreateConsequentEventInputs = (eventFlowMap: EventFlowMap) => async (
  event: CreatedEvent<any>
): Promise<{ consequentEvents: BaseEvent<any>[]; event: CreatedEvent<any> }> => {
  const eventFlow = getEventFlow(eventFlowMap)(event);
  const consequentEvents: BaseEvent<any>[] = eventFlow.createConsequentEvents
    ? await eventFlow.createConsequentEvents(event)
    : [];
  if (consequentEvents.length) {
    logEvent(event, '🏭', 'subEvents', consequentEvents.map(R.prop('type')));
  } else {
    logEvent(event, '👌️', 'noSub');
  }
  return { consequentEvents, event };
};
