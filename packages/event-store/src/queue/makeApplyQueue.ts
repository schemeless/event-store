import { createRxQueue } from './RxQueue';
import { BaseEvent, CreatedEvent } from '@schemeless/event-store-types';
import { v4 as uuid } from 'uuid';

export const makeApplyQueue = () =>
  createRxQueue<{ causalEvent?: CreatedEvent<any>; currentEvent: BaseEvent<any> }, CreatedEvent<any>>(
    'apply:' + uuid().substr(-4, 4),
    {
      filo: true,
      concurrent: 1,
    }
  );
