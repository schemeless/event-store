import { EventFlow } from '@schemeless/event-store';
import * as eventFlows from './events';
import { OrderEntity, OrderStatus, OrderType, OrderMatchedRecordEntity } from './Order.entity';
import { OrderQuery } from './Order.query';

export const eventFlowList: EventFlow<any>[] = [
  eventFlows.OrderPlaceRequested,
  eventFlows.OrderPlaced,
  eventFlows.OrderTryMatched,
  eventFlows.OrderMatched,
  eventFlows.OrderCancelled
];

export * from './events';
export { OrderStatus, OrderType };

export const OrderPackage = {
  Query: OrderQuery,
  Entities: [OrderEntity, OrderMatchedRecordEntity],
  EventFlows: eventFlows,
  EventFlowList: eventFlowList
};
