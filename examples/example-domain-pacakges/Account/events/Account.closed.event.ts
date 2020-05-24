import { EventFlow } from '@schemeless/event-store';
import { getAccountEntityRepository } from '../Account.entity.repository';
import { AccountPackage } from '../index';

interface Payload {
  accountId: string;
  userId: string;
}

export const AccountClosed: EventFlow<Payload> = {
  domain: 'account',
  type: 'closed',

  samplePayload: {
    accountId: '<UUID>',
    userId: '<UserID>'
  },

  validator: async event => {
    const account = await AccountPackage.Query.getAccountById(event.payload.accountId);
    if (!account) {
      return new Error(`Accounts is not exist - ${event.payload.accountId}`);
    }
    if (account.userId != event.payload.userId) {
      return new Error(`You are not authorized to close the account ${event.payload.accountId}`);
    }
    const tokenBalanceEntities = await AccountPackage.Query.getAllAccountBalance(event.payload.accountId);

    const hasBalanceAccounts = tokenBalanceEntities.filter(accountEntity => accountEntity.balance != 0);

    if (hasBalanceAccounts.length > 0) {
      return new Error(
        `Account ${event.payload.accountId} ${hasBalanceAccounts
          .map(b => b.tokenId)
          .join(',')} balance is not 0, it can not be closed.`
      );
    }
  },

  executor: async event => {
    const repo = await getAccountEntityRepository();
    const { accountId } = event.payload;
    const accountEntity = await AccountPackage.Query.getAccountById(accountId);
    if (!accountEntity) {
      throw new Error(`Accounts is not exist - ${event.payload.accountId}`);
    }
    accountEntity.active = false;
    await repo.save(accountEntity);
  },

  receiver: (eventStoreService, eventInputArgs) =>
    eventStoreService.receiveEventInput(AccountClosed.domain, AccountClosed.type, eventInputArgs)
};
