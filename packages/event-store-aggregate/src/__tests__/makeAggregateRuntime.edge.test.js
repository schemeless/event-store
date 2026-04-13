const { InvalidIdentifierError } = require('@schemeless/event-store-types');
const { makeAggregateRuntime } = require('../../src');

const adapter = (overrides = {}) => ({
  getStreamEvents: jest.fn().mockResolvedValue([]),
  appendToStream: jest.fn().mockResolvedValue({ nextVersion: 1 }),
  getSnapshot: jest.fn().mockResolvedValue(null),
  saveSnapshot: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe('makeAggregateRuntime edge cases', () => {
  beforeEach(() => {
    jest.useRealTimers();
  });

  it('handles empty decide result (no events produced)', async () => {
    const rt = makeAggregateRuntime(adapter());
    const aggregate = {
      name: 'counter',
      domain: 'counter',
      getIdentifier: (x) => x.id,
      initialState: { count: 10 },
      evolve: (state, event) => ({ count: state.count + event.payload.amount }),
      decide: () => [],
    };

    const result = await rt.handle(aggregate, { id: 'c1' });
    expect(result.events).toEqual([]);
    expect(result.state).toEqual({ count: 10 });
    expect(result.sequence).toBe(1);
  });

  it('hydrate rejects empty identifiers', async () => {
    const rt = makeAggregateRuntime(adapter());
    const aggregate = {
      name: 'counter',
      domain: 'counter',
      getIdentifier: (x) => x.id,
      initialState: { count: 0 },
      evolve: (state) => state,
      decide: () => [],
    };

    await expect(rt.hydrate(aggregate, '')).rejects.toBeInstanceOf(InvalidIdentifierError);
  });

  it('precondition is called with correct context', async () => {
    const receivedArgs = [];
    const rt = makeAggregateRuntime(
      adapter({
        getStreamEvents: jest
          .fn()
          .mockResolvedValue([
            { id: 'e1', domain: 'counter', type: 'added', payload: { amount: 5 }, created: new Date(), sequence: 1 },
          ]),
      })
    );
    const aggregate = {
      name: 'counter',
      domain: 'counter',
      getIdentifier: (x) => x.id,
      initialState: { count: 0 },
      evolve: (state, event) => ({ count: state.count + event.payload.amount }),
      precondition: (command, state, ctx) => {
        receivedArgs.push({ command, state, ctx });
      },
      decide: () => [],
    };

    await rt.handle(aggregate, { id: 'c1' });
    expect(receivedArgs).toHaveLength(1);
    expect(receivedArgs[0].command).toEqual({ id: 'c1' });
    expect(receivedArgs[0].state).toEqual({ count: 5 });
    expect(receivedArgs[0].ctx).toEqual({ identifier: 'c1', sequence: 1 });
  });

  it('decide receives correct hydrated state', async () => {
    let receivedState = null;
    let receivedCtx = null;
    const rt = makeAggregateRuntime(
      adapter({
        getStreamEvents: jest
          .fn()
          .mockResolvedValue([
            { id: 'e1', domain: 'counter', type: 'added', payload: { amount: 5 }, created: new Date(), sequence: 1 },
          ]),
      })
    );
    const aggregate = {
      name: 'counter',
      domain: 'counter',
      getIdentifier: (x) => x.id,
      initialState: { count: 0 },
      evolve: (state, event) => ({ count: state.count + event.payload.amount }),
      decide: (command, state, ctx) => {
        receivedState = state;
        receivedCtx = ctx;
        return [];
      },
    };

    await rt.handle(aggregate, { id: 'c1' });
    expect(receivedState).toEqual({ count: 5 });
    expect(receivedCtx).toEqual({ identifier: 'c1', sequence: 1 });
  });

  it('handle throws when precondition rejects with non-Error', async () => {
    const rt = makeAggregateRuntime(adapter());
    const aggregate = {
      name: 'counter',
      domain: 'counter',
      getIdentifier: (x) => x.id,
      initialState: { count: 0 },
      evolve: (state, event) => state,
      precondition: () => {
        return Promise.reject('precondition string rejection');
      },
      decide: () => [],
    };

    await expect(rt.handle(aggregate, { id: 'c1' })).rejects.toBe('precondition string rejection');
  });

  it('handle throws when precondition resolves to rejected promise', async () => {
    const rt = makeAggregateRuntime(adapter());
    const aggregate = {
      name: 'counter',
      domain: 'counter',
      getIdentifier: (x) => x.id,
      initialState: { count: 0 },
      evolve: (state, event) => state,
      precondition: async () => {
        throw new Error('async precondition failure');
      },
      decide: () => [],
    };

    await expect(rt.handle(aggregate, { id: 'c1' })).rejects.toThrow('async precondition failure');
  });

  it('validateEvent throws propagate through handle', async () => {
    const rt = makeAggregateRuntime(adapter());
    const aggregate = {
      name: 'counter',
      domain: 'counter',
      getIdentifier: (x) => x.id,
      initialState: { count: 0 },
      evolve: (state, event) => state,
      validateEvent: () => {
        throw new Error('invalid event');
      },
      decide: () => [{ id: 'e1', domain: 'other', type: 'added', payload: { amount: 1 }, created: new Date() }],
    };

    await expect(rt.handle(aggregate, { id: 'c1' })).rejects.toThrow('invalid event');
  });

  it('hydrate returns initialState when snapshot is null and stream is empty', async () => {
    const rt = makeAggregateRuntime(adapter());
    const aggregate = {
      name: 'counter',
      domain: 'counter',
      getIdentifier: (x) => x.id,
      initialState: { count: 99 },
      evolve: (state, event) => ({ count: state.count + event.payload.amount }),
      decide: () => [],
    };

    const result = await rt.hydrate(aggregate, 'c1');
    expect(result.state).toEqual({ count: 99 });
    expect(result.sequence).toBe(0);
  });

  it('hydrate uses sequence from snapshot when available', async () => {
    const rt = makeAggregateRuntime(
      adapter({
        getSnapshot: jest.fn().mockResolvedValue({
          domain: 'counter',
          identifier: 'c1',
          state: { count: 5 },
          sequence: 10,
          created: new Date(),
        }),
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
    expect(result.sequence).toBe(10);
    expect(result.state).toEqual({ count: 5 });
  });

  it('handle canonicalizes events that already have identifier and domain', async () => {
    const rt = makeAggregateRuntime(adapter());
    const aggregate = {
      name: 'counter',
      domain: 'counter',
      getIdentifier: (x) => x.id,
      initialState: { count: 0 },
      evolve: (state, event) => state,
      decide: () => [
        {
          id: 'e1',
          domain: 'other-domain',
          identifier: 'other-id',
          type: 'added',
          payload: { amount: 1 },
          created: new Date(),
        },
      ],
    };

    const result = await rt.handle(aggregate, { id: 'c1' });
    expect(result.events[0].identifier).toBe('c1');
    expect(result.events[0].domain).toBe('counter');
  });

  it('appendToStream is called with canonicalized events and current version', async () => {
    let capturedEvents = null;
    let capturedVersion = null;
    const rt = makeAggregateRuntime(
      adapter({
        getStreamEvents: jest
          .fn()
          .mockResolvedValue([
            { id: 'e1', domain: 'counter', type: 'added', payload: { amount: 5 }, created: new Date(), sequence: 1 },
          ]),
        appendToStream: jest.fn().mockImplementation((events, version) => {
          capturedEvents = events;
          capturedVersion = version;
          return { nextVersion: version + events.length };
        }),
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

    await rt.handle(aggregate, { id: 'c1' });
    expect(capturedEvents).toHaveLength(1);
    expect(capturedEvents[0].identifier).toBe('c1');
    expect(capturedEvents[0].domain).toBe('counter');
    expect(capturedVersion).toBe(1);
  });

  it('snapshot is not saved when snapshot adapter is not provided', async () => {
    const rt = makeAggregateRuntime({
      getStreamEvents: jest.fn().mockResolvedValue([]),
      appendToStream: jest.fn().mockResolvedValue({ nextVersion: 1 }),
      getSnapshot: jest.fn().mockResolvedValue(null),
    });
    const aggregate = {
      name: 'counter',
      domain: 'counter',
      getIdentifier: (x) => x.id,
      initialState: { count: 0 },
      evolve: (state, event) => state,
      decide: () => [{ id: 'e1', domain: 'other', type: 'added', payload: { amount: 1 }, created: new Date() }],
    };

    await expect(rt.handle(aggregate, { id: 'c1' })).resolves.toBeDefined();
  });

  it('multiple sequential handles maintain correct state', async () => {
    let savedSnapshot = null;
    const getStreamEvents = jest.fn().mockImplementation(async (_domain, _identifier, fromSequence) => {
      if (fromSequence === 0) {
        return [
          { id: 'e1', domain: 'counter', type: 'added', payload: { amount: 2 }, created: new Date(), sequence: 1 },
        ];
      }
      // Return empty for any sequence > 0 (no new events after snapshot)
      return [];
    });
    const rt = makeAggregateRuntime(
      adapter({
        getSnapshot: jest.fn().mockImplementation(async () => savedSnapshot),
        getStreamEvents,
        saveSnapshot: jest.fn().mockImplementation(async (snapshot) => {
          savedSnapshot = snapshot;
        }),
        appendToStream: jest.fn().mockImplementation(async (events, version) => ({
          nextVersion: version + events.length,
        })),
      })
    );
    const aggregate = {
      name: 'counter',
      domain: 'counter',
      getIdentifier: (x) => x.id,
      initialState: { count: 0 },
      evolve: (state, event) => ({ count: state.count + event.payload.amount }),
      decide: (command, state) => [
        {
          id: 'e' + (state.count + 2),
          domain: 'counter',
          type: 'added',
          payload: { amount: command.amount },
          created: new Date(),
        },
      ],
    };

    const result1 = await rt.handle(aggregate, { id: 'c1', amount: 3 });
    expect(result1.sequence).toBe(2);
    expect(result1.state).toEqual({ count: 5 });

    const result2 = await rt.handle(aggregate, { id: 'c1', amount: 4 });
    expect(result2.sequence).toBe(3);
    expect(result2.state).toEqual({ count: 9 });
  });
});
