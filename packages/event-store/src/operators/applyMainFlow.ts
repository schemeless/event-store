import { BaseEvent, CreatedEvent, EventFlow, EventFlowAndEvent, EventFlowMap } from '../EventStore.types';
import { getConsequentEventInputs } from './getConsequentEvent';
import { executeEvent } from './executeEvent';
import { validateEvent } from './validateEvent';
import { getEventFlow } from './getEventFlow';

export const applyMainFlow = (eventFlowMap: EventFlowMap) => async (event): Promise<BaseEvent<any>[]> => {
  const eventFlow = getEventFlow(eventFlowMap)(event);
  await validateEvent(eventFlow, event);
  await executeEvent(eventFlow, event);
  const { consequentEvents, event: causalEvent } = await getConsequentEventInputs(eventFlow, event);
  return consequentEvents;
};
