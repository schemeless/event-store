import { Subject } from 'rxjs';

import type { SuccessEventObserver } from '@schemeless/event-store-types';

import { makeReplay } from './makeReplay';
import { makeObserverQueue } from './queue/makeObserverQueue';

jest.mock('./queue/makeObserverQueue');

const makeObserverQueueMock = makeObserverQueue as jest.MockedFunction<typeof makeObserverQueue>;

describe('makeReplay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const buildIterator = (events: any[][]) =>
    (async function* () {
      for (const page of events) {
        yield page;
      }
    })();

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

    const observerQueueDrained$ = new Subject<void>();
    const observerPush = jest.fn(() => {
      observerQueueDrained$.next();
    });

    makeObserverQueueMock.mockReturnValue({
      processed$: new Subject(),
      queueInstance: { drained$: observerQueueDrained$ } as any,
      push: observerPush as any,
    } as any);

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
    expect(makeObserverQueueMock).toHaveBeenCalledWith([successObserver]);
    expect(observerPush).toHaveBeenCalledWith(expect.objectContaining({ id: 'evt-1' }));
  });
});
