import type { Observer } from '@schemeless/event-store-core';
import type { MemoryProjectionStore } from './projectionStore';

export const createCashAccountObservers = (views: MemoryProjectionStore): Observer[] => [
  {
    name: 'balance-view',
    filters: [
      { domain: 'cashAccount', type: 'CashAccountOpened' },
      { domain: 'cashAccount', type: 'CashDeposited' },
      { domain: 'cashAccount', type: 'CashWithdrawn' },
    ],
    priority: 1,
    apply: (event: any) => {
      const accountId = event.identifier ?? event.payload.accountId;
      const current = views.balances.get(accountId)?.balance ?? 0;
      const delta =
          event.type === 'CashAccountOpened'
            ? event.payload.openingBalance
            : event.type === 'CashDeposited'
              ? event.payload.amount
            : -event.payload.amount;
      views.balances.set(accountId, { accountId, balance: current + delta });
    },
  },
  {
    name: 'summary-view',
    filters: [
      { domain: 'cashAccount', type: 'CashAccountOpened' },
      { domain: 'cashAccount', type: 'CashDeposited' },
      { domain: 'cashAccount', type: 'CashWithdrawn' },
    ],
    priority: 2,
    apply: (event: any) => {
      const accountId = event.identifier ?? event.payload.accountId;
      const current = views.summaries.get(accountId);
      const balance = views.balances.get(accountId)?.balance ?? current?.balance ?? 0;
      views.summaries.set(accountId, {
        accountId,
        ownerName: event.type === 'CashAccountOpened' ? event.payload.ownerName : current?.ownerName,
        balance,
        status: 'open',
      });
    },
  },
];
