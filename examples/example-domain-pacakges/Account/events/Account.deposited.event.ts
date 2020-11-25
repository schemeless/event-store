import { getAccountEntityRepository, getAccountTokenBalanceEntityRepository } from '../Account.entity.repository';
import { AccountPackage } from '../index';
import type { BaseEvent, EventFlow } from '@schemeless/event-store';
import { config } from '../../../service/src/config';
import { AccountCredit } from './Account.credit.event';

interface Payload {
  accountId: string;
  tokenId: string;
  amount: number;
  reason: 'attendance' | 'topUp';
}

export const AccountDeposited: EventFlow<Payload> = {
  domain: 'account',
  type: 'deposited',
  description: 'attendance or topup to the account',

  samplePayload: {
    accountId: 'AccountId',
    tokenId: 'tokenId',
    amount: 10,
    reason: 'attendance',
  },

  validator: async (event) => {
    if (event.payload.amount <= 0) {
      return new Error(`Deposit amount should be > 0`);
    }

    if (event.payload.tokenId !== config.baseToken) {
      return new Error(`Can only deposit to baseToken`);
    }

    const account = await AccountPackage.Query.getAccountById(event.payload.accountId);

    if (!account) {
      return new Error(`Account is not exist - ${event.payload.accountId}`);
    }
  },

  consequentEventsCreator: async (parentEvent): Promise<[BaseEvent<typeof AccountCredit.samplePayload>]> => {
    const creditEvent = {
      domain: AccountCredit.domain,
      type: AccountCredit.type,
      payload: {
        accountId: parentEvent.payload.accountId,
        tokenId: parentEvent.payload.tokenId,
        amount: parentEvent.payload.amount,
      },
    };

    return [creditEvent];
  },

  executor: async (event) => {
    const repo = await getAccountEntityRepository();
    const { accountId, tokenId, amount, reason } = event.payload;
    if (reason !== 'attendance') {
      throw new Error(`AccountDeposited: not implemented`);
    }
    const currentAccount = await AccountPackage.Query.getAccountById(accountId);
    if (!currentAccount) {
      throw new Error(`Token Account ${accountId}:${tokenId} not found`);
    }

    currentAccount.lastAttendanceUpdated = event.created;
    currentAccount.updated = event.created;

    await repo.save(currentAccount);
  },

  receiver: (eventStoreService, eventInputArgs) =>
    eventStoreService.receiveEventInput(AccountDeposited.domain, AccountDeposited.type, eventInputArgs),
};
