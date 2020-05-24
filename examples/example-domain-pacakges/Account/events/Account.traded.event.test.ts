import { config } from '../../../service/src/config';
import { AccountPackage, featureEntities } from '../../index';
import { getTestEventStoreService } from '../../../service/src/utils/testHelpers';
import { AccountCreated } from './Account.created.event';
import { AccountCredit } from './Account.credit.event';
import { AccountTraded } from './Account.traded.event';

const userId = 'user:123';
const tokenId = 'tokenId:789';

const fromAccountId: string = 'd1cb92fe-55c9-4a92-8154-e79707a66583';
const toAccountId: string = 'd1cb92fe-55c9-4a92-8154-e79707a66694';

beforeAll(async () => {
  const eventStoreService = await getTestEventStoreService();
  // create from account
  await AccountCreated.receiver(eventStoreService, {
    payload: {
      userId,
      accountId: fromAccountId
    }
  });

  // create to account
  await AccountCreated.receiver(eventStoreService, {
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

test('token from one account to another account', async () => {
  const eventStoreService = await getTestEventStoreService();
  await AccountTraded.receiver(eventStoreService, {
    payload: {
      primaryAccountId: toAccountId,
      primaryTokenId: config.baseToken,
      primaryTokenAmount: 100,

      secondaryAccountId: fromAccountId,
      secondaryTokenId: tokenId,
      secondaryTokenAmount: 10
    }
  });

  const primaryTokenAccount = await AccountPackage.Query.getAccountBalanceByTokenId(toAccountId, tokenId);
  const secondaryBaseAccount = await AccountPackage.Query.getAccountBalanceByTokenId(fromAccountId, config.baseToken);

  if (!primaryTokenAccount || !secondaryBaseAccount) throw new Error('Account not found');

  expect(primaryTokenAccount.balance).toBe(10);
  expect(secondaryBaseAccount.balance).toBe(100);
});
