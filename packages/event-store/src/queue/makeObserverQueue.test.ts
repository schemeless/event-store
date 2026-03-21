import { firstValueFrom } from 'rxjs';

import type { AggregateEventObserver, CreatedEvent, SuccessEventObserver } from '@schemeless/event-store-types';
import { EventObserverState } from '@schemeless/event-store-types';

import { makeObserverQueue } from './makeObserverQueue';
import { logger } from '../util/logger';

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

  it('passes aggregate state to observers marked as aggregate', async () => {
    const aggregateApply = jest.fn().mockResolvedValue(undefined);
    const observers: Array<SuccessEventObserver<any> | AggregateEventObserver<any, { count: number }>> = [
      {
        aggregate: true,
        filters: [{ domain: 'test', type: 'created' }],
        priority: 10,
        apply: aggregateApply,
      },
    ];

    const observerQueue = makeObserverQueue(observers, {
      getAggregateState: () => ({ count: 7 }),
      hasAggregateState: () => true,
    });
    const processedPromise = firstValueFrom(observerQueue.processed$);

    const event = makeEvent();
    observerQueue.push(event);
    await processedPromise;

    expect(aggregateApply).toHaveBeenCalledWith(event, { count: 7 });
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
    const loggerErrorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
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
    expect(loggerErrorSpy).toHaveBeenCalled();
    processedSubscription.unsubscribe();
    loggerErrorSpy.mockRestore();
  });
});
