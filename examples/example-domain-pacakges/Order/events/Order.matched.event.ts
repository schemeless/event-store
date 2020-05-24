import { EventFlow } from '@schemeless/event-store';
import { OrderMatchedRecordEntity, OrderStatus, OrderType } from '../Order.entity';
import { getOrderEntityRepository, getOrderMatchedRecordEntityRepository } from '../Order.entity.repository';
import { OrderPackage, OrderTryMatched } from '../index';
import { AccountTraded } from '../../Account/events';
import { config } from '../../../service/src/config';

export interface OrderMatchedEventPayload {
  triggerOrderId: string;

  primaryOrderId: string;
  primaryAccountId: string;
  primaryTokenId: string;
  primaryTokenAmount: number;

  secondaryOrderId: string;
  secondaryAccountId: string;
  secondaryTokenId: string;
  secondaryTokenAmount: number;
}

export const OrderMatched: EventFlow<OrderMatchedEventPayload> = {
  domain: 'order',
  type: 'Matched',

  samplePayload: {
    triggerOrderId: '<someId>',

    primaryOrderId: '<someId>',
    primaryAccountId: '<someId>',
    primaryTokenId: '<someId>',
    primaryTokenAmount: 10,

    secondaryOrderId: '<someId>',
    secondaryAccountId: '<someId>',
    secondaryTokenId: '<someId>',
    secondaryTokenAmount: 10
  },

  validator: async event => {
    const buyOrder = await OrderPackage.Query.getOrderById(event.payload.primaryOrderId);
    if (!buyOrder) {
      return new Error(`no buyOrder ${event.payload.primaryOrderId}`);
    }
    if (buyOrder.amountLeft <= 0 || buyOrder.status === OrderStatus.FINISHED) {
      return new Error(
        `buyOrder finished ${event.payload.primaryOrderId}: left ${buyOrder.amountLeft} ${buyOrder.status}`
      );
    }
    const sellOrder = await OrderPackage.Query.getOrderById(event.payload.secondaryOrderId);
    if (!sellOrder) {
      return new Error(`no sellOrder ${event.payload.primaryOrderId}`);
    }
    if (sellOrder.amountLeft <= 0 || sellOrder.status === OrderStatus.FINISHED) {
      return new Error(
        `sellOrder finished ${event.payload.primaryOrderId}: left ${sellOrder.amountLeft} ${sellOrder.status}`
      );
    }
  },

  executor: async event => {
    const orderRepo = await getOrderEntityRepository();
    const orderMatchedRepo = await getOrderMatchedRecordEntityRepository();
    const { payload } = event;

    const buyOrder = await OrderPackage.Query.getOrderById(payload.primaryOrderId);

    if (!buyOrder) {
      throw new Error(`buyOrder ${payload.primaryOrderId} not found`);
    }

    buyOrder.amountLeft -= payload.secondaryTokenAmount;
    buyOrder.status = buyOrder.amountLeft > 0 ? OrderStatus.MATCHING : OrderStatus.FINISHED;
    buyOrder.updated = event.created;

    const sellOrder = await OrderPackage.Query.getOrderById(payload.secondaryOrderId);

    if (!sellOrder) {
      throw new Error(`sellOrder ${payload.secondaryOrderId} not found`);
    }

    sellOrder.amountLeft -= payload.secondaryTokenAmount;

    sellOrder.status = sellOrder.amountLeft > 0 ? OrderStatus.MATCHING : OrderStatus.FINISHED;
    sellOrder.updated = event.created;

    const newRecord = new OrderMatchedRecordEntity();
    const orderType: OrderType = buyOrder.tokenId === config.baseToken ? OrderType.BUY : OrderType.SELL;
    const tokenOrder = orderType === OrderType.BUY ? sellOrder : buyOrder;

    newRecord.type = OrderType.BUY;
    newRecord.tokenId = tokenOrder.tokenId;
    newRecord.unitPrice = sellOrder.unitPrice;

    newRecord.mainOrderId = buyOrder.id;
    newRecord.mainAccountId = buyOrder.accountId;
    newRecord.mainAmount = payload.primaryTokenAmount;

    newRecord.tokenOrderId = sellOrder.id;
    newRecord.tokenAccountId = sellOrder.accountId;
    newRecord.tokenAmount = payload.secondaryTokenAmount;

    newRecord.created = event.created;

    await orderRepo.save(buyOrder);
    await orderRepo.save(sellOrder);
    await orderMatchedRepo.save(newRecord);
  },

  consequentEventsCreator: async parentEvent => {
    const { payload } = parentEvent;
    const newTransactionEvent = {
      domain: AccountTraded.domain,
      type: AccountTraded.type,
      payload: {
        primaryAccountId: payload.primaryAccountId,
        primaryTokenId: payload.primaryTokenId,
        primaryTokenAmount: payload.primaryTokenAmount,

        secondaryAccountId: payload.secondaryAccountId,
        secondaryTokenId: payload.secondaryTokenId,
        secondaryTokenAmount: payload.secondaryTokenAmount
      }
    };

    const triggerOrder = await OrderPackage.Query.getOrderById(payload.triggerOrderId);

    if (!triggerOrder) {
      throw new Error(`trigger Order ${parentEvent.payload.triggerOrderId} not found`);
    }

    if (triggerOrder.amountLeft > 0) {
      const tryMatchedEvent = {
        domain: OrderTryMatched.domain,
        type: OrderTryMatched.type,
        payload: {
          orderId: triggerOrder.id
        }
      };
      return [newTransactionEvent, tryMatchedEvent];
    } else {
      return [newTransactionEvent];
    }
  },

  receiver: (eventStoreService, eventInputArgs) =>
    eventStoreService.receiveEventInput(OrderMatched.domain, OrderMatched.type, eventInputArgs)
};
