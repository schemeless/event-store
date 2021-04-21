import * as R from 'ramda';
import type {
  BaseEvent,
  CreatedEvent,
  EventFlow,
} from '@schemeless/event-store-types'
import { logEvent } from '../util/logEvent';

export const createConsequentEventInputs = (eventFlow: EventFlow) => async (
  event: CreatedEvent<any>
): Promise<{ consequentEvents: BaseEvent<any>[]; event: CreatedEvent<any> }> => {
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
