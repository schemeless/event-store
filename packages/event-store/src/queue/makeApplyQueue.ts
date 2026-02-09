import { createRxQueue } from './RxQueue';
import type { BaseEvent, CreatedEvent } from '@schemeless/event-store-types';
import { getUlid } from '../util/ulid';

export const makeApplyQueue = () =>
  createRxQueue<{ causalEvent?: CreatedEvent<any>; currentEvent: BaseEvent<any> }, CreatedEvent<any>>(
    'apply:' + getUlid().slice(-4),
    {
      filo: true,
      concurrent: 1,
    }
  );
