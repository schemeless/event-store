import { config } from '../../../service/src/config';
import { AccountPackage } from '../../index';
import { OrderEntity, OrderStatus, OrderType } from '../Order.entity';
import { OrderCancelled, OrderPackage, OrderPlaced } from '../index';
import { getTestEventStoreService } from '../../../service/src/utils/testHelpers';
import { BaseEvent } from '@schemeless/event-store';
import { v4 as uuid } from 'uuid';

const { AccountCreated, AccountCredit } = AccountPackage.EventFlows;

const primaryUserId = 'aaa';
const primaryAccountId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const tokenId = 'tokenId:789';

beforeAll(async () => {
  const eventStoreService = await getTestEventStoreService();
  // create account
  const createPrimaryAccountEvent = await AccountCreated.receiver(eventStoreService, {
    payload: {
      userId: primaryUserId,
      accountId: primaryAccountId
    }
  });
  const depositToPrimaryAccount = await AccountCredit.receiver(eventStoreService, {
    payload: {
      accountId: primaryAccountId,
      tokenId: config.baseToken,
      amount: 100
    }
  });
  const depositToPrimaryAccount2 = await AccountCredit.receiver(eventStoreService, {
    payload: {
      accountId: primaryAccountId,
      tokenId: tokenId,
      amount: 100
    }
  });
});

test('cancel order', async () => {
  const eventStoreService = await getTestEventStoreService();
  const id = uuid();
  await OrderPlaced.receiver(eventStoreService, {
    payload: {
      id,
      userId: primaryUserId,
      accountId: primaryAccountId,
      type: OrderType.BUY,
      tokenId: tokenId,
      amount: 2,
      unitPrice: 10
    }
  });
  const cancelEvent = {
    payload: {
      id,
      userId: primaryUserId
    }
  };

  await OrderCancelled.receiver(eventStoreService, cancelEvent);

  const order = await OrderPackage.Query.getOrderById(cancelEvent.payload.id);

  if (!order) throw new Error('order not found');

  expect(order.status).toBe(OrderStatus.CANCELLED);
});
