import type { CreatedEvent, EventFlowMap } from '@schemeless/event-store-types';
import { getEventFlow } from '../operators/getEventFlow';
import { apply } from './apply';
import { validate } from './validate';
import { preApply } from './preApply';

export const makeValidateAndApply = (eventFlowMap: EventFlowMap) => async (event): Promise<CreatedEvent<any>> => {
  const eventFlow = getEventFlow(eventFlowMap)(event);
  await validate(eventFlow, event);
  const preAppliedEvent = await preApply(eventFlow, event);
  await apply(eventFlow, preAppliedEvent);
  return preAppliedEvent;
};
