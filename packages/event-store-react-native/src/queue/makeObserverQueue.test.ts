import { firstValueFrom } from 'rxjs';

import type { CreatedEvent, SuccessEventObserver } from '@schemeless/event-store-types';
import { EventObserverState } from '@schemeless/event-store-types';

import { makeObserverQueue } from './makeObserverQueue';

const makeEvent = (): CreatedEvent<any> => ({
  id: '1',
  domain: 'test',
  type: 'created',
  payload: {},
  created: new Date(),
});

describe('makeObserverQueue', () => {
  it('applies matching observers and emits success states', async () => {
    const apply = jest.fn().mockResolvedValue(undefined);
    const observers: SuccessEventObserver<any>[] = [
      {
        filters: [{ domain: 'test', type: 'created' }],
        priority: 10,
        apply,
      },
    ];

    const observerQueue = makeObserverQueue(observers);
    const processedPromise = firstValueFrom(observerQueue.processed$);
    const drainedPromise = firstValueFrom(observerQueue.queueInstance.drained$);

    const event = makeEvent();
    observerQueue.push(event);

    const result = await processedPromise;
    await drainedPromise;

    expect(apply).toHaveBeenCalledWith(event);
    expect(result).toEqual({ event, state: EventObserverState.success });
  });

  it('respects observer priority when applying multiple observers', async () => {
    const callOrder: string[] = [];
    const lowPriority: SuccessEventObserver<any> = {
      filters: [{ domain: 'test', type: 'created' }],
      priority: 10,
      apply: jest.fn(async () => {
        callOrder.push('low');
      }),
    };
    const highPriority: SuccessEventObserver<any> = {
      filters: [{ domain: 'test', type: 'created' }],
      priority: 1,
      apply: jest.fn(async () => {
        callOrder.push('high');
      }),
    };

    const observerQueue = makeObserverQueue([lowPriority, highPriority]);
    const processedPromise = firstValueFrom(observerQueue.processed$);

    observerQueue.push(makeEvent());
    await processedPromise;

    expect(callOrder).toEqual(['high', 'low']);
  });

  it('drains without emitting when no observers match', async () => {
    const observerQueue = makeObserverQueue([]);
    const processedSpy = jest.fn();
    const subscription = observerQueue.processed$.subscribe(processedSpy);

    observerQueue.push(makeEvent());
    await firstValueFrom(observerQueue.queueInstance.drained$);

    expect(processedSpy).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });

  it('continues processing when a fire-and-forget observer throws', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const successApply = jest.fn().mockResolvedValue(undefined);
    const observers: SuccessEventObserver<any>[] = [
      {
        filters: [{ domain: 'test', type: 'created' }],
        priority: 1,
        fireAndForget: true,
        apply: jest.fn(async () => {
          throw new Error('Boom');
        }),
      },
      {
        filters: [{ domain: 'test', type: 'created' }],
        priority: 2,
        apply: successApply,
      },
    ];

    const observerQueue = makeObserverQueue(observers);
    const processedSubscription = observerQueue.processed$.subscribe();
    const drainedPromise = firstValueFrom(observerQueue.queueInstance.drained$);
    const firstEvent = makeEvent();
    const secondEvent = { ...makeEvent(), id: '2' };

    observerQueue.push(firstEvent);
    observerQueue.push(secondEvent);
    await drainedPromise;

    expect(successApply).toHaveBeenCalledTimes(2);
    expect(successApply).toHaveBeenNthCalledWith(1, firstEvent);
    expect(successApply).toHaveBeenNthCalledWith(2, secondEvent);
    expect(consoleErrorSpy).toHaveBeenCalled();
    processedSubscription.unsubscribe();
    consoleErrorSpy.mockRestore();
  });
});
