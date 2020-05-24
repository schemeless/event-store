import { EventFlow } from '@schemeless/event-store';
import * as R from 'ramda';
import { OrderType } from '../Order.entity';
import { getOrderEntityRepository } from '../Order.entity.repository';
import { config } from '../../../service/src/config';
import { OrderMatched, OrderPackage } from '../index';

export interface OrderTryMatchedEventPayload {
  orderId: string;
}

export const OrderTryMatched: EventFlow<OrderTryMatchedEventPayload> = {
  domain: 'order',
  type: 'tryMatched',

  samplePayload: {
    orderId: 'orderId'
  },

  validator: async event => {
    const order = await OrderPackage.Query.getOrderById(event.payload.orderId);
    if (!order) {
      return new Error(`Order ${event.payload.orderId} not found!`);
    }
  },

  executor: async event => {
    const orderRepo = await getOrderEntityRepository();

    const order = await OrderPackage.Query.getOrderById(event.payload.orderId);

    if (!order) {
      throw new Error(`Order ${event.payload.orderId} not found`);
    }

    order.lastMatched = event.created;
    await orderRepo.save(order);
  },

  consequentEventsCreator: async parentEvent => {
    const triggerOrder = await OrderPackage.Query.getOrderById(parentEvent.payload.orderId);

    if (!triggerOrder) {
      throw new Error(`Order ${parentEvent.payload.orderId} not found`);
    }

    if (triggerOrder.type === OrderType.BUY) {
      const buyOrder = triggerOrder;
      const sellOrder = await OrderPackage.Query.findMatchedSellOrder(buyOrder.tokenId, buyOrder.unitPrice);
      if (!sellOrder) return [];

      const transactionAmount = R.min(buyOrder.amountLeft, sellOrder.amountLeft);
      const transactionUnitPrice = sellOrder.unitPrice;
      const orderMatchedEvent = {
        domain: OrderMatched.domain,
        type: OrderMatched.type,
        payload: {
          triggerOrderId: triggerOrder.id,

          primaryOrderId: buyOrder.id,
          primaryAccountId: buyOrder.accountId,
          primaryTokenId: config.baseToken,
          primaryTokenAmount: transactionUnitPrice * transactionAmount,

          secondaryOrderId: sellOrder.id,
          secondaryAccountId: sellOrder.accountId,
          secondaryTokenId: sellOrder.tokenId,
          secondaryTokenAmount: transactionAmount
        }
      };

      return [orderMatchedEvent];
    }

    if (triggerOrder.type === OrderType.SELL) {
      const sellOrder = triggerOrder;
      const buyOrder = await OrderPackage.Query.findMatchedBuyOrder(sellOrder.tokenId, sellOrder.unitPrice);
      if (!buyOrder) return [];

      const transactionAmount = R.min(sellOrder.amountLeft, buyOrder.amountLeft);
      const transactionUnitPrice = buyOrder.unitPrice;
      const orderMatchedEvent = {
        domain: OrderMatched.domain,
        type: OrderMatched.type,
        payload: {
          triggerOrderId: triggerOrder.id,

          primaryOrderId: buyOrder.id,
          primaryAccountId: buyOrder.accountId,
          primaryTokenId: config.baseToken,
          primaryTokenAmount: transactionUnitPrice * transactionAmount,

          secondaryOrderId: sellOrder.id,
          secondaryAccountId: sellOrder.accountId,
          secondaryTokenId: sellOrder.tokenId,
          secondaryTokenAmount: transactionAmount
        }
      };

      return [orderMatchedEvent];
    }

    return [];
  },

  receiver: (eventStoreService, eventInputArgs) =>
    eventStoreService.receiveEventInput(OrderTryMatched.domain, OrderTryMatched.type, eventInputArgs)
};
