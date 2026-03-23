import type { AggregateDefinition } from '@schemeless/event-store-aggregate';
import type { CashAccountCommand, CashAccountEvent, CashAccountState } from './types';

export const CashAccountAggregate: AggregateDefinition<CashAccountCommand, CashAccountEvent, CashAccountState> = {
  name: 'CashAccount',
  domain: 'cashAccount',
  getIdentifier: (command: CashAccountCommand) => command.accountId,
  initialState: { opened: false, balance: 0 },
  evolve: (state, event) => {
    switch (event.type) {
      case 'CashAccountOpened':
        return { opened: true, ownerName: event.payload.ownerName, balance: event.payload.openingBalance };
      case 'CashDeposited':
        return { ...state, balance: state.balance + event.payload.amount };
      case 'CashWithdrawn':
        return { ...state, balance: state.balance - event.payload.amount };
      default:
        return state;
    }
  },
  precondition: (command, state) => {
    if (command.kind === 'OpenCashAccount' && state.opened) {
      throw new Error('account already opened');
    }
    if (command.kind === 'WithdrawCash' && state.balance < command.amount) {
      throw new Error('insufficient funds');
    }
  },
  decide: (command) => {
    switch (command.kind) {
      case 'OpenCashAccount':
        return [
          {
            id: `open-${command.accountId}`,
            domain: 'cashAccount',
            type: 'CashAccountOpened',
            identifier: command.accountId,
            payload: {
              accountId: command.accountId,
              ownerName: command.ownerName,
              openingBalance: command.openingBalance,
            },
            created: new Date(),
          },
        ];
      case 'DepositCash':
        return [
          {
            id: `dep-${command.accountId}-${command.amount}-${Date.now()}`,
            domain: 'cashAccount',
            type: 'CashDeposited',
            identifier: command.accountId,
            payload: { accountId: command.accountId, amount: command.amount },
            created: new Date(),
          },
        ];
      case 'WithdrawCash':
        return [
          {
            id: `wd-${command.accountId}-${command.amount}-${Date.now()}`,
            domain: 'cashAccount',
            type: 'CashWithdrawn',
            identifier: command.accountId,
            payload: { accountId: command.accountId, amount: command.amount },
            created: new Date(),
          },
        ];
    }
  },
};
