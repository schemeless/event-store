import type { AggregateEventFlow, EventFlow } from '@schemeless/event-store-types';

export const isAggregateEventFlow = (
  eventFlow: EventFlow<any, any, any> | AggregateEventFlow<any, any, any, any>
): eventFlow is AggregateEventFlow<any, any, any, any> => {
  if (eventFlow.kind === 'aggregate') return true;
  if (eventFlow.kind === 'simple') return false;
  return 'aggregate' in eventFlow && (eventFlow as AggregateEventFlow<any, any, any, any>).aggregate != null;
};
