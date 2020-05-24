import { EventFlow } from '@schemeless/event-store';
import * as eventFlows from './events';
import { AccountEntity, AccountTokenBalanceEntity } from './Account.entity';
import { AccountQuery } from './Account.query';

const eventFlowList: EventFlow<any>[] = [
  eventFlows.AccountCreated,
  eventFlows.AccountCreationRequested,
  eventFlows.AccountCredit,
  eventFlows.AccountDebit,
  eventFlows.AccountTransferred,
  eventFlows.AccountClosed,
  eventFlows.AccountTraded,
  eventFlows.AccountDeposited
];

export const AccountPackage = {
  Query: AccountQuery,
  Entities: [AccountTokenBalanceEntity, AccountEntity],
  EventFlows: eventFlows,
  EventFlowList: eventFlowList
};
