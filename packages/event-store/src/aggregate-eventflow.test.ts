import type {
  AggregateEventFlow,
  AggregateEventObserver,
  BaseEventInput,
  CreatedEvent,
  IEventStoreEntity,
  IEventStoreRepo,
} from '@schemeless/event-store-types';
import { makeEventStore } from './makeEventStore';

type CounterState = { count: number };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const createInMemoryRepo = () => {
  const events: IEventStoreEntity[] = [];
  const snapshots = new Map<string, any>();

  const getStreamKey = (domain: string, identifier: string) => `${domain}::${identifier}`;

  const repo: IEventStoreRepo = {
    init: jest.fn().mockResolvedValue(undefined),
    getAllEvents: jest.fn(async () =>
      (async function* () {
        yield [...events].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
        yield [];
      })()
    ),
    createEventEntity: jest.fn((event: CreatedEvent<any>) => ({
      id: event.id,
      domain: event.domain,
      type: event.type,
      meta: event.meta,
      payload: event.payload,
      identifier: event.identifier,
      correlationId: event.correlationId,
      causationId: event.causationId,
      created: event.created,
    })),
    storeEvents: jest.fn(async (eventsToStore: CreatedEvent<any>[]) => {
      for (const event of eventsToStore) {
        const identifier = event.identifier ?? '';
        const currentSequence = events.filter(
          (stored) => stored.domain === event.domain && (stored.identifier ?? '') === identifier
        ).length;
        const storedEvent: IEventStoreEntity = {
          id: event.id,
          domain: event.domain,
          type: event.type,
          meta: event.meta,
          payload: event.payload,
          identifier: event.identifier,
          correlationId: event.correlationId,
          causationId: event.causationId,
          sequence: currentSequence + 1,
          created: event.created,
        };
        events.push(storedEvent);
      }
    }),
    resetStore: jest.fn().mockResolvedValue(undefined),
    getStreamEvents: jest.fn(async (domain: string, identifier: string, fromSequence = 0) =>
      events
        .filter(
          (event) =>
            event.domain === domain && (event.identifier ?? '') === identifier && (event.sequence ?? 0) > fromSequence
        )
        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
    ),
    getSnapshot: jest.fn(
      async <STATE>(domain: string, identifier: string) => snapshots.get(getStreamKey(domain, identifier)) ?? null
    ),
    saveSnapshot: jest.fn(async (snapshot) => {
      snapshots.set(getStreamKey(snapshot.domain, snapshot.identifier), snapshot);
    }),
    getStreamSequence: jest.fn(
      async (domain: string, identifier: string) =>
        events.filter((event) => event.domain === domain && (event.identifier ?? '') === identifier).length
    ),
    capabilities: { aggregate: true },
  };

  return repo;
};

const makeAggregateFlow = (
  hooks: Partial<AggregateEventFlow<{ amount: number }, { amount: number }, CounterState>>
): AggregateEventFlow<{ amount: number }, { amount: number }, CounterState> => {
  let flow!: AggregateEventFlow<{ amount: number }, { amount: number }, CounterState>;
  flow = {
    domain: 'counter',
    type: hooks.type || 'incremented',
    receive: (eventStore) => eventStore.receive(flow as any),
    kind: 'aggregate',
    aggregate: {
      initialState: { count: 0 },
      reducer: (state, event) => ({ count: state.count + event.payload.amount }),
    },
    ...hooks,
  };
  return flow;
};

