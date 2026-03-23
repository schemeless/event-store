const { makeAggregateRuntime } = require('../dist/index.js');
const { StreamConcurrencyError } = require('../dist/types.js');

const adapter = (overrides = {}) => ({
  getStreamEvents: jest.fn().mockResolvedValue([]),
  appendToStream: jest.fn().mockResolvedValue({ nextVersion: 1 }),
  getSnapshot: jest.fn().mockResolvedValue(null),
  ...overrides,
});

describe('aggregate runtime', () => {
  it('hydrates from initial state when stream is empty', async () => {
    const rt = makeAggregateRuntime(adapter());
    const aggregate = {
      name: 'counter',
      domain: 'counter',
      getIdentifier: (x) => x.id,
      initialState: { count: 0 },
      evolve: (state, event) => ({ count: state.count + event.payload.amount }),
      decide: () => [],
    };

    const result = await rt.hydrate(aggregate, 'c1');
    expect(result.state).toEqual({ count: 0 });
  });

  it('hydrates from snapshot plus trailing events', async () => {
    const rt = makeAggregateRuntime(
      adapter({
        getSnapshot: jest.fn().mockResolvedValue({
          domain: 'counter',
          identifier: 'c1',
          state: { count: 10 },
          sequence: 2,
          created: new Date(),
        }),
        getStreamEvents: jest.fn().mockResolvedValue([
          { id: 'e3', domain: 'counter', type: 'added', payload: { amount: 2 }, created: new Date(), sequence: 3 },
        ]),
      })
    );
    const aggregate = {
      name: 'counter',
      domain: 'counter',
      getIdentifier: (x) => x.id,
      initialState: { count: 0 },
      evolve: (state, event) => ({ count: state.count + event.payload.amount }),
      decide: () => [],
    };

    const result = await rt.hydrate(aggregate, 'c1');
    expect(result.sequence).toBe(3);
    expect(result.state).toEqual({ count: 12 });
  });

  it('precondition failure blocks handle', async () => {
    const rt = makeAggregateRuntime(adapter());
    const aggregate = {
      name: 'counter',
      domain: 'counter',
      getIdentifier: (x) => x.id,
      initialState: { count: 0 },
      evolve: (state, event) => state,
      precondition: () => {
        throw new Error('blocked');
      },
      decide: () => [],
    };

    await expect(rt.handle(aggregate, { id: 'c1' })).rejects.toThrow('blocked');
  });

  it('decide can return multiple events and evolve state across them', async () => {
    const rt = makeAggregateRuntime(adapter());
    const aggregate = {
      name: 'counter',
      domain: 'counter',
      getIdentifier: (x) => x.id,
      initialState: { count: 0 },
      evolve: (state, event) => ({ count: state.count + event.payload.amount }),
      decide: () => [
        { id: 'e1', domain: 'other', type: 'added', payload: { amount: 2 }, created: new Date() },
        { id: 'e2', domain: 'other', type: 'added', payload: { amount: 3 }, created: new Date() },
      ],
    };

    const result = await rt.handle(aggregate, { id: 'c1' });
    expect(result.events).toHaveLength(2);
    expect(result.state).toEqual({ count: 5 });
  });

  it('validateEvent runs for each produced event', async () => {
    const seen = [];
    const rt = makeAggregateRuntime(adapter());
    const aggregate = {
      name: 'counter',
      domain: 'counter',
      getIdentifier: (x) => x.id,
      initialState: { count: 0 },
      evolve: (state, event) => ({ count: state.count + event.payload.amount }),
      validateEvent: async (event, state) => {
        seen.push([event.id, state.count]);
      },
      decide: () => [
        { id: 'e1', domain: 'other', type: 'added', payload: { amount: 2 }, created: new Date() },
        { id: 'e2', domain: 'other', type: 'added', payload: { amount: 3 }, created: new Date() },
      ],
    };

    await rt.handle(aggregate, { id: 'c1' });
    expect(seen).toEqual([
      ['e1', 0],
      ['e2', 2],
    ]);
  });

  it('handle canonicalizes identifier and evolves state', async () => {
    const rt = makeAggregateRuntime(
      adapter({
        getStreamEvents: jest.fn().mockResolvedValue([
          { id: 'e1', domain: 'counter', type: 'added', payload: { amount: 2 }, created: new Date(), sequence: 1 },
        ]),
      })
    );
    const aggregate = {
      name: 'counter',
      domain: 'counter',
      getIdentifier: (x) => x.id,
      initialState: { count: 0 },
      evolve: (state, event) => ({ count: state.count + event.payload.amount }),
      decide: () => [{ id: 'e2', domain: 'other', type: 'added', payload: { amount: 3 }, created: new Date() }],
    };

    const result = await rt.handle(aggregate, { id: 'c1' });
    expect(result.events[0].identifier).toBe('c1');
    expect(result.events[0].domain).toBe('counter');
    expect(result.state).toEqual({ count: 5 });
  });

  it('propagates OCC conflicts from appendToStream', async () => {
    const rt = makeAggregateRuntime(
      adapter({
        appendToStream: jest.fn().mockRejectedValue(
          new StreamConcurrencyError('counter', 'c1', 1, 3)
        ),
      })
    );
    const aggregate = {
      name: 'counter',
      domain: 'counter',
      getIdentifier: (x) => x.id,
      initialState: { count: 0 },
      evolve: (state, event) => state,
      decide: () => [{ id: 'e1', domain: 'counter', type: 'added', payload: { amount: 1 }, created: new Date() }],
    };

    await expect(rt.handle(aggregate, { id: 'c1' })).rejects.toBeInstanceOf(StreamConcurrencyError);
  });
});
