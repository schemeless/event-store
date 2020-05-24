import { BaseEvent, EventFlow } from '@schemeless/event-store';
import { AccountDebit } from './Account.debit.event';
import { AccountCredit } from './Account.credit.event';

interface Payload {
  fromAccountId: string;
  toAccountId: string;
  tokenId: string;
  amount: number;
}

export const AccountTransferred: EventFlow<Payload> = {
  domain: 'account',
  type: 'transferred',
  description: 'transfer money from one account to another account',

  samplePayload: {
    fromAccountId: 'accountId1',
    toAccountId: 'accountId2',
    tokenId: 'tokenId',
    amount: 10
  },

  validator: async event => {
    if (event.payload.fromAccountId === event.payload.toAccountId) {
      return new Error("AccountTransferred: from and to can't be same account: " + event.payload.fromAccountId);
    }

    if (event.payload.amount <= 0) {
      return new Error(`AccountTransferred: amount < 0, wrong way`);
    }
  },

  consequentEventsCreator: async (
    parentEvent
  ): Promise<[BaseEvent<typeof AccountDebit.samplePayload>, BaseEvent<typeof AccountCredit.samplePayload>]> => {
    const { fromAccountId, toAccountId, tokenId, amount } = parentEvent.payload;

    const debitEvent: BaseEvent<typeof AccountDebit.samplePayload> = {
      domain: AccountDebit.domain,
      type: AccountDebit.type,
      payload: {
        accountId: fromAccountId,
        tokenId,
        amount
      }
    };

    const creditEvent: BaseEvent<typeof AccountCredit.samplePayload> = {
      domain: AccountCredit.domain,
      type: AccountCredit.type,
      payload: {
        accountId: toAccountId,
        tokenId,
        amount
      }
    };

    return [debitEvent, creditEvent];
  },

  receiver: (eventStoreService, eventInputArgs) =>
    eventStoreService.receiveEventInput(AccountTransferred.domain, AccountTransferred.type, eventInputArgs)
};
