import { makeReplay } from './makeReplay';
import { runObservers } from './pipeline/ObserverRunner';
import type { SuccessEventObserver, AggregateEventObserver } from '@schemeless/event-store-types';

jest.mock('./pipeline/ObserverRunner', () => ({
  runObservers: jest.fn().mockResolvedValue(undefined),
}));

describe('makeReplay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const buildIterator = (events: any[][]) =>
    ({
      [Symbol.asyncIterator]() {
        let i = 0;
        return {
          async next() {
            if (i < events.length) {
              return { done: false, value: events[i++] };
            }
            return { done: true, value: undefined };
          }
        };
      }
    });

  it('replays events using the registered event flows', async () => {
    const apply = jest.fn().mockResolvedValue(undefined);
    const eventFlow = {
      domain: 'user',
      type: 'created',
      apply,
    };

    const successObserver: SuccessEventObserver<any> = {
      filters: [{ domain: 'user', type: 'created' }],
      priority: 0,
      apply: jest.fn(),
    };

    const storedEvent = {
      id: 'evt-1',
      domain: 'user',
      type: 'created',
      payload: { name: 'Ada' },
      created: new Date('2020-01-01T00:00:00.000Z').toISOString(),
    };

    const repo = {
      getAllEvents: jest.fn(async () => buildIterator([[storedEvent], []])),
    };

    const replay = makeReplay([eventFlow as any], [successObserver], repo as any);
    await replay('start-id');

    expect(repo.getAllEvents).toHaveBeenCalledWith(200, 'start-id');
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'evt-1',
        created: expect.any(Date),
      })
    );
    
    expect(runObservers).toHaveBeenCalledWith(
      [
        {
          event: expect.objectContaining({ id: 'evt-1' }),
          aggregateState: undefined,
        }
      ],
      [successObserver]
    );
  });

  it('calls aggregate apply during replay and passes per-event state to runObservers', async () => {
    const apply = jest.fn((_event, state) => ({ count: state.count + _event.payload.amount * 10 }));
    const eventFlow = {
      domain: 'counter',
      type: 'incremented',
      aggregate: {
        getIdentifier: (e: any) => e.identifier,
        initialState: { count: 0 },
        reducer: (state: any, event: any) => ({ count: state.count + event.payload.amount }),
      },
      apply,
    };
    const aggregateObserver: AggregateEventObserver<any, any> = {
      aggregate: true,
      filters: [{ domain: 'counter', type: 'incremented' }],
      priority: 0,
      apply: jest.fn(),
    };

    const storedEvent = {
      id: 'evt-2',
      domain: 'counter',
      type: 'incremented',
      payload: { amount: 1 },
      identifier: 'acct-1',
      created: new Date('2020-01-01T00:00:00.000Z').toISOString(),
    };

    const repo = {
      getAllEvents: jest.fn(async () => buildIterator([[storedEvent], []])),
    };

    const replay = makeReplay([eventFlow as any], [aggregateObserver as any], repo as any);
    await replay('start-id');

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'evt-2',
        created: expect.any(Date),
      }),
      { count: 0 }
    );
    
    // the reducer should output { count: 1 } (0 + 1)
    expect(runObservers).toHaveBeenCalledWith(
      [
        {
          event: expect.objectContaining({ id: 'evt-2' }),
          aggregateState: { count: 1 },
        }
      ],
      [aggregateObserver]
    );
  });
});
