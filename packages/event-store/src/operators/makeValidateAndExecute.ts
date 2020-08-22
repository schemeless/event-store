import { EventFlowMap } from '../EventStore.types';
import { executeEvent } from './executeEvent';
import { validateEvent } from './validateEvent';
import { getEventFlow } from './getEventFlow';

export const makeValidateAndExecute = (eventFlowMap: EventFlowMap) => async (event): Promise<void> => {
  const eventFlow = getEventFlow(eventFlowMap)(event);
  await validateEvent(eventFlow, event);
  await executeEvent(eventFlow, event);
};
