import type { BaseEvent, EventFlow } from '@schemeless/event-store';
import { OrderEntity, OrderStatus, OrderType } from '../Order.entity';
import { getOrderEntityRepository } from '../Order.entity.repository';
import { config } from '../../../service/src/config';
import { OrderTryMatched } from '../index';
import { AccountPackage } from '../../Account';

export interface OrderPlacedEventPayload {
  id: string;
  userId: string;
  accountId: string;
  type: OrderType;
  tokenId: string;
  amount: number;
  unitPrice: number;
}

export const OrderPlaced: EventFlow<OrderPlacedEventPayload> = {
  domain: 'order',
  type: 'placed',

  samplePayload: {
    id: '<id>',
    userId: '<userId>',
    accountId: '<accountId>',
    type: OrderType.BUY,
    tokenId: '<tokenId>',
    amount: 100,
    unitPrice: 2,
  },

  executor: async (event): Promise<void> => {
    const orderRepo = await getOrderEntityRepository();

    const newOrder = new OrderEntity();
    newOrder.id = event.payload.id;
    newOrder.userId = event.payload.userId;
    newOrder.accountId = event.payload.accountId;
    newOrder.tokenId = event.payload.tokenId;
    newOrder.unitPrice = event.payload.unitPrice;
    newOrder.amount = event.payload.amount;
    newOrder.amountLeft = event.payload.amount;
    newOrder.type = event.payload.type;
    newOrder.status = OrderStatus.MATCHING;
    newOrder.created = event.created;
    newOrder.updated = event.created;
    await orderRepo.save(newOrder);
  },

  consequentEventsCreator: async (
    parentEvent
  ): Promise<
    [
      BaseEvent<typeof AccountPackage.EventFlows.AccountDebit.samplePayload>,
      BaseEvent<typeof OrderTryMatched.samplePayload>
    ]
  > => {
    const { id, accountId, tokenId, unitPrice, amount, type } = parentEvent.payload;

    const debitEvent = {
      domain: AccountPackage.EventFlows.AccountDebit.domain,
      type: AccountPackage.EventFlows.AccountDebit.type,
      payload: {
        accountId,
        tokenId: type === OrderType.BUY ? config.baseToken : tokenId,
        amount: type === OrderType.BUY ? unitPrice * amount : amount,
      },
    };

    const tryMatchedEvent = {
      domain: OrderTryMatched.domain,
      type: OrderTryMatched.type,
      payload: {
        orderId: id,
      },
    };
    return [debitEvent, tryMatchedEvent];
  },

  receiver: (eventStoreService, eventInputArgs) =>
    eventStoreService.receiveEventInput(OrderPlaced.domain, OrderPlaced.type, eventInputArgs),
};
