import { getTestEventStore } from './util/testHelpers';
import { NestedTwiceEvent, StandardEvent, testEventFlows } from './mockEvents';

describe('make eventStore', () => {
  it('should run', async cb => {
    const eventStore = await getTestEventStore(testEventFlows);
    const result = await StandardEvent.receiver(eventStore)({ payload: { positiveNumber: -1 } });
    console.log(result);
  });
});
