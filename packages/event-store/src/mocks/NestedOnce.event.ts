import { BaseEvent, BaseEventInput, CreatedEvent, EventFlow, StoredEvent } from '@schemeless/event-store-types';
import { StandardEvent } from './standard.event';
import { storeGet, storeSet } from './mockStore';

const DOMAIN = 'test';
const TYPE = 'nestedOnce';

interface Payload {
  key: string;
  positiveNumber: number;
}

export const NestedOnceEvent: EventFlow<Payload> = {
  domain: DOMAIN,
  type: TYPE,
  samplePayload: {
    key: 'a',
    positiveNumber: 1,
  },

  async validate(event: CreatedEvent<Payload>) {
    if (event.payload.positiveNumber < 0) {
      throw new Error(`Invalid positive number`);
    }
  },

  createConsequentEvents(causalEvent) {
    const standardEvent: BaseEvent<typeof StandardEvent.samplePayload> = {
      domain: StandardEvent.domain,
      type: StandardEvent.type,
      payload: {
        key: causalEvent.payload.key,
        positiveNumber: causalEvent.payload.positiveNumber - 1,
      },
    };
    return [standardEvent, standardEvent];
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

  receive: (eventStore) => (eventInputArgs) => eventStore.receive(NestedOnceEvent)(eventInputArgs),
};
