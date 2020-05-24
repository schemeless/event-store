import { BaseEvent, EventFlow } from '@schemeless/event-store';
import { getOrderEntityRepository } from '../Order.entity.repository';
import { OrderPackage } from '../index';
import { OrderStatus, OrderType } from '../Order.entity';
import { AccountPackage } from '../../Account';
import { config } from '../../../service/src/config';
import { AccountCredit } from '../../Account/events';

export interface OrderCancelledPayload {
  id: string;
  userId: string;
}

export const OrderCancelled: EventFlow<OrderCancelledPayload> = {
  domain: 'order',
  type: 'cancelled',

  samplePayload: {
    id: '<id>',
    userId: '<userId>'
  },

  validator: async event => {
    const order = await OrderPackage.Query.getOrderById(event.payload.id);
    if (!order) {
      return new Error(`Order ${event.payload.id} not found!`);
    }

    const account = await AccountPackage.Query.getAccountById(order.accountId);

    if (!account) {
      return new Error(`Account is not exist - ${order.accountId}`);
    }

    if (account.userId != event.payload.userId) {
      return new Error(`You are not authorized to cancel the Order ${event.payload.id}`);
    }
  },

  executor: async event => {
    const orderRepo = await getOrderEntityRepository();
    const order = await OrderPackage.Query.getOrderById(event.payload.id);
    if (!order) {
      throw new Error(`Order is not exist - ${event.payload.id}`);
    }
    order.status = OrderStatus.CANCELLED;
    await orderRepo.save(order);
  },

  consequentEventsCreator: async (parentEvent): Promise<[BaseEvent<typeof AccountCredit.samplePayload>]> => {
    const order = await OrderPackage.Query.getOrderById(parentEvent.payload.id);
    if (!order) {
      throw new Error(`Order is not exist - ${parentEvent.payload.id}`);
    }
    if (order.type === OrderType.BUY) {
      return [
        {
          domain: AccountCredit.domain,
          type: AccountCredit.type,
          payload: {
            accountId: order.accountId,
            tokenId: config.baseToken,
            amount: order.amountLeft * order.unitPrice
          }
        }
      ];
    } else if (order.type === OrderType.SELL) {
      return [
        {
          domain: AccountCredit.domain,
          type: AccountCredit.type,
          payload: {
            accountId: order.accountId,
            tokenId: order.tokenId,
            amount: order.amountLeft
          }
        }
      ];
    }

    throw new Error('unknown order type');
  },

  receiver: (eventStoreService, eventInputArgs) =>
    eventStoreService.receiveEventInput(OrderCancelled.domain, OrderCancelled.type, eventInputArgs)
};
