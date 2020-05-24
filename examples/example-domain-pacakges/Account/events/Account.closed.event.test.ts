import { AccountPackage } from '../../index';
import { getTestEventStoreService } from '../../../service/src/utils/testHelpers';
import { v4 as uuid } from 'uuid';
import { AccountCredit } from './Account.credit.event';
import { AccountCreated } from './Account.created.event';
import { AccountClosed } from './Account.closed.event';

const userId = 'userId:123';
const tokenId1 = 'tokenId:1';

test('process validated event: closed account successfully', async () => {
  const eventStoreService = await getTestEventStoreService();
  const accountId = uuid();
  const accountCreatedEvent = await AccountCreated.receiver(eventStoreService, {
    payload: {
      userId,
      accountId
    }
  });

  const account1 = await AccountPackage.Query.getAccountById(accountId);

  expect(account1?.active).toBe(true);

  await AccountPackage.EventFlows.AccountClosed.receiver(eventStoreService, {
    payload: {
      accountId,
      userId
    }
  });

  const updatedAccount1 = await AccountPackage.Query.getAccountById(accountId);
  expect(updatedAccount1?.active).toBe(false);
});

test('process unvalidated event: closed account with balance', async () => {
  const eventStoreService = await getTestEventStoreService();
  const accountId = uuid();
  const accountCreatedEvent = await AccountPackage.EventFlows.AccountCreated.receiver(eventStoreService, {
    payload: {
      userId,
      accountId
    }
  });

  const account1 = await AccountPackage.Query.getAccountById(accountId);

  expect(account1?.active).toBe(true);

  await AccountCredit.receiver(eventStoreService, {
    payload: {
      accountId: accountId,
      tokenId: tokenId1,
      amount: 20
    }
  });

  await expect(
    AccountClosed.receiver(eventStoreService, {
      payload: {
        accountId: accountId,
        userId: userId
      }
    })
  ).rejects.toThrowError(/Account [\w-]+ tokenId:1 balance is not 0, it can not be closed./);
  const updatedAccount1 = await AccountPackage.Query.getAccountById(accountId);
  expect(updatedAccount1?.active).toBe(true);
});
