import type { AggregateEventFlow, EventFlow } from '@schemeless/event-store-types';

export const isAggregateEventFlow = (
  eventFlow: EventFlow<any, any, any> | AggregateEventFlow<any, any, any, any>
): eventFlow is AggregateEventFlow<any, any, any, any> => 'aggregate' in eventFlow && eventFlow.aggregate != null;
