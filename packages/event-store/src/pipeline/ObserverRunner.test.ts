import { runObservers, ProcessedEventWithState } from './ObserverRunner';
import type { SuccessEventObserver, AggregateEventObserver, CreatedEvent } from '@schemeless/event-store-types';
import { logger } from '../util/logger';

jest.mock('../util/logger');

describe('ObserverRunner', () => {
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('observers called in priority order', async () => {
    const order: number[] = [];

    const obs1: SuccessEventObserver<any> = {
      filters: [{ domain: 'test', type: 'demo' }],
      priority: 10,
      apply: jest.fn().mockImplementation(async () => { order.push(10); }),
    };

    const obs2: SuccessEventObserver<any> = {
      filters: [{ domain: 'test', type: 'demo' }],
      priority: 1, // should run first
      apply: jest.fn().mockImplementation(async () => { order.push(1); }),
    };

    const obs3: SuccessEventObserver<any> = {
      filters: [{ domain: 'test', type: 'demo' }],
      priority: 5, // should run second
      apply: jest.fn().mockImplementation(async () => { order.push(5); }),
    };

    const event: CreatedEvent<any> = { domain: 'test', type: 'demo', payload: {}, identifier: '1', id: '1', created: new Date() } as CreatedEvent<any>;
    const processed: ProcessedEventWithState = { event };

    await runObservers([processed], [obs1, obs2, obs3]);

    expect(order).toEqual([1, 5, 10]);
    expect(obs1.apply).toHaveBeenCalledTimes(1);
    expect(obs2.apply).toHaveBeenCalledTimes(1);
    expect(obs3.apply).toHaveBeenCalledTimes(1);
  });

  it('aggregate observer receives state', async () => {
    const obs: AggregateEventObserver<any, any> = {
      aggregate: true,
      filters: [{ domain: 'test', type: 'demo' }],
      priority: 1,
      apply: jest.fn().mockResolvedValue(undefined),
    };

    const event: CreatedEvent<any> = { domain: 'test', type: 'demo', payload: {}, identifier: '1', id: '1', created: new Date() } as CreatedEvent<any>;
    const processed: ProcessedEventWithState = { event, aggregateState: { value: 42 } };

    await runObservers([processed], [obs]);

    expect(obs.apply).toHaveBeenCalledWith(event, { value: 42 });
  });

  it('fire-and-forget observer doesn\'t block', async () => {
    let fired = false;
    const obs: SuccessEventObserver<any> = {
      filters: [{ domain: 'test', type: 'demo' }],
      priority: 1,
      fireAndForget: true,
      apply: jest.fn().mockImplementation(async () => {
        await wait(20);
        fired = true;
      }),
    };

    const event: CreatedEvent<any> = { domain: 'test', type: 'demo', payload: {}, identifier: '1', id: '1', created: new Date() } as CreatedEvent<any>;
    const processed: ProcessedEventWithState = { event };

    const startTime = Date.now();
    await runObservers([processed], [obs]);
    const duration = Date.now() - startTime;

    // runObservers should complete faster than the 20ms wait
    expect(duration).toBeLessThan(15);
    expect(fired).toBe(false);

    // clean up
    await wait(30);
    expect(fired).toBe(true);
  });

  it('no matching observers is a no-op', async () => {
    const obs: SuccessEventObserver<any> = {
      filters: [{ domain: 'other', type: 'demo' }],
      priority: 1,
      apply: jest.fn().mockResolvedValue(undefined),
    };

    const event: CreatedEvent<any> = { domain: 'test', type: 'demo', payload: {}, identifier: '1', id: '1', created: new Date() } as CreatedEvent<any>;
    const processed: ProcessedEventWithState = { event };

    await runObservers([processed], [obs]);

    expect(obs.apply).not.toHaveBeenCalled();
  });

  it('observer error propagates (for non-fire-and-forget)', async () => {
    const obs: SuccessEventObserver<any> = {
      filters: [{ domain: 'test', type: 'demo' }],
      priority: 1,
      apply: jest.fn().mockRejectedValue(new Error('Observer failed')),
    };

    const event: CreatedEvent<any> = { domain: 'test', type: 'demo', payload: {}, identifier: '1', id: '1', created: new Date() } as CreatedEvent<any>;
    const processed: ProcessedEventWithState = { event };

    await expect(runObservers([processed], [obs])).rejects.toThrow('Observer failed');
  });
  
  it('fire-and-forget observer errors are logged not thrown', async () => {
    const obs: SuccessEventObserver<any> = {
      filters: [{ domain: 'test', type: 'demo' }],
      priority: 1,
      fireAndForget: true,
      apply: jest.fn().mockRejectedValue(new Error('Observer failed quietly')),
    };

    const event: CreatedEvent<any> = { domain: 'test', type: 'demo', payload: {}, identifier: '1', id: '1', created: new Date() } as CreatedEvent<any>;
    const processed: ProcessedEventWithState = { event };

    await expect(runObservers([processed], [obs])).resolves.toBeUndefined();
    
    // allow promise rejection to tick
    await wait(5);
    expect(logger.error).toHaveBeenCalled();
  });
});
