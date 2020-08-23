import { getTestEventStore } from './util/testHelpers';
import { NestedTwiceEvent, StandardEvent, testEventFlows } from './mockEvents';
import { storeGet } from './mockEvents/mockStore';

describe('make eventStore', () => {
  it('should process simple events', async () => {
    const eventStore = await getTestEventStore(testEventFlows);

    await expect(
      StandardEvent.receive(eventStore)({
        payload: {
          key: 'eventStore1',
          positiveNumber: 1
        }
      })
    ).resolves.toHaveLength(1);

    expect(storeGet('eventStore1')).toBe(1);
  });

  it('should reject invalid events', async () => {
    const eventStore = await getTestEventStore(testEventFlows);

    await expect(
      StandardEvent.receive(eventStore)({
        payload: {
          key: 'eventStore2',
          positiveNumber: -1
        }
      })
    ).rejects.toThrowError(/Invalid positive number/);

    expect(storeGet('eventStore2')).toBeUndefined();
  });

  it('should process complex events', async () => {
    const eventStore = await getTestEventStore(testEventFlows);
    const events = await NestedTwiceEvent.receive(eventStore)({
      payload: {
        key: 'eventStore3',
        positiveNumber: 4
      }
    });
    await expect(events).toHaveLength(7); // 1 NestedTwice, 2 NestedOnce, 4 Standard

    expect(storeGet('eventStore3')).toBe(18);
  });

  it('should cancel done events when invalid', async () => {
    const eventStore = await getTestEventStore(testEventFlows);

    await expect(
      NestedTwiceEvent.receive(eventStore)({
        payload: {
          key: 'eventStore4',
          positiveNumber: 1
        }
      })
    ).rejects.toThrowError(/Invalid positive number/);

    expect(storeGet('eventStore4')).toBe(0);
  });
});
