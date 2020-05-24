import { getAccountTokenBalanceEntityRepository } from '../Account.entity.repository';
import { AccountPackage } from '../index';
import { EventFlow } from '@schemeless/event-store';
import { logger } from '../../../service/src/managers/pino';

interface Payload {
  accountId: string;
  tokenId: string;
  amount: number;
}

export const AccountDebit: EventFlow<Payload> = {
  domain: 'account',
  type: 'debit',
  description: 'to take or pay money out of an account',

  samplePayload: {
    accountId: 'AccountId',
    tokenId: 'tokenId',
    amount: 10
  },

  validator: async event => {
    if (event.payload.amount <= 0) {
      return new Error(`Withdraw amount should be > 0`);
    }
    const account = await AccountPackage.Query.getAccountById(event.payload.accountId);

    if (!account) {
      return new Error(`Account is not exist - ${event.payload.accountId}`);
    }

    const tokenBalanceAccount = await AccountPackage.Query.getAccountBalanceByTokenId(
      event.payload.accountId,
      event.payload.tokenId
    );

    if (!tokenBalanceAccount) {
      return new Error(`Account never trade with token ${event.payload.accountId}: ${event.payload.tokenId}`);
    }

    if (tokenBalanceAccount.balance < event.payload.amount) {
      return new Error(
        `Account balance is too low - ${event.payload.accountId}: ${event.payload.tokenId} : ${tokenBalanceAccount?.balance} - ${event.payload.amount}`
      );
    }
  },

  executor: async event => {
    const repo = await getAccountTokenBalanceEntityRepository();
    const { accountId, tokenId, amount } = event.payload;
    const currentAccount = await AccountPackage.Query.getAccountBalanceByTokenId(accountId, tokenId);
    if (!currentAccount) {
      throw new Error(`Token Account ${accountId}:${tokenId} not found`);
    }
    currentAccount.balance -= amount;
    currentAccount.updated = event.created;
    await repo.save(currentAccount);
    logger.info(
      `Account ${accountId} tokenId ${currentAccount.tokenId} debit from ${currentAccount.balance + amount} to ${
        currentAccount.balance
      }`
    );
  },

  receiver: (eventStoreService, eventInputArgs) =>
    eventStoreService.receiveEventInput(AccountDebit.domain, AccountDebit.type, eventInputArgs)
};