describe('AggregateEventFlow', () => {
  it('loads and propagates aggregate state across sequential receives', async () => {
    const repo = createInMemoryRepo();
    const validateStates: number[] = [];
    const applyStates: number[] = [];
    const observerStates: number[] = [];

    const flow = makeAggregateFlow({
      validate: (_event, state) => {
        validateStates.push(state.count);
      },
      apply: (_event, state) => {
        applyStates.push(state.count);
        return { count: state.count + _event.payload.amount };
      },
    });

    const observer: AggregateEventObserver<{ amount: number }, CounterState> = {
      aggregate: true,
      filters: [{ domain: 'counter', type: 'incremented' }],
      priority: 0,
      apply: async (_event, state) => {
        observerStates.push(state.count);
      },
    };

    const eventStore = await makeEventStore(repo)([flow as any], [observer as any]);

    await (flow.receive(eventStore as any) as any)({
      payload: { amount: 1 },
      identifier: 'acct-1',
    } as BaseEventInput<{ amount: number }>);

    await (flow.receive(eventStore as any) as any)({
      payload: { amount: 1 },
      identifier: 'acct-1',
    } as BaseEventInput<{ amount: number }>);

    expect(validateStates).toEqual([0, 1]);
    expect(applyStates).toEqual([0, 1]);
    expect(observerStates).toEqual([1, 2]);
  });

  it('reuses aggregate state for consequent events without calling getAggregate again', async () => {
    const repo = createInMemoryRepo();
    const validateStates: number[] = [];

    const flow = makeAggregateFlow({
      validate: (_event, state) => {
        validateStates.push(state.count);
      },
      apply: (_event, state) => ({ count: state.count + _event.payload.amount }),
      createConsequentEvents: (event) =>
        !event.causationId
          ? [
              {
                domain: 'counter',
                type: 'incremented',
                identifier: 'acct-1',
                payload: { amount: 1 },
              },
            ]
          : [],
    });

    const eventStore = await makeEventStore(repo)([flow as any], []);

    await (flow.receive(eventStore as any) as any)({
      payload: { amount: 1 },
      identifier: 'acct-1',
    } as BaseEventInput<{ amount: number }>);

    expect(validateStates).toEqual([0, 1]);
    expect(repo.getStreamEvents).toHaveBeenCalledTimes(1);
  });


  it('passes aggregate state to replay observers', async () => {
    const repo = createInMemoryRepo();
    const replayStates: number[] = [];
    const replayApply = jest.fn((_event, state) => ({ count: state.count + _event.payload.amount * 10 }));

    const flow = makeAggregateFlow({
      apply: replayApply,
    });

    const observer: AggregateEventObserver<{ amount: number }, CounterState> = {
      aggregate: true,
      filters: [{ domain: 'counter', type: 'incremented' }],
      priority: 0,
      apply: async (_event, state) => {
        replayStates.push(state.count);
      },
    };

    const eventStore = await makeEventStore(repo)([flow as any], [observer as any]);

    await (flow.receive(eventStore as any) as any)({
      payload: { amount: 1 },
      identifier: 'acct-1',
    } as BaseEventInput<{ amount: number }>);

    await (flow.receive(eventStore as any) as any)({
      payload: { amount: 1 },
      identifier: 'acct-1',
    } as BaseEventInput<{ amount: number }>);

    replayApply.mockClear();
    replayStates.length = 0;
    await eventStore.replay();
    await wait(20);

    expect(replayApply).toHaveBeenCalledTimes(2);
    expect(replayApply).toHaveBeenNthCalledWith(1, expect.objectContaining({ payload: { amount: 1 } }), { count: 0 });
    expect(replayApply).toHaveBeenNthCalledWith(2, expect.objectContaining({ payload: { amount: 1 } }), { count: 1 });
    expect(replayStates).toEqual([1, 2]);
  });

  it('clears aggregate state after a failed consequent event chain', async () => {
    const repo = createInMemoryRepo();
    const validateStates: number[] = [];

    const flow = makeAggregateFlow({
      validate: (event, state) => {
        validateStates.push(state.count);
        if (event.payload.amount === 99) {
          throw new Error('child failed');
        }
      },
      apply: (_event, state) => ({ count: state.count + _event.payload.amount }),
      createConsequentEvents: (event) =>
        !event.causationId && event.payload.amount === 1
          ? [
              {
                domain: 'counter',
                type: 'incremented',
                identifier: 'acct-1',
                payload: { amount: 99 },
              },
            ]
          : [],
    });

    const eventStore = await makeEventStore(repo)([flow as any], []);

    await expect(
      (flow.receive(eventStore as any) as any)({
        payload: { amount: 1 },
        identifier: 'acct-1',
      } as BaseEventInput<{ amount: number }>)
    ).rejects.toThrow('child failed');

    await (flow.receive(eventStore as any) as any)({
      payload: { amount: 2 },
      identifier: 'acct-1',
    } as BaseEventInput<{ amount: number }>);

    expect(validateStates).toEqual([0, 1, 0]);
    expect(repo.getStreamEvents).toHaveBeenCalledTimes(2);
  });
});
