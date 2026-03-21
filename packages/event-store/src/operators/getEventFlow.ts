import { FlowNotFoundError } from '@schemeless/event-store-types';
import type { BaseEvent, EventFlow, EventFlowMap } from '@schemeless/event-store-types';

// logger.info(`🚥 🎢 |${event.correlationId?.substr(-4) || '----'}|${event.causationId?.substr(-4) || '----'}|${event.refId.substr(-4)}|flow processing\t|${event.domain}__${event.action}: `);
export const getEventFlow =
  (eventFlowMap: EventFlowMap) =>
  (event: BaseEvent<any, any>): EventFlow<any> => {
    const getEventKey = (event: BaseEvent<any, any>) => event.domain + '__' + event.type;
    const key = getEventKey(event);
    const eventFlow = eventFlowMap[key];
    if (!eventFlow) {
      throw new FlowNotFoundError(event.domain, event.type);
    }
    return eventFlow;
  };
