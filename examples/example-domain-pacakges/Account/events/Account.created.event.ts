import { EventFlow } from '@schemeless/event-store';
import { AccountQuery } from '../Account.query';
import { getAccountEntityRepository } from '../Account.entity.repository';
import { AccountEntity } from '../Account.entity';
import { logger } from '../../../service/src/managers/pino';

interface Payload {
  userId: string;
  accountId: string;
}

export const AccountCreated: EventFlow<Payload> = {
  domain: 'account',
  type: 'created',

  samplePayload: {
    userId: '<UserId>',
    accountId: '<AccountId>'
  },

  validator: async function(event) {
    // todo check if user valid
    const account = await AccountQuery.getAccountById(event.payload.accountId);
    if (account) {
      return new Error(`Account is already exist - ${event.payload.accountId}`);
    }
  },

  executor: async function(event) {
    const repo = await getAccountEntityRepository();
    const newAccount = new AccountEntity();
    const { accountId, userId } = event.payload;
    newAccount.id = accountId;
    newAccount.userId = userId;
    newAccount.created = event.created;
    newAccount.updated = event.created;
    await repo.save(newAccount);
    logger.info(`Account created: ${newAccount.id}`);
  },

  receiver: (eventStoreService, eventInputArgs) =>
    eventStoreService.receiveEventInput(AccountCreated.domain, AccountCreated.type, eventInputArgs)
};
