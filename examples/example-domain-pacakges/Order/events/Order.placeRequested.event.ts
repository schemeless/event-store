import { BaseEvent, EventFlow } from '@schemeless/event-store';
import { v4 as uuid } from 'uuid';
import { AccountPackage } from '../../index';
import { OrderType } from '../Order.entity';
import { config } from '../../../service/src/config';
import { OrderPackage, OrderPlaced } from '../index';
import * as R from 'ramda';

export interface OrderPlaceRequestedEventPayload {
  userId: string;
  accountId: string;
  type: OrderType;
  tokenId: string;
  amount: number;
  unitPrice: number;
}

export const OrderPlaceRequested: EventFlow<OrderPlaceRequestedEventPayload> = {
  domain: 'order',
  type: 'placeRequested',

  samplePayload: {
    userId: 'userId',
    accountId: 'accountId',
    type: OrderType.BUY,
    tokenId: 'tokenId',
    amount: 10,
    unitPrice: 10
  },

  validator: async event => {
    //check whether the user own the account
    const account = await AccountPackage.Query.getAccountById(event.payload.accountId);

    if (!account) {
      return new Error(`Account not found ${event.payload.accountId}`);
    }

    if (account.userId != event.payload.userId) {
      return new Error(`You are not authorized to place the Order ${event.payload.userId}`);
    }
    //check whether placed same order
    const order = await OrderPackage.Query.getOrderByAccountAndToken(event.payload.accountId, event.payload.tokenId);
    if (!R.isNil(order)) {
      return new Error(
        `Account ${event.payload.accountId} can not place order about token ${event.payload.tokenId} twice`
      );
    }
    //if amount is not a positive number
    if (event.payload.amount <= 0) {
      return new Error(`amount should be a positive number`);
    }
    //if buy, check base token balance;
    if (event.payload.type === OrderType.BUY) {
      const baseTokenAccount = await AccountPackage.Query.getAccountBalanceByTokenId(
        event.payload.accountId,
        config.baseToken
      );

      if (!baseTokenAccount) {
        return new Error(`baseTokenAccount not found ${event.payload.accountId} -- ${config.baseToken}`);
      }

      if (baseTokenAccount.balance < event.payload.amount * event.payload.unitPrice) {
        return new Error(`Account ${event.payload.accountId} ${config.baseToken} does not have enough balance`);
      }
    }
    //if sell, check whether has enough token
    if (event.payload.type === OrderType.SELL) {
      const orderTokenAccount = await AccountPackage.Query.getAccountBalanceByTokenId(
        event.payload.accountId,
        event.payload.tokenId
      );

      if (!orderTokenAccount) {
        return new Error(`orderTokenAccount not found ${event.payload.accountId} -- ${event.payload.tokenId}`);
      }
      if (orderTokenAccount.balance < event.payload.amount) {
        return new Error(`Account  ${event.payload.accountId}  ${event.payload.tokenId} does not have enough balance`);
      }
    }
  },

  consequentEventsCreator: async parentEvent => {
    const { userId, accountId, tokenId, unitPrice, amount, type } = parentEvent.payload;

    const orderPlacedEvent: BaseEvent<typeof OrderPlaced.samplePayload> = {
      domain: OrderPlaced.domain,
      type: OrderPlaced.type,
      payload: {
        id: uuid(),
        userId,
        accountId,
        type,
        tokenId,
        amount,
        unitPrice
      }
    };

    return [orderPlacedEvent];
  },

  receiver: (eventStoreService, eventInputArgs) =>
    eventStoreService.receiveEventInput(OrderPlaceRequested.domain, OrderPlaceRequested.type, eventInputArgs)
};
