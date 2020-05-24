import { AccountPackage } from '../../index';
import { getTestEventStoreService } from '../../../service/src/utils/testHelpers';
import { AccountCredit } from './Account.credit.event';
import { AccountCreated } from './Account.created.event';

let rightAccountId = 'd1cb92fe-55c9-4a92-8154-e79707a66584';
const wrongAccountId = 'wwwwwwww-wwww-wwww-wwww-wwwwwwwwwwww';
const tokenId = 'tokenId:789';
const wrongTokenId = 'tokenId:www';

beforeAll(async () => {
  const eventStoreService = await getTestEventStoreService();
  // create account
  const storedEvent = await AccountCreated.receiver(eventStoreService, {
    payload: {
      userId: '123',
      accountId: rightAccountId
    }
  });
  rightAccountId = storedEvent.payload.accountId;
});

test('process validated event: deposit 100 USD', async () => {
  const eventStoreService = await getTestEventStoreService();
  const event = await AccountCredit.receiver(eventStoreService, {
    payload: {
      accountId: rightAccountId,
      tokenId,
      amount: 100
    }
  });
  const updatedAccount = await AccountPackage.Query.getAccountBalanceByTokenId(rightAccountId, tokenId);

  if (!updatedAccount) {
    throw new Error(`account ${rightAccountId} not found`);
  }

  expect(updatedAccount.tokenId).toBe(tokenId);
  expect(updatedAccount.balance).toBe(100);
  expect(updatedAccount.updated.toISOString()).toBe(event.created.toISOString());
});

test('process invalidated event: accountId not exist', async () => {
  const eventStoreService = await getTestEventStoreService();
  await expect(
    AccountCredit.receiver(eventStoreService, {
      payload: {
        accountId: wrongAccountId,
        tokenId,
        amount: 333
      }
    })
  ).rejects.toThrowError(/Account is not exist - wwwwwwww-wwww-wwww-wwww-wwwwwwwwwwww/);

  const unUpdatedAccount = await AccountPackage.Query.getAccountBalanceByTokenId(rightAccountId, tokenId);

  if (!unUpdatedAccount) throw new Error(`Account ${rightAccountId} not found`);

  expect(unUpdatedAccount.tokenId).toBe(tokenId);
  expect(unUpdatedAccount.balance).toBe(100);
});

test('process invalidated event: token not exist', async () => {
  const eventStoreService = await getTestEventStoreService();
  await AccountCredit.receiver(eventStoreService, {
    payload: {
      accountId: rightAccountId,
      tokenId: wrongTokenId,
      amount: 444
    }
  });

  const unUpdatedAccount = await AccountPackage.Query.getAccountBalanceByTokenId(rightAccountId, tokenId);

  if (!unUpdatedAccount) throw new Error(`Account ${rightAccountId} not found`);

  expect(unUpdatedAccount.tokenId).toBe(tokenId);
  expect(unUpdatedAccount.balance).toBe(100);
});

test('process invalidated event: negative', async () => {
  const eventStoreService = await getTestEventStoreService();
  await expect(
    AccountCredit.receiver(eventStoreService, {
      payload: {
        accountId: rightAccountId,
        tokenId: tokenId,
        amount: -555
      }
    })
  ).rejects.toThrowError(/Deposit amount should be > 0/);

  const unUpdatedAccount = await AccountPackage.Query.getAccountBalanceByTokenId(rightAccountId, tokenId);

  if (!unUpdatedAccount) throw new Error(`Account ${rightAccountId} not found`);

  expect(unUpdatedAccount.tokenId).toBe(tokenId);
  expect(unUpdatedAccount.balance).toBe(100);
});
