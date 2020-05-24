import { AccountQuery } from '../Account.query';
import { getTestEventStoreService } from '../../../service/src/utils/testHelpers';
import { AccountCreationRequested } from './Account.creationRequested.event';

const userId = 'userId:123';

test('process validated event', async () => {
  const eventStoreService = await getTestEventStoreService();
  const accountSumBeforeCreated = (await AccountQuery.getUserAccounts(userId)).length;

  const storedEvent = await AccountCreationRequested.receiver(eventStoreService, {
    payload: {
      userId
    }
  });

  const accountSumAfterCreated = (await AccountQuery.getUserAccounts(userId)).length;

  expect(accountSumAfterCreated - accountSumBeforeCreated).toEqual(1);
});
