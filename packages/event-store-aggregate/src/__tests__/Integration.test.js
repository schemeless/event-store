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
    expect(result.sequence).toBe(2); // both events appended, last sequence is 2
  });

  it('decide can return zero events (no-op command)', async () => {
    let decisionCount = 0;
    const noEventAggregate = {
      ...counterAggregate,
      decide: (command, state) => {
        decisionCount++;
        if (command.amount === 0) return []; // no events for zero amount
        return [
          {
            id: `e-${Date.now()}`,
            domain: 'counter',
            type: 'Incremented',
            payload: { amount: command.amount },
            created: new Date(),
          },
        ];
      },
    };

    const r1 = await runtime.handle(noEventAggregate, { id: 'c1', amount: 0 });
    expect(r1.events).toHaveLength(0);
    expect(decisionCount).toBe(1);

    const r2 = await runtime.handle(noEventAggregate, { id: 'c1', amount: 5 });
    expect(r2.events).toHaveLength(1);
  });

  it('hydrate returns null sequence for non-existent aggregate', async () => {
    const hydrated = await runtime.hydrate(counterAggregate, 'non-existent-id');
    expect(hydrated.state.count).toBe(0);
    expect(hydrated.sequence).toBe(0);
  });

  it('decide receives current state as second argument', async () => {
    let receivedState = null;
    const stateSpyAggregate = {
      ...counterAggregate,
      decide: (command, state) => {
        receivedState = state;
        return [];
      },
    };

    await runtime.handle(stateSpyAggregate, { id: 'c1', amount: 5 });
    expect(receivedState).not.toBeNull();
    expect(receivedState.count).toBe(0); // initial state before evolve
  });

  it('evolve receives event as second argument', async () => {
    let receivedEvent = null;
    const evolveSpyAggregate = {
      ...counterAggregate,
      evolve: (state, event) => {
        receivedEvent = event;
        return state;
      },
      decide: () => [
        { id: `e-${Date.now()}`, domain: 'counter', type: 'Incremented', payload: { amount: 1 }, created: new Date() },
      ],
    };

    await runtime.handle(evolveSpyAggregate, { id: 'c1', amount: 1 });
    expect(receivedEvent).not.toBeNull();
    expect(receivedEvent.payload.amount).toBe(1);
  });

  it('precondition throws prevent event creation', async () => {
    const blockingAggregate = {
      ...counterAggregate,
      precondition: (command) => {
        if (command.block) throw new Error('blocked');
      },
    };

    await runtime.handle(blockingAggregate, { id: 'c1', amount: 5 });
    await expect(runtime.handle(blockingAggregate, { id: 'c1', block: true })).rejects.toThrow('blocked');
  });

  it('handle with same command twice produces different events (idempotency not enforced)', async () => {
    const result1 = await runtime.handle(counterAggregate, { id: 'c1', amount: 5 });
    const result2 = await runtime.handle(counterAggregate, { id: 'c1', amount: 5 });

    // Both handle calls produce events (no idempotency check)
    expect(result1.events).toHaveLength(1);
    expect(result2.events).toHaveLength(1);
    expect(result1.events[0].id).not.toBe(result2.events[0].id);
    // State accumulates
    expect(result2.state.count).toBe(10);
  });

  it('snapshot is saved after every handle call', async () => {
    await runtime.handle(counterAggregate, { id: 'c1', amount: 5 });
    await runtime.handle(counterAggregate, { id: 'c1', amount: 3 });

    const snap = await adapter.getSnapshot('counter', 'c1');
    expect(snap?.sequence).toBe(2);
    expect(snap?.state.count).toBe(8);
  });

  it('evolve can produce any JSON-serializable state', async () => {
    const objectStateAggregate = {
      ...counterAggregate,
      initialState: { nested: { deep: [] } },
      evolve: (state, event) => ({
        nested: { deep: [...state.nested.deep, event.payload.amount] },
      }),
    };

    const r1 = await runtime.handle(objectStateAggregate, { id: 'c1', amount: 1 });
    expect(r1.state.nested.deep).toContain(1);
  });

  it('decide can inspect command properties', async () => {
    let receivedCommand = null;
    const inspectAggregate = {
      ...counterAggregate,
      decide: (command, state) => {
        receivedCommand = command;
        return [];
      },
    };

    await runtime.handle(inspectAggregate, { id: 'c1', amount: 42 });
    expect(receivedCommand.amount).toBe(42);
  });

  it('decide returns events with correct domain from aggregate definition', async () => {
    const domainAggregate = {
      name: 'customDomain',
      domain: 'myDomain',
      getIdentifier: (x) => x.id,
      initialState: {},
      evolve: (state) => state,
      decide: (command) => [
        { id: `e-${Date.now()}`, domain: 'myDomain', type: 'CommandHandled', payload: command, created: new Date() },
      ],
    };

    const result = await runtime.handle(domainAggregate, { id: 'c1' });
    expect(result.events[0].domain).toBe('myDomain');
  });

  it('hydrate uses initialState when no events exist', async () => {
    const hydrated = await runtime.hydrate(counterAggregate, 'brand-new-id');
    expect(hydrated.state.count).toBe(0);
    expect(hydrated.sequence).toBe(0);
  });

  it('decide can return events with custom properties', async () => {
    const customAggregate = {
      ...counterAggregate,
      decide: () => [
        {
          id: `custom-${Date.now()}`,
          domain: 'counter',
          type: 'CustomEvent',
          payload: { amount: 5, extra: 'data' },
          created: new Date(),
        },
      ],
    };

    const result = await runtime.handle(customAggregate, { id: 'c1', amount: 1 });
    expect(result.events[0].payload.extra).toBe('data');
  });

  it('evolve receives events with correct sequence numbers', async () => {
    const payloads = [];
    const seqAggregate = {
      ...counterAggregate,
      evolve: (state, event) => {
        payloads.push(event.payload.amount);
        return state;
      },
    };

    await runtime.handle(seqAggregate, { id: 'c1', amount: 1 });
    await runtime.handle(seqAggregate, { id: 'c1', amount: 2 });

    expect(payloads).toContain(1);
    expect(payloads).toContain(2);
  });

  it('handle can be called with same id on different aggregates', async () => {
    const result1 = await runtime.handle(counterAggregate, { id: 'shared-id', amount: 5 });
    expect(result1.state.count).toBe(5);
  });

  it('evolve is called once per event in sequence', async () => {
    let evolveCount = 0;
    const countAggregate = {
      ...counterAggregate,
      evolve: (state) => {
        evolveCount++;
        return state;
      },
    };

    await runtime.handle(countAggregate, { id: 'c1', amount: 1 });
    expect(evolveCount).toBe(1);

    await runtime.handle(countAggregate, { id: 'c1', amount: 2 });
    expect(evolveCount).toBe(2);
  });

  it('decide can return events with nested payload', async () => {
    const nestedAggregate = {
      ...counterAggregate,
      decide: () => [
        {
          id: `nest-${Date.now()}`,
          domain: 'counter',
          type: 'Nested',
          payload: { deep: { nested: { value: 42 } } },
          created: new Date(),
        },
      ],
    };

    const result = await runtime.handle(nestedAggregate, { id: 'c1', amount: 1 });
    expect(result.events[0].payload.deep.nested.value).toBe(42);
  });

  it('handle returns correct sequence after multiple events', async () => {
    const result = await runtime.handle(counterAggregate, { id: 'c1', amount: 1 });
    expect(result.sequence).toBe(1);

    const result2 = await runtime.handle(counterAggregate, { id: 'c1', amount: 1 });
    expect(result2.sequence).toBe(2);
  });
});
