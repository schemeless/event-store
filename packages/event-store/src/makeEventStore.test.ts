import { getTestEventStore } from './util/testHelpers';
import { NestedTwiceEvent, StandardEvent, testEventFlows } from './mockEvents';

describe('make eventStore', () => {
  it('should run', async cb => {
    const eventStore = await getTestEventStore(testEventFlows);
    await expect(StandardEvent.receive(eventStore)({ payload: { positiveNumber: 1 } })).resolves.toHaveLength(1);
    await expect(StandardEvent.receive(eventStore)({ payload: { positiveNumber: -1 } })).rejects.toThrowError(
      /Invalid positive number/
    );
    cb();
  });
});
