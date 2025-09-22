import { BehaviorSubject } from 'rxjs';

import { sideEffectFinishedPromise } from './sideEffectFinishedPromise';

describe('sideEffectFinishedPromise', () => {
  const tick = async () => {
    jest.advanceTimersByTime(100);
    await Promise.resolve();
  };

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves once the queue reports empty twice in a row', async () => {
    const queueSize$ = new BehaviorSubject<number | null>(3);
    const eventStore = {
      sideEffectQueue: {
        queueInstance: {
          queueSize$,
        },
      },
    } as any;

    const finishedPromise = sideEffectFinishedPromise(eventStore);

    await tick();
    queueSize$.next(1);
    await tick();
    queueSize$.next(0);
    await tick();

    const waitForCompletion = finishedPromise;

    await tick();

    await expect(waitForCompletion).resolves.toBe(0);
  });

  it('handles null queue sizes', async () => {
    const queueSize$ = new BehaviorSubject<number | null>(null);
    const eventStore = {
      sideEffectQueue: {
        queueInstance: {
          queueSize$,
        },
      },
    } as any;

    const waitForCompletion = sideEffectFinishedPromise(eventStore);

    await tick();
    await tick();

    await expect(waitForCompletion).resolves.toBeNull();
  });
});
