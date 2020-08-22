import { makeMainQueue } from './makeMainQueue';
import { StandardEvent } from '../mockEvents/Standard.event';
import { NestedOnceEvent } from '../mockEvents/NestedOnce.event';
import { NestedTwiceEvent } from '../mockEvents/NestedTwice.event';

describe('Main Queue', () => {
  it('should run', cb => {
    const mainQueue = makeMainQueue([StandardEvent, NestedOnceEvent, NestedTwiceEvent]);
    mainQueue.processed$.subscribe();
    mainQueue.push({
      domain: NestedTwiceEvent.domain,
      type: NestedTwiceEvent.type,
      payload: { positiveNumber: 1 }
    });
    mainQueue.push(
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
