import { AccountQuery } from '../Account.query';
import { getTestEventStoreService } from '../../../service/src/utils/testHelpers';
import { v4 as uuid } from 'uuid';
import { AccountCreated } from './Account.created.event';

const userId = 'userId:123';
const accountId = uuid();

test('process validated event', async () => {
  const eventStoreService = await getTestEventStoreService();
  const storedEvent = await AccountCreated.receiver(eventStoreService, {
    payload: {
      userId,
      accountId
    }
  });
  const createdAccount = await AccountQuery.getAccountById(storedEvent.payload.accountId);
  if (!createdAccount) {
    throw new Error('Account Not found');
  }
  expect(createdAccount.userId).toBe(userId);
  expect(createdAccount.id).toBe(storedEvent.payload.accountId);
  expect(createdAccount.created.toISOString()).toBe(storedEvent.created.toISOString());
  expect(createdAccount.active).toBe(true);
});
