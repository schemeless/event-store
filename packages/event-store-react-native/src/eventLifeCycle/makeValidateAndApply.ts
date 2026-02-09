import type { CreatedEvent, EventFlowMap } from '@schemeless/event-store-types';
import { getEventFlow } from '../operators/getEventFlow';
import { apply } from './apply';
import { validate } from './validate';
import { preApply } from './preApply';
import { upcast } from './upcast';

export const makeValidateAndApply =
  (eventFlowMap: EventFlowMap) =>
  async (event): Promise<CreatedEvent<any>> => {
    const eventFlow = getEventFlow(eventFlowMap)(event);
    const upcastedEvent = await upcast(eventFlow, event);
    await validate(eventFlow, upcastedEvent);
    const preAppliedEvent = await preApply(eventFlow, upcastedEvent);
    await apply(eventFlow, preAppliedEvent);
    return preAppliedEvent;
  };
