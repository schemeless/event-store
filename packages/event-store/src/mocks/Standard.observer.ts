import { SuccessEventObserver } from '@schemeless/event-store-types';
import { StandardEvent } from './Standard.event';
import { NestedOnceEvent } from './NestedOnce.event';
export const mockObserverApply = jest.fn();

export const StandardObserver: SuccessEventObserver<
  typeof StandardEvent.payloadType | typeof NestedOnceEvent.payloadType
> = {
  filters: [StandardEvent, NestedOnceEvent],
  apply: (event) => {
    mockObserverApply();
  },
};
