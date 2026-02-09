import * as R from 'ramda';
import type { BaseEvent, CreatedEvent, EventFlowMap } from '@schemeless/event-store-types';
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
    // Inject schemaVersion into consequent events
    consequentEvents.forEach((consequentEvent) => {
      try {
        const flow = getEventFlow(eventFlowMap)(consequentEvent);
        consequentEvent.meta = {
          ...(consequentEvent.meta || {}),
          schemaVersion: flow.schemaVersion || 1,
        };
      } catch (e) {
        // If flow not found, default to version 1 or let it fail later
        // logging might be good but let's keep it simple
      }
    });
  } else {
    logEvent(event, '👌️', 'noSub');
  }
  return { consequentEvents, event };
};
