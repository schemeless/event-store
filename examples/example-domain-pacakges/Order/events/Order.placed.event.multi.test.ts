import { config } from '../../../service/src/config';
import { AccountPackage } from '../../index';
import { OrderType } from '../Order.entity';
import { OrderPackage, OrderPlaced } from '../index';
import { Connection } from 'typeorm';
import { v4 as uuid } from 'uuid';
import { getTestEventStoreService } from '../../../service/src/utils/testHelpers';
import { getProjectiveDbConnection } from '../../../service/src/utils/getProjectiveDbConnection';
import { AccountCreated, AccountCredit } from '../../Account/events';
import { BaseEvent } from '@schemeless/event-store';

const primaryUserId = 'aaa';
const secondaryUserId = 'bbb';
const thirdUserId = 'ccc';
const primaryAccountId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const secondaryAccountId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const thirdAccountId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const tokenId = 'tokenId:789';

let connection: Connection;

beforeEach(async () => {
  const eventStoreService = await getTestEventStoreService();
  connection = await getProjectiveDbConnection();
  console.log('beforeEach' + uuid().substr(-5));

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

  const createThirdAccountEvent = {
    domain: AccountCreated.domain,
    type: AccountCreated.type,
    payload: {
      userId: thirdUserId,
      accountId: thirdAccountId
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

  const depositToThirdAccount = {
    domain: AccountCredit.domain,
    type: AccountCredit.type,
    payload: {
      accountId: thirdAccountId,
      tokenId: tokenId,
      amount: 100
    }
  };
  const depositToThirdAccount2 = {
    domain: AccountCredit.domain,
    type: AccountCredit.type,
    payload: {
      accountId: thirdAccountId,
      tokenId: config.baseToken,
      amount: 100
    }
  };

  await AccountCreated.receiver(eventStoreService, createPrimaryAccountEvent);
  await AccountCreated.receiver(eventStoreService, createSecondaryAccountEvent);
  await AccountCreated.receiver(eventStoreService, createThirdAccountEvent);
  await AccountCredit.receiver(eventStoreService, depositToPrimaryAccount);
  await AccountCredit.receiver(eventStoreService, depositToSecondaryAccount);
  await AccountCredit.receiver(eventStoreService, depositToPrimaryAccount2);
  await AccountCredit.receiver(eventStoreService, depositToSecondaryAccount2);
  await AccountCredit.receiver(eventStoreService, depositToThirdAccount);
  await AccountCredit.receiver(eventStoreService, depositToThirdAccount2);
});

test('try to match two order', async () => {
  const eventStoreService = await getTestEventStoreService();
  const buyEvent: BaseEvent<typeof OrderPlaced.samplePayload> = {
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

  const buyEvent2 = {
    domain: OrderPlaced.domain,
    type: OrderPlaced.type,
    payload: {
      id: uuid(),
      userId: thirdUserId,
      accountId: thirdAccountId,
      type: OrderType.BUY,
      tokenId: tokenId,
      amount: 3,
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

  await OrderPlaced.receiver(eventStoreService, buyEvent);
  await OrderPlaced.receiver(eventStoreService, buyEvent2);
  await OrderPlaced.receiver(eventStoreService, sellEvent);

  const primaryBaseAccount = await AccountPackage.Query.getAccountBalanceByTokenId(primaryAccountId, config.baseToken);
  const secondaryBaseAccount = await AccountPackage.Query.getAccountBalanceByTokenId(
    secondaryAccountId,
    config.baseToken
  );
  const thirdBaseAccount = await AccountPackage.Query.getAccountBalanceByTokenId(thirdAccountId, config.baseToken);

  const primaryTokenAccount = await AccountPackage.Query.getAccountBalanceByTokenId(primaryAccountId, tokenId);
  const secondaryTokenAccount = await AccountPackage.Query.getAccountBalanceByTokenId(secondaryAccountId, tokenId);
  const thirdTokenAccount = await AccountPackage.Query.getAccountBalanceByTokenId(thirdAccountId, tokenId);

  if (!primaryBaseAccount || !thirdBaseAccount || !secondaryTokenAccount) throw new Error(`something not found`);
  if (!secondaryBaseAccount || !primaryTokenAccount || !thirdTokenAccount) throw new Error(`something not found`);

  expect(primaryBaseAccount.balance).toBe(80);
  expect(thirdBaseAccount.balance).toBe(70);
  expect(secondaryBaseAccount.balance).toBe(150);

  expect(primaryTokenAccount.balance).toBe(102);
  expect(thirdTokenAccount.balance).toBe(103);
  expect(secondaryTokenAccount.balance).toBe(95);
});

test('can not match order', async () => {
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

  const buyEvent2 = {
    domain: OrderPlaced.domain,
    type: OrderPlaced.type,
    payload: {
      id: uuid(),
      userId: thirdUserId,
      accountId: thirdAccountId,
      type: OrderType.BUY,
      tokenId: tokenId,
      amount: 3,
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
      unitPrice: 11
    }
  };

  await OrderPlaced.receiver(eventStoreService, buyEvent);
  await OrderPlaced.receiver(eventStoreService, buyEvent2);
  await OrderPlaced.receiver(eventStoreService, sellEvent);

  const primaryBaseAccount = await AccountPackage.Query.getAccountBalanceByTokenId(primaryAccountId, config.baseToken);
  const secondaryBaseAccount = await AccountPackage.Query.getAccountBalanceByTokenId(
    secondaryAccountId,
    config.baseToken
  );
  const thirdBaseAccount = await AccountPackage.Query.getAccountBalanceByTokenId(thirdAccountId, config.baseToken);

  const primaryTokenAccount = await AccountPackage.Query.getAccountBalanceByTokenId(primaryAccountId, tokenId);
  const secondaryTokenAccount = await AccountPackage.Query.getAccountBalanceByTokenId(secondaryAccountId, tokenId);
  const thirdTokenAccount = await AccountPackage.Query.getAccountBalanceByTokenId(thirdAccountId, tokenId);

  if (!primaryBaseAccount || !thirdBaseAccount || !secondaryTokenAccount) throw new Error(`something not found`);
  if (!secondaryBaseAccount || !primaryTokenAccount || !thirdTokenAccount) throw new Error(`something not found`);

  expect(primaryBaseAccount.balance).toBe(80);
  expect(thirdBaseAccount.balance).toBe(70);
  expect(secondaryBaseAccount.balance).toBe(100);

  expect(primaryTokenAccount.balance).toBe(100);
  expect(thirdTokenAccount.balance).toBe(100);
  expect(secondaryTokenAccount.balance).toBe(95);
});

afterEach(async () => {
  console.log('droping ' + uuid().substr(-5));
  await connection.synchronize(true);
});
