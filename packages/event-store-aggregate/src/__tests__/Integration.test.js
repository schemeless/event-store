const { makeAggregateRuntime } = require('../../dist/index.js');
const { PgEventStoreAdapter } = require('@schemeless/event-store-adapter-pg');

const connectionOptions = {
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'event_store_test',
};

let eventCounter = 0;
const counterAggregate = {
  name: 'counter',
  domain: 'counter',
  getIdentifier: (x) => x.id,
  initialState: { count: 0 },
  evolve: (state, event) => ({ count: state.count + event.payload.amount }),
  decide: (command, state) => [
    {
      id: `e-${Date.now()}-${++eventCounter}`,
      domain: 'counter',
      type: 'Incremented',
      payload: { amount: command.amount },
      created: new Date(),
    },
  ],
};

describe('Aggregate + PG Integration', () => {
  let adapter;
  let runtime;

  beforeAll(async () => {
    adapter = new PgEventStoreAdapter(connectionOptions);
    await adapter.init();
    runtime = makeAggregateRuntime(adapter);
  });

  afterAll(async () => {
    await adapter.close();
  });

  beforeEach(async () => {
    await adapter.reset();
    eventCounter = 0;
  });

  it('handle → persist → hydrate round-trip', async () => {
    const result = await runtime.handle(counterAggregate, { id: 'c1', amount: 5 });
    expect(result.state.count).toBe(5);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].payload.amount).toBe(5);
    expect(result.sequence).toBe(1);

    const hydrated = await runtime.hydrate(counterAggregate, 'c1');
    expect(hydrated.state.count).toBe(5);
    expect(hydrated.sequence).toBe(1);
  });

  it('multiple sequential handles maintain correct state', async () => {
    const r1 = await runtime.handle(counterAggregate, { id: 'c1', amount: 5 });
    expect(r1.state.count).toBe(5);
    expect(r1.sequence).toBe(1);

    const r2 = await runtime.handle(counterAggregate, { id: 'c1', amount: 3 });
    expect(r2.state.count).toBe(8);
    expect(r2.sequence).toBe(2);

    const r3 = await runtime.handle(counterAggregate, { id: 'c1', amount: 10 });
    expect(r3.state.count).toBe(18);
    expect(r3.sequence).toBe(3);
  });

  it('snapshot is saved after handle', async () => {
    await runtime.handle(counterAggregate, { id: 'c1', amount: 5 });

    const snap = await adapter.getSnapshot('counter', 'c1');
    expect(snap).not.toBeNull();
    expect(snap.state).toEqual({ count: 5 });
    expect(snap.sequence).toBe(1);
  });

  it('snapshot is used for hydration (hydrate reads from snapshot)', async () => {
    await runtime.handle(counterAggregate, { id: 'c1', amount: 5 });
    await runtime.handle(counterAggregate, { id: 'c1', amount: 3 });

    const snapBefore = await adapter.getSnapshot('counter', 'c1');
    expect(snapBefore.state.count).toBe(8);
    expect(snapBefore.sequence).toBe(2);

    // New runtime instance simulates app restart
    const newRuntime = makeAggregateRuntime(adapter);
    const hydrated = await newRuntime.hydrate(counterAggregate, 'c1');
    expect(hydrated.state.count).toBe(8);
    expect(hydrated.sequence).toBe(2);
  });

  it('different aggregates are isolated', async () => {
    await runtime.handle(counterAggregate, { id: 'c1', amount: 5 });
    await runtime.handle(counterAggregate, { id: 'c2', amount: 10 });

    const h1 = await runtime.hydrate(counterAggregate, 'c1');
    const h2 = await runtime.hydrate(counterAggregate, 'c2');

    expect(h1.state.count).toBe(5);
    expect(h2.state.count).toBe(10);
  });

  it('precondition blocks handle when condition is not met', async () => {
    const aggregateWithPrecondition = {
      ...counterAggregate,
      precondition: (command, state) => {
        if (command.amount > 100) {
          throw new Error('Amount too large');
        }
      },
    };

    await runtime.handle(aggregateWithPrecondition, { id: 'c1', amount: 50 });

    await expect(runtime.handle(aggregateWithPrecondition, { id: 'c1', amount: 200 })).rejects.toThrow(
      'Amount too large'
    );
  });

  it('validateEvent runs for each produced event', async () => {
    const validateCalls = [];
    const aggregateWithValidation = {
      ...counterAggregate,
      validateEvent: (event, state) => {
        validateCalls.push({ event, state });
      },
    };

    await runtime.handle(aggregateWithValidation, { id: 'c1', amount: 5 });

    expect(validateCalls).toHaveLength(1);
    expect(validateCalls[0].event.payload.amount).toBe(5);
    expect(validateCalls[0].state.count).toBe(0); // state before evolve
  });

  it('decide can return multiple events', async () => {
    let multiCounter = 0;
    const multiEventAggregate = {
      ...counterAggregate,
      decide: (command) => [
        {
          id: `e-multi-${Date.now()}-${++multiCounter}`,
          domain: 'counter',
          type: 'Incremented',
          payload: { amount: command.amount },
          created: new Date(),
        },
        {
          id: `e-multi-${Date.now()}-${++multiCounter}`,
          domain: 'counter',
          type: 'Incremented',
          payload: { amount: command.amount * 2 },
          created: new Date(),
        },
      ],
    };

    const result = await runtime.handle(multiEventAggregate, { id: 'c1', amount: 5 });
    expect(result.events).toHaveLength(2);
    expect(result.state.count).toBe(15); // 5 + 10
    expect(result.sequence).toBe(1);
  });
});
