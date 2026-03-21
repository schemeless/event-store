import { getTestEventStore, shutdownEventStore } from './util/testHelpers';
import { NestedTwiceEvent, StandardEvent, testEventFlows, testObservers } from './mocks';
import { storeGet } from './mocks/mockStore';
import { mockObserverApply } from './mocks/Standard.observer';
import delay from 'delay.ts';

describe('make eventStore', () => {
  afterEach(async () => {
    jest.clearAllMocks();
    await shutdownEventStore();
  });
  
  it('should process simple events via receive', async () => {
    const eventStore = await getTestEventStore(testEventFlows, testObservers);

    await expect(
      StandardEvent.receive(eventStore)({
        payload: {
          key: 'eventStore1',
          positiveNumber: 1,
        },
      })
    ).resolves.toHaveLength(1);

    expect(storeGet('eventStore1')).toBe(1);
    await delay(100);
    expect(mockObserverApply.mock.calls.length).toBe(1);
  });

  it('should process simple events via submit', async () => {
    const eventStore = await getTestEventStore(testEventFlows, testObservers);

    await expect(
      eventStore.submit(StandardEvent, {
        payload: {
          key: 'eventStore1_submit',
          positiveNumber: 1,
        },
      })
    ).resolves.toHaveLength(1);

    expect(storeGet('eventStore1_submit')).toBe(1);
  });

  it('should reject invalid events', async () => {
    const eventStore = await getTestEventStore(testEventFlows, testObservers);

    await expect(
      StandardEvent.receive(eventStore)({
        payload: {
          key: 'eventStore2',
          positiveNumber: -1,
        },
      })
    ).rejects.toThrow(/Invalid positive number/);

    expect(storeGet('eventStore2')).toBeUndefined();
    expect(mockObserverApply.mock.calls.length).toBe(0);
  });

  it('should process complex events', async () => {
    const eventStore = await getTestEventStore(testEventFlows, testObservers);
    const events = await NestedTwiceEvent.receive(eventStore)({
      payload: {
        key: 'eventStore3',
        positiveNumber: 4,
      },
    });
    await expect(events).toHaveLength(7); // 1 NestedTwice, 2 NestedOnce, 4 Standard

    await delay(100);
    expect(storeGet('eventStore3')).toBe(18);
    expect(mockObserverApply.mock.calls.length).toBe(6);
  });

  it('should cancel done events when invalid', async () => {
    const eventStore = await getTestEventStore(testEventFlows, testObservers);

    await expect(
      NestedTwiceEvent.receive(eventStore)({
        payload: {
          key: 'eventStore4',
          positiveNumber: 1,
        },
      })
    ).rejects.toThrow(/Invalid positive number/);

    expect(storeGet('eventStore4')).toBe(0);
    expect(mockObserverApply.mock.calls.length).toBe(0);
  });

  it('should have a sign to drain side effect queue', async () => {
    const eventStore = await getTestEventStore(testEventFlows, testObservers);

    const p1 = NestedTwiceEvent.receive(eventStore)({
      payload: {
        key: 'eventStore5',
        positiveNumber: 4,
      },
    });

    await delay(10);

    await p1;

    await eventStore.shutdown();

    expect(storeGet('eventStore5')).toBe(18);
  });

  it('should process events using on("processed") correctly without RxJS', async () => {
    const eventStore = await getTestEventStore(testEventFlows, testObservers);
    const observed: any[] = [];

    const unsubscribe = eventStore.on('processed', (output) => {
      if (output.event.payload?.key === 'eventStore-on-test') {
        observed.push(output);
      }
    });

    try {
      await eventStore.submit(StandardEvent, {
        payload: {
          key: 'eventStore-on-test',
          positiveNumber: 3,
        },
      });

      await delay(100);

      expect(storeGet('eventStore-on-test')).toBe(3);
      expect(observed.length).toBe(1);

      // Test unsubscribe
      unsubscribe();

      await eventStore.submit(StandardEvent, {
        payload: {
          key: 'eventStore-on-test',
          positiveNumber: 4,
        },
      });
      await delay(100);

      expect(storeGet('eventStore-on-test')).toBe(7);
      expect(observed.length).toBe(1); // should still be 1 because we unsubscribed
    } finally {
      unsubscribe();
    }
  });

  it('should process events exactly once when multiple subscribers listen to output$', async () => {
    const eventStore = await getTestEventStore(testEventFlows, testObservers);
    const observed: any[] = [];
    const subscription = eventStore.output$.subscribe((entry) => {
      if (entry.event.payload?.key === 'eventStore-multi-sub') {
        observed.push(entry);
      }
    });

    try {
      await StandardEvent.receive(eventStore)({
        payload: {
          key: 'eventStore-multi-sub',
          positiveNumber: 3,
        },
      });

      await delay(100);

      expect(storeGet('eventStore-multi-sub')).toBe(3);
      expect(observed.length).toBeGreaterThan(0);
    } finally {
      subscription.unsubscribe();
    }
  });

  it('should shutdown gracefully', async () => {
    const eventStore = await getTestEventStore(testEventFlows, testObservers);

    // Process an event first
    await StandardEvent.receive(eventStore)({
      payload: { key: 'shutdown-test', positiveNumber: 1 },
    });

    // Shutdown should complete without error
    await expect(eventStore.shutdown(10_000)).resolves.toBeUndefined();
  });
});
