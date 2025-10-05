import { createRxQueue } from './RxQueue';
import type { BaseEvent, CreatedEvent } from '@schemeless/event-store-types';
const randomSuffix = () => Math.random().toString(36).substring(2, 6).padEnd(4, '0');

export const makeApplyQueue = () =>
  createRxQueue<{ causalEvent?: CreatedEvent<any>; currentEvent: BaseEvent<any> }, CreatedEvent<any>>(
    'apply:' + randomSuffix(),
    {
      filo: true,
      concurrent: 1,
    }
  );
