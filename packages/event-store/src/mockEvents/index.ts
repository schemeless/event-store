import { StandardEvent } from './standard.event';
import { NestedOnceEvent } from './NestedOnce.event';
import { NestedTwiceEvent } from './NestedTwice.event';
export { StandardEvent } from './standard.event';
export { NestedOnceEvent } from './NestedOnce.event';
export { NestedTwiceEvent } from './NestedTwice.event';
import { EventFlow } from '../EventStore.types';
import { FailsSideEffectEvent } from './FailSideEffect.event';

export const testEventFlows: EventFlow<any>[] = [
  StandardEvent,
  NestedOnceEvent,
  NestedTwiceEvent,
  FailsSideEffectEvent
];
