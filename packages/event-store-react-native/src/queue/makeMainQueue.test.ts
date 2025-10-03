import { makeMainQueue } from './makeMainQueue';
import { StandardEvent } from '../mocks/Standard.event';
import { NestedOnceEvent } from '../mocks/NestedOnce.event';
import { NestedTwiceEvent } from '../mocks/NestedTwice.event';

describe('Main Queue', () => {
  it('should run', (cb) => {
    const mainQueue = makeMainQueue([StandardEvent, NestedOnceEvent, NestedTwiceEvent]);
    mainQueue.processed$.subscribe();
    mainQueue.push({
      domain: NestedTwiceEvent.domain,
      type: NestedTwiceEvent.type,
      payload: { key: 'MainQueue1', positiveNumber: 1 },
    });
    mainQueue.push(
      {
        domain: NestedOnceEvent.domain,
        type: NestedOnceEvent.type,
        payload: { key: 'MainQueue2', positiveNumber: 1 },
      },
      (err, result) => {
        cb();
      }
    );
  });
});
