import type { CreatedEvent, EventFlowMap } from '@schemeless/event-store-types';
import { getEventFlow } from '../operators/getEventFlow';
import { apply } from './apply';
import { validate } from './validate';
import { preApply } from './preApply';
import { upcast } from './upcast';
import type { EventStore } from '../EventStore.types';

export const makeValidateAndApply =
  (eventFlowMap: EventFlowMap, getAggregate: EventStore['getAggregate']) =>
  async (event): Promise<CreatedEvent<any>> => {
    const eventFlow = getEventFlow(eventFlowMap)(event);
    const upcastedEvent = await upcast(eventFlow, event);
    await validate(eventFlow, upcastedEvent, getAggregate);
    const preAppliedEvent = await preApply(eventFlow, upcastedEvent);
    await apply(eventFlow, preAppliedEvent, getAggregate);
    return preAppliedEvent;
  };
