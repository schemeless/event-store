import { v4 as uuid } from 'uuid';
import { BaseEvent, EventFlow } from '@schemeless/event-store';
import { AccountCreated } from './Account.created.event';

interface Payload {
  userId: string;
}

export const AccountCreationRequested: EventFlow<Payload> = {
  domain: 'account',
  type: 'creationRequested',
  description: 'request to create an account',

  samplePayload: {
    userId: '<UserID>'
  },

  async consequentEventsCreator(event): Promise<[BaseEvent<typeof AccountCreated.samplePayload>]> {
    const { userId } = event.payload;

    return [
      {
        domain: AccountCreated.domain,
        type: AccountCreated.type,
        payload: {
          userId,
          accountId: uuid()
        }
      }
    ];
  },

  // validator: async function(event) {
  // todo check if user valid
  // },

  receiver: (eventStoreService, eventInputArgs) =>
    eventStoreService.receiveEventInput(AccountCreationRequested.domain, AccountCreationRequested.type, eventInputArgs)
};
