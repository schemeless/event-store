import { createRxQueue } from './RxQueue';
import { BaseEvent, CreatedEvent } from '../EventStore.types';
import * as uuid from 'uuid/v4';

export const makeApplyQueue = () =>
  createRxQueue<{ causalEvent?: CreatedEvent<any>; currentEvent: BaseEvent<any> }, CreatedEvent<any>>(
    'apply:' + uuid().substr(-4, 4),
    {
      filo: true,
      concurrent: 1
    }
  );
