import { makeSideEffectQueue } from './makeSideEffectQueue';
import { FailsSideEffectEvent } from '../mocks/FailSideEffect.event';
import { defaultEventCreator } from '../operators/defaultEventCreator';
import { storeSet } from '../mocks/mockStore';
import { SideEffectsState } from '@schemeless/event-store-types';

const spy = jest.spyOn(FailsSideEffectEvent, 'sideEffect');

describe('makeSideEffectQueue', () => {
  it('should retry until fail', (cb) => {
    spy.mockClear();
    const sideEffectQueue = makeSideEffectQueue([FailsSideEffectEvent]);
    sideEffectQueue.processed$.subscribe((r) => {
      if (r.state === SideEffectsState.fail) {
        expect(spy).toBeCalledTimes(4);
        cb();
      }
    });
    storeSet('a', -1);
    sideEffectQueue.push({
      retryCount: 0,
      event: defaultEventCreator({
        domain: FailsSideEffectEvent.domain,
        type: FailsSideEffectEvent.type,
        payload: {
          key: 'a',
          positiveNumber: 1,
        },
      }),
    });
  });

  it('should stop retry when success', (cb) => {
    spy.mockClear();
    const sideEffectQueue = makeSideEffectQueue([FailsSideEffectEvent]);
    sideEffectQueue.processed$.subscribe((r) => {
      if (r.state === SideEffectsState.done) {
        expect(spy).toBeCalledTimes(2);
        cb();
      }
    });
    storeSet('b', -1);
    sideEffectQueue.push(
      {
        retryCount: 0,
        event: defaultEventCreator({
          domain: FailsSideEffectEvent.domain,
          type: FailsSideEffectEvent.type,
          payload: {
            key: 'b',
            positiveNumber: 1,
          },
        }),
      },
      () => {
        storeSet('b', 1);
      }
    );
  });
});
