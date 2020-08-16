import { makeMainQueue } from './MakeMainQueue';
import { StandardEvent } from './mockEvents/standard.event';
import { NestedOnceEvent } from './mockEvents/NestedOnce.event';
import { NestedTwiceEvent } from './mockEvents/NestedTwice.event';

describe('Event Store', () => {
  it('should run', cb => {
    const eventStore = makeMainQueue([StandardEvent, NestedOnceEvent, NestedTwiceEvent]);
    eventStore.processed$.subscribe();
    eventStore.push({
      domain: NestedTwiceEvent.domain,
      type: NestedTwiceEvent.type,
      payload: { positiveNumber: 1 }
    });
    eventStore.push(
      {
        domain: NestedOnceEvent.domain,
        type: NestedOnceEvent.type,
        payload: { positiveNumber: 1 }
      },
      (err, result) => {
        console.log(err, result);
        cb();
      }
    );
  });
});
