import { runObservers } from '../ObserverRunner';
import type { PersistedEvent } from '../types';

const makeEvent = (overrides = {}): PersistedEvent => ({
  id: 'event-1',
  domain: 'test',
  type: 'Created',
  payload: {},
  identifier: 'agg-1',
  sequence: 1,
  correlationId: 'corr-1',
  causationId: null,
  created: new Date(),
  ...overrides,
});

describe('ObserverRunner', () => {
  describe('runObservers', () => {
    // Test 1: returns early when observers array is empty
    it('returns early when observers array is empty', async () => {
      const event = makeEvent();
      const apply = jest.fn();

      await runObservers([event], []);

      expect(apply).not.toHaveBeenCalled();
    });

    // Test 2: matches events by domain and type
    it('matches events by domain and type', async () => {
      const event = makeEvent({ domain: 'test', type: 'Created' });
      const apply = jest.fn().mockResolvedValue(undefined);
      const observer = {
        name: 'obs1',
        filters: [{ domain: 'test', type: 'Created' }],
        apply,
      };

      await runObservers([event], [observer]);

      expect(apply).toHaveBeenCalledTimes(1);
      expect(apply).toHaveBeenCalledWith(event);
    });

    // Test 3: does not match when domain or type differs
    it('does not match when domain or type differs', async () => {
      const event = makeEvent({ domain: 'test', type: 'Created' });
      const apply = jest.fn().mockResolvedValue(undefined);
      const observer = {
        name: 'obs1',
        filters: [{ domain: 'test', type: 'Updated' }],
        apply,
      };

      await runObservers([event], [observer]);

      expect(apply).not.toHaveBeenCalled();
    });

    // Test 4: runs multiple observers for matching event
    it('runs multiple observers for matching event', async () => {
      const event = makeEvent({ domain: 'test', type: 'Created' });
      const apply1 = jest.fn().mockResolvedValue(undefined);
      const apply2 = jest.fn().mockResolvedValue(undefined);
      const observer1 = {
        name: 'obs1',
        filters: [{ domain: 'test', type: 'Created' }],
        apply: apply1,
      };
      const observer2 = {
        name: 'obs2',
        filters: [{ domain: 'test', type: 'Created' }],
        apply: apply2,
      };

      await runObservers([event], [observer1, observer2]);

      expect(apply1).toHaveBeenCalledTimes(1);
      expect(apply2).toHaveBeenCalledTimes(1);
    });

    // Test 5: runs observers in priority order (lowest first)
    it('runs observers in priority order (lowest first)', async () => {
      const event = makeEvent({ domain: 'test', type: 'Created' });
      const callOrder: string[] = [];
      const observer1 = {
        name: 'obs1',
        filters: [{ domain: 'test', type: 'Created' }],
        priority: 3,
        apply: jest.fn().mockImplementation(async () => {
          callOrder.push('obs1');
        }),
      };
      const observer2 = {
        name: 'obs2',
        filters: [{ domain: 'test', type: 'Created' }],
        priority: 1,
        apply: jest.fn().mockImplementation(async () => {
          callOrder.push('obs2');
        }),
      };
      const observer3 = {
        name: 'obs3',
        filters: [{ domain: 'test', type: 'Created' }],
        priority: 2,
        apply: jest.fn().mockImplementation(async () => {
          callOrder.push('obs3');
        }),
      };

      await runObservers([event], [observer1, observer2, observer3]);

      expect(callOrder).toEqual(['obs2', 'obs3', 'obs1']);
    });

    // Test 6: uses priority 0 as default
    it('uses priority 0 as default', async () => {
      const event = makeEvent({ domain: 'test', type: 'Created' });
      const callOrder: string[] = [];
      const observerA = {
        name: 'obsA',
        filters: [{ domain: 'test', type: 'Created' }],
        priority: -1,
        apply: jest.fn().mockImplementation(async () => {
          callOrder.push('obsA');
        }),
      };
      const observerB = {
        name: 'obsB',
        filters: [{ domain: 'test', type: 'Created' }],
        // priority defaults to 0
        apply: jest.fn().mockImplementation(async () => {
          callOrder.push('obsB');
        }),
      };

      await runObservers([event], [observerA, observerB]);

      expect(callOrder).toEqual(['obsA', 'obsB']);
    });

    // Test 7: blocks on non-fireAndForget observers (sequential execution)
    it('blocks on non-fireAndForget observers (sequential execution)', async () => {
      const event = makeEvent({ domain: 'test', type: 'Created' });
      let firstResolve: () => void;
      const firstApply = jest.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            firstResolve = resolve;
          })
      );
      const secondApply = jest.fn().mockResolvedValue(undefined);
      const observer1 = {
        name: 'obs1',
        filters: [{ domain: 'test', type: 'Created' }],
        apply: firstApply,
      };
      const observer2 = {
        name: 'obs2',
        filters: [{ domain: 'test', type: 'Created' }],
        apply: secondApply,
      };

      const runPromise = runObservers([event], [observer1, observer2]);

      // At this point, first observer should be called but not yet resolved
      expect(firstApply).toHaveBeenCalled();
      expect(secondApply).not.toHaveBeenCalled();

      // Resolve the first observer
      firstResolve!();

      await runPromise;

      // Now second observer should have been called
      expect(secondApply).toHaveBeenCalledTimes(1);
    });

    // Test 8: fireAndForget does not block on observer errors
    it('fireAndForget does not block on observer errors', async () => {
      const event = makeEvent({ domain: 'test', type: 'Created' });
      const firstApply = jest.fn().mockImplementation(async () => {
        throw new Error('first error');
      });
      const secondApply = jest.fn().mockResolvedValue(undefined);
      const observer1 = {
        name: 'obs1',
        filters: [{ domain: 'test', type: 'Created' }],
        fireAndForget: true,
        apply: firstApply,
      };
      const observer2 = {
        name: 'obs2',
        filters: [{ domain: 'test', type: 'Created' }],
        fireAndForget: true,
        apply: secondApply,
      };

      // Should NOT throw
      await expect(runObservers([event], [observer1, observer2])).resolves.toBeUndefined();

      // Give fireAndForget handlers time to execute
      await new Promise((resolve) => setImmediate(resolve));

      expect(firstApply).toHaveBeenCalledTimes(1);
      expect(secondApply).toHaveBeenCalledTimes(1);
    });

    // Test 9: fireAndForget calls onError when observer throws and onError is provided
    it('fireAndForget calls onError when observer throws and onError is provided', async () => {
      const event = makeEvent({ domain: 'test', type: 'Created' });
      const testError = new Error('observer error');
      const onError = jest.fn();
      const observer = {
        name: 'obs1',
        filters: [{ domain: 'test', type: 'Created' }],
        fireAndForget: true,
        onError,
        apply: jest.fn().mockImplementation(async () => {
          throw testError;
        }),
      };

      await runObservers([event], [observer]);

      // Give fireAndForget handler time to run
      await new Promise((resolve) => setImmediate(resolve));

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(testError, event);
    });

    // Test 10: non-fireAndForget observer errors propagate
    it('non-fireAndForget observer errors propagate', async () => {
      const event = makeEvent({ domain: 'test', type: 'Created' });
      const observer = {
        name: 'obs1',
        filters: [{ domain: 'test', type: 'Created' }],
        apply: jest.fn().mockRejectedValue(new Error('observer error')),
      };

      await expect(runObservers([event], [observer])).rejects.toThrow('observer error');
    });

    // Test 11: console.error is called when fireAndForget observer fails without onError
    it('console.error is called when fireAndForget observer fails without onError', async () => {
      const event = makeEvent({ domain: 'test', type: 'Created' });
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const observer = {
        name: 'obs1',
        filters: [{ domain: 'test', type: 'Created' }],
        fireAndForget: true,
        apply: jest.fn().mockRejectedValue(new Error('observer error')),
      };

      await runObservers([event], [observer]);

      // Give fireAndForget handler time to run asynchronously
      await new Promise((resolve) => setImmediate(resolve));

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[ObserverRunner] Observer "obs1" failed on event "event-1":',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });
});
