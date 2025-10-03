import type { BaseEvent, CreatedEvent, EventFlow } from '@schemeless/event-store-types';
import { NestedOnceEvent } from './NestedOnce.event';
import { storeGet, storeSet } from './mockStore';

const testObject = {
  sum: 0,
};

const DOMAIN = 'test';
const TYPE = 'nestedTwice';

interface Payload {
  key: string;
  positiveNumber: number;
}

export const NestedTwiceEvent: EventFlow<Payload> = {
  domain: DOMAIN,
  type: TYPE,
  samplePayload: {
    key: 's',
    positiveNumber: 1,
  },

  async validate(event: CreatedEvent<Payload>) {
    if (event.payload.positiveNumber < 0) {
      throw new Error(`Invalid positive number`);
    }
  },

  createConsequentEvents(causalEvent) {
    const nestedOnceEvent: BaseEvent<typeof NestedOnceEvent.samplePayload> = {
      domain: NestedOnceEvent.domain,
      type: NestedOnceEvent.type,
      payload: {
        key: causalEvent.payload.key,
        positiveNumber: causalEvent.payload.positiveNumber - 1,
      },
    };
    return [nestedOnceEvent, nestedOnceEvent];
  },

  async apply(event: CreatedEvent<Payload>) {
    const num = storeGet(event.payload.key) || 0;
    storeSet(event.payload.key, num + event.payload.positiveNumber);
  },

  cancelApply(event: CreatedEvent<Payload>) {
    const num = storeGet(event.payload.key) || 0;
    storeSet(event.payload.key, num - event.payload.positiveNumber);
  },

  sideEffect(event: CreatedEvent<Payload>) {
    console.log('sideEffect called');
  },

  receive: (eventStore) => (eventInputArgs) => eventStore.receive(NestedTwiceEvent)(eventInputArgs),
};
