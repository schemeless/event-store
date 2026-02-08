import { Subject } from 'rxjs';

import type { BaseEventInput, SuccessEventObserver } from '@schemeless/event-store-types';

import { makeReceive } from './makeReceive';
import { makeObserverQueue } from './makeObserverQueue';

jest.mock('./makeObserverQueue');

const makeObserverQueueMock = makeObserverQueue as jest.MockedFunction<typeof makeObserverQueue>;

const eventFlow = {
  domain: 'account',
  type: 'created',
};

const eventInput: BaseEventInput<{ id: string }> = {
  payload: { id: '42' },
};

describe('makeReceive', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('pushes events to the main queue and waits for observer completion', async () => {
    const drained$ = new Subject<void>();
    const observerPush = jest.fn();
    makeObserverQueueMock.mockReturnValue({
      processed$: new Subject(),
      queueInstance: { drained$ } as any,
      push: observerPush as any,
    } as any);

    const successObservers: SuccessEventObserver<any>[] = [
      { filters: [{ domain: 'account', type: 'created' }], priority: 0, apply: jest.fn() },
    ];

    const doneEvents = [
      { id: '1', domain: 'account', type: 'created', payload: { id: '42' }, created: new Date() },
    ] as any;

    const mainQueue = {
      push: jest.fn((event, cb) => {
        cb(null, doneEvents);
      }),
    };

    const receive = makeReceive(mainQueue as any, successObservers);

    const receivePromise = receive(eventFlow as any)(eventInput);

    expect(mainQueue.push).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'account', type: 'created' }),
      expect.any(Function)
    );
    expect(makeObserverQueueMock).toHaveBeenCalledWith(
      successObservers,
      expect.objectContaining({ concurrent: 1 })
    );

    drained$.next();

    await expect(receivePromise).resolves.toEqual(doneEvents);
    expect(observerPush).toHaveBeenCalledTimes(doneEvents.length);
    expect(observerPush).toHaveBeenCalledWith(doneEvents[0]);
  });

  it('rejects when the main queue reports an error', async () => {
    const mainQueue = {
      push: jest.fn((_, cb) => {
        cb({ error: new Error('broken') } as any, undefined as any);
      }),
    };

    const receive = makeReceive(mainQueue as any, []);

    await expect(receive(eventFlow as any)(eventInput)).rejects.toThrow('broken');
    expect(makeObserverQueueMock).not.toHaveBeenCalled();
  });
});
