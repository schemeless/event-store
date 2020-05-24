import { config } from '../../../service/src/config';
import { AccountPackage } from '../../index';
import { OrderType } from '../Order.entity';
import { OrderPackage, OrderPlaced } from '../index';
import { getTestEventStoreService } from '../../../service/src/utils/testHelpers';
import { getProjectiveDbConnection } from '../../../service/src/utils/getProjectiveDbConnection';
import { AccountCreated, AccountCredit } from '../../Account/events';
import { v4 as uuid } from 'uuid';

const primaryUserId = 'aaa';
const secondaryUserId = 'bbb';
const primaryAccountId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const secondaryAccountId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const tokenId = 'tokenId:789';
let connection: import('typeorm').Connection;
beforeAll(async () => {
  const eventStoreService = await getTestEventStoreService();
  connection = await getProjectiveDbConnection();

  // create account
  const createPrimaryAccountEvent = {
    domain: AccountCreated.domain,
    type: AccountCreated.type,
    payload: {
      userId: primaryUserId,
      accountId: primaryAccountId
    }
  };
  const createSecondaryAccountEvent = {
    domain: AccountCreated.domain,
    type: AccountCreated.type,
    payload: {
      userId: secondaryUserId,
      accountId: secondaryAccountId
    }
  };
  const depositToPrimaryAccount = {
    domain: AccountCredit.domain,
    type: AccountCredit.type,
    payload: {
      accountId: primaryAccountId,
      tokenId: config.baseToken,
      amount: 100
    }
  };
  const depositToPrimaryAccount2 = {
    domain: AccountCredit.domain,
    type: AccountCredit.type,
    payload: {
      accountId: primaryAccountId,
      tokenId: tokenId,
      amount: 100
    }
  };
  const depositToSecondaryAccount = {
    domain: AccountCredit.domain,
    type: AccountCredit.type,
    payload: {
      accountId: secondaryAccountId,
      tokenId: tokenId,
      amount: 100
    }
  };
  const depositToSecondaryAccount2 = {
    domain: AccountCredit.domain,
    type: AccountCredit.type,
    payload: {
      accountId: secondaryAccountId,
      tokenId: config.baseToken,
      amount: 100
    }
  };
  await AccountCreated.receiver(eventStoreService, createPrimaryAccountEvent);
  await AccountCreated.receiver(eventStoreService, createSecondaryAccountEvent);
  await AccountCredit.receiver(eventStoreService, depositToPrimaryAccount);
  await AccountCredit.receiver(eventStoreService, depositToSecondaryAccount);
  await AccountCredit.receiver(eventStoreService, depositToPrimaryAccount2);
  await AccountCredit.receiver(eventStoreService, depositToSecondaryAccount2);
});

test('match one order', async () => {
  const eventStoreService = await getTestEventStoreService();
  const buyEvent = {
    domain: OrderPlaced.domain,
    type: OrderPlaced.type,
    payload: {
      id: uuid(),
      userId: primaryUserId,
      accountId: primaryAccountId,
      type: OrderType.BUY,
      tokenId: tokenId,
      amount: 2,
      unitPrice: 10
    }
  };

  const sellEvent = {
    domain: OrderPlaced.domain,
    type: OrderPlaced.type,
    payload: {
      id: uuid(),
      userId: secondaryUserId,
      accountId: secondaryAccountId,
      type: OrderType.SELL,
      tokenId: tokenId,
      amount: 5,
      unitPrice: 9
    }
  };

  const buyEvent1 = await OrderPlaced.receiver(eventStoreService, buyEvent);
  const sellEvent1 = await OrderPlaced.receiver(eventStoreService, sellEvent);

  const primaryBaseAccount = await AccountPackage.Query.getAccountBalanceByTokenId(primaryAccountId, config.baseToken);
  const secondaryBaseAccount = await AccountPackage.Query.getAccountBalanceByTokenId(
    secondaryAccountId,
    config.baseToken
  );

  if (!primaryBaseAccount || !secondaryBaseAccount) throw new Error(`base account not found`);

  const primaryTokenAccount = await AccountPackage.Query.getAccountBalanceByTokenId(primaryAccountId, tokenId);
  const secondaryTokenAccount = await AccountPackage.Query.getAccountBalanceByTokenId(secondaryAccountId, tokenId);

  if (!primaryTokenAccount || !secondaryTokenAccount) throw new Error(`token account not found`);

  const buyOrder = await OrderPackage.Query.getOrderById(buyEvent1.payload.id);
  const sellOrder = await OrderPackage.Query.getOrderById(sellEvent1.payload.id);

  if (!buyOrder || !sellOrder) throw new Error(`order not found`);

  expect(buyOrder.amountLeft).toBe(0);
  expect(sellOrder.amountLeft).toBe(3);

  expect(primaryBaseAccount.balance).toBe(80);
  expect(secondaryBaseAccount.balance).toBe(120);

  expect(primaryTokenAccount.balance).toBe(102);
  expect(secondaryTokenAccount.balance).toBe(95);
});

afterEach(async () => {
  await connection.dropDatabase();
});
