const { makeAggregateRuntime } = require('../../event-store-aggregate/dist/index.js');
const { makeEventStoreCore } = require('../../event-store-core/dist/index.js');
const { StreamConcurrencyError } = require('../../event-store-types/dist/index.js');
const {
  MemoryEventStore,
  CashAccountAggregate,
  MemoryProjectionStore,
  createCashAccountObservers,
} = require('../dist/index.js');

describe('cash account reference aggregate', () => {
  it('runs the full command + rebuild + snapshot + OCC flow', async () => {
    const adapter = new MemoryEventStore();
    const runtime = makeAggregateRuntime(adapter);
    const core = makeEventStoreCore(adapter);
    const views = new MemoryProjectionStore();
    const observers = createCashAccountObservers(views);
    const resetViews = async () => views.reset();

    await runtime.handle(CashAccountAggregate, {
      kind: 'OpenCashAccount',
      accountId: 'acct-1',
      ownerName: 'Ada',
      openingBalance: 100,
    });
    await runtime.handle(CashAccountAggregate, {
      kind: 'DepositCash',
      accountId: 'acct-1',
      amount: 50,
    });
    await runtime.handle(CashAccountAggregate, {
      kind: 'WithdrawCash',
      accountId: 'acct-1',
      amount: 30,
    });

    await expect(
      runtime.handle(CashAccountAggregate, {
        kind: 'WithdrawCash',
        accountId: 'acct-1',
        amount: 500,
      })
    ).rejects.toThrow('insufficient funds');

    await core.rebuildReadModels({ observers, reset: resetViews });
    expect(views.balances.get('acct-1').balance).toBe(120);
    expect(views.summaries.get('acct-1').ownerName).toBe('Ada');

    views.reset();
    expect(views.balances.size).toBe(0);

    await runtime.handle(CashAccountAggregate, {
      kind: 'DepositCash',
      accountId: 'acct-1',
      amount: 10,
    });
    expect(views.balances.size).toBe(0);

    await core.rebuildReadModels({ observers, reset: resetViews });
    expect(views.balances.get('acct-1').balance).toBe(130);

    await adapter.saveSnapshot({
      domain: 'cashAccount',
      identifier: 'acct-1',
      state: { opened: true, ownerName: 'Ada', balance: 120 },
      sequence: 3,
      created: new Date(),
    });

    const hydrated = await runtime.hydrate(CashAccountAggregate, 'acct-1');
    expect(hydrated.state.balance).toBe(130);
    expect(hydrated.sequence).toBe(4);

    const stale = await runtime.hydrate(CashAccountAggregate, 'acct-1');
    const [first, second] = await Promise.allSettled([
      adapter.appendToStream(
        [
          {
            id: 'conflict-a',
            domain: 'cashAccount',
            type: 'CashDeposited',
            identifier: 'acct-1',
            payload: { accountId: 'acct-1', amount: 5 },
            created: new Date(),
          },
        ],
        stale.sequence
      ),
      adapter.appendToStream(
        [
          {
            id: 'conflict-b',
            domain: 'cashAccount',
            type: 'CashDeposited',
            identifier: 'acct-1',
            payload: { accountId: 'acct-1', amount: 5 },
            created: new Date(),
          },
        ],
        stale.sequence
      ),
    ]);

    expect([first.status, second.status]).toContain('fulfilled');
    expect([first.status, second.status]).toContain('rejected');
  });

  it('throws a StreamConcurrencyError for OCC conflicts', async () => {
    const adapter = new MemoryEventStore();

    await adapter.appendToStream(
      [
        {
          id: 'seed',
          domain: 'cashAccount',
          type: 'CashDeposited',
          identifier: 'acct-1',
          payload: { accountId: 'acct-1', amount: 10 },
          created: new Date(),
        },
      ],
      0
    );

    await expect(
      adapter.appendToStream(
        [
          {
            id: 'conflict',
            domain: 'cashAccount',
            type: 'CashDeposited',
            identifier: 'acct-1',
            payload: { accountId: 'acct-1', amount: 5 },
            created: new Date(),
          },
        ],
        0
      )
    ).rejects.toBeInstanceOf(StreamConcurrencyError);
  });
});
