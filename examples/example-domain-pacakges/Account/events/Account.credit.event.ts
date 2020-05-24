import { EventFlow } from '@schemeless/event-store';
import { getAccountTokenBalanceEntityRepository } from '../Account.entity.repository';
import { AccountTokenBalanceEntity } from '../Account.entity';
import { AccountPackage } from '../index';
import { logger } from '../../../service/src/managers/pino';

interface Payload {
  accountId: string;
  tokenId: string;
  amount: number;
}

export const AccountCredit: EventFlow<Payload> = {
  domain: 'account',
  type: 'credit',
  description: 'to put money into an account',

  samplePayload: {
    accountId: 'accountId',
    tokenId: 'tokenId',
    amount: 10
  },

  validator: async event => {
    if (event.payload.amount <= 0) {
      return new Error(`Deposit amount should be > 0`);
    }
    const account = await AccountPackage.Query.getAccountById(event.payload.accountId);
    if (!account) {
      return new Error(`Account is not exist - ${event.payload.accountId}`);
    }
  },

  executor: async event => {
    const accountTokenBalanceEntityRepository = await getAccountTokenBalanceEntityRepository();
    const { accountId, tokenId, amount } = event.payload;
    let tokenBalanceEntity = await AccountPackage.Query.getAccountBalanceByTokenId(accountId, tokenId);

    if (!tokenBalanceEntity) {
      tokenBalanceEntity = new AccountTokenBalanceEntity();
      const account = await AccountPackage.Query.getAccountById(accountId);
      if (!account) {
        throw new Error(`account ${accountId} not found`);
      }
      tokenBalanceEntity.account = account;
      tokenBalanceEntity.tokenId = tokenId;
      tokenBalanceEntity.balance = amount;
      tokenBalanceEntity.created = event.created;
      tokenBalanceEntity.updated = event.created;
      logger.info(
        `creating new token balance for account: ${accountId} with tokenId ${tokenId} with balance ${amount}`
      );
    } else {
      tokenBalanceEntity.balance += amount;
      tokenBalanceEntity.updated = event.created;
    }
    await accountTokenBalanceEntityRepository.save(tokenBalanceEntity);
    logger.info(`Account deposit finished: Account ${accountId} ${tokenId}, new balance ${tokenBalanceEntity.balance}`);
  },

  receiver: (eventStoreService, eventInputArgs) =>
    eventStoreService.receiveEventInput(AccountCredit.domain, AccountCredit.type, eventInputArgs)
};
