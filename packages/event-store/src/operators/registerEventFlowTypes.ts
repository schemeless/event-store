import type { EventFlow, EventFlowMap } from '@schemeless/event-store-types';

const getEventFlowKey = (eventFlow: EventFlow<any>) => {
  if (!eventFlow.domain) throw new Error(`EventFlow domain is not defined. type: ${eventFlow.type}`);
  if (!eventFlow.type) throw new Error(`EventFlow type is not defined. domain: ${eventFlow.domain}`);
  return eventFlow.domain + '__' + eventFlow.type;
};

const registerEventFlowType = (eventFlowMap: EventFlowMap, eventFlow: EventFlow<any>) => {
  const key = getEventFlowKey(eventFlow);
  if (!!eventFlowMap[key]) {
    throw new Error(`Event Flow (${key}) is already registered.`);
  }
  return Object.assign({}, eventFlowMap, { [key]: eventFlow });
};

export const registerEventFlowTypes = (eventFlowMap: EventFlowMap, eventFlows: EventFlow<any>[]) =>
  eventFlows.reduce((lastMap, currentEventFlow) => registerEventFlowType(lastMap, currentEventFlow), eventFlowMap);
