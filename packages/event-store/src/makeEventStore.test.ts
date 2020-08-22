import { getTestEventStore } from './util/testHelpers';
import { NestedTwiceEvent, StandardEvent, testEventFlows } from './mockEvents';

describe('make eventStore', () => {
  it('should run', async cb => {
    const eventStore = await getTestEventStore(testEventFlows);
    // const a = await StandardEvent.receive(eventStore)({ payload: { positiveNumber: -1 } })
    // console.loga9
    await expect(StandardEvent.receive(eventStore)({ payload: { positiveNumber: -1 } })).rejects.toThrowError(
      /Invalid positive number/
    );
    cb();
  });
});
