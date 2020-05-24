import { BaseEvent, EventFlow } from '@schemeless/event-store';
import { AccountCredit } from './Account.credit.event';

interface Payload {
  primaryAccountId: string;
  primaryTokenId: string; // XQB
  primaryTokenAmount: number;

  secondaryAccountId: string;
  secondaryTokenId: string; // Token
  secondaryTokenAmount: number;
}

export const AccountTraded: EventFlow<Payload> = {
  domain: 'account',
  type: 'traded',

  samplePayload: {
    primaryAccountId: 'primaryAccountId',
    primaryTokenId: 'XQB', // XQB
    primaryTokenAmount: 10,

    secondaryAccountId: 'secondaryAccountId',
    secondaryTokenId: 'token', // Token
    secondaryTokenAmount: 100
  },

  consequentEventsCreator: async (
    parentEvent
  ): Promise<[BaseEvent<typeof AccountCredit.samplePayload>, BaseEvent<typeof AccountCredit.samplePayload>]> => {
    const {
      primaryAccountId,
      primaryTokenAmount,
      primaryTokenId,
      secondaryAccountId,
      secondaryTokenAmount,
      secondaryTokenId
    } = parentEvent.payload;

    const depositPrimaryEvent = {
      domain: AccountCredit.domain,
      type: AccountCredit.type,
      payload: {
        accountId: primaryAccountId,
        tokenId: secondaryTokenId,
        amount: secondaryTokenAmount
      }
    };

    const depositSecondaryEvent = {
      domain: AccountCredit.domain,
      type: AccountCredit.type,
      payload: {
        accountId: secondaryAccountId,
        tokenId: primaryTokenId,
        amount: primaryTokenAmount
      }
    };

    return [depositPrimaryEvent, depositSecondaryEvent];
  },

  receiver: (eventStoreService, eventInputArgs) =>
    eventStoreService.receiveEventInput(AccountTraded.domain, AccountTraded.type, eventInputArgs)
};
