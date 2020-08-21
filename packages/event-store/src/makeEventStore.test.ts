import { getTestEventStore } from './util/testHelpers';
import { NestedTwiceEvent, StandardEvent, testEventFlows } from './mockEvents';

describe('make eventStore', () => {
  it('should run', async cb => {
    const eventStore = await getTestEventStore(testEventFlows);

    await expect(StandardEvent.receiver(eventStore)({ payload: { positiveNumber: -1 } })).rejects.toThrowError(
      /Account is not exist - wwwwwwww-wwww-wwww-wwww-wwwwwwwwwwww/
    );
  });
});
