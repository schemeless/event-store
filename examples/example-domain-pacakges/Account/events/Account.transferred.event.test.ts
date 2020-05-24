import { AccountPackage } from '../../index';
import { getTestEventStoreService } from '../../../service/src/utils/testHelpers';
import { AccountCreated } from './Account.created.event';
import { AccountCredit } from './Account.credit.event';
import { AccountTransferred } from './Account.transferred.event';

const userId = 'user:123';
const tokenId = 'tokenId:789';

const fromAccountId: string = 'd1cb92fe-55c9-4a92-8154-e79707a66583';
const toAccountId: string = 'd1cb92fe-55c9-4a92-8154-e79707a66584';

beforeAll(async () => {
  const eventStoreService = await getTestEventStoreService();
  // create from account
  const fromAccountCreatedEvent = await AccountCreated.receiver(eventStoreService, {
    payload: {
      userId,
      accountId: fromAccountId
    }
  });

  // create to account
  const toAccountCreatedEvent = await AccountCreated.receiver(eventStoreService, {
    payload: {
      userId,
      accountId: toAccountId
    }
  });

  await AccountCredit.receiver(eventStoreService, {
    payload: {
      accountId: fromAccountId,
      tokenId: tokenId,
      amount: 100
    }
  });
});

test('process validated event: transfer 10', async () => {
  const eventStoreService = await getTestEventStoreService();
  await AccountTransferred.receiver(eventStoreService, {
    payload: {
      fromAccountId,
      toAccountId,
      tokenId,
      amount: 10
    }
  });

  const fromAccount = await AccountPackage.Query.getAccountBalanceByTokenId(fromAccountId, tokenId);
  const toAccount = await AccountPackage.Query.getAccountBalanceByTokenId(toAccountId, tokenId);

  if (!fromAccount || !toAccount) throw new Error(`Account not found`);

  expect(fromAccount.balance).toBe(90);
  expect(toAccount.balance).toBe(10);
});

test('process validated event: transfer 200, no enough balance', async () => {
  const eventStoreService = await getTestEventStoreService();
  expect(
    AccountTransferred.receiver(eventStoreService, {
      payload: {
        fromAccountId,
        toAccountId,
        tokenId,
        amount: 200
      }
    })
  ).rejects.toThrowError(/Account balance is too low - [\w-]+: tokenId:789 : 90 - 200/);

  const fromAccount = await AccountPackage.Query.getAccountBalanceByTokenId(fromAccountId, tokenId);
  const toAccount = await AccountPackage.Query.getAccountBalanceByTokenId(toAccountId, tokenId);

  if (!fromAccount || !toAccount) throw new Error(`Account not found`);

  expect(fromAccount.balance).toBe(90); // nothing changed
  expect(toAccount.balance).toBe(10); // nothing changed
});
