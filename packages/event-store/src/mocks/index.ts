import { StandardEvent } from './standard.event';
import { NestedOnceEvent } from './NestedOnce.event';
import { NestedTwiceEvent } from './NestedTwice.event';
import { StandardObserver } from './Standard.observer';
export { StandardEvent } from './standard.event';
export { NestedOnceEvent } from './NestedOnce.event';
export { NestedTwiceEvent } from './NestedTwice.event';
export { StandardObserver } from './Standard.observer';
import { EventFlow, SuccessEventObserver } from '@schemeless/event-store-types';
import { FailsSideEffectEvent } from './FailSideEffect.event';

export const testEventFlows: EventFlow<any>[] = [
  StandardEvent,
  NestedOnceEvent,
  NestedTwiceEvent,
  FailsSideEffectEvent,
];

export const testObservers: SuccessEventObserver<any>[] = [StandardObserver];
