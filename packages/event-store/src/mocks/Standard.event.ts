import type { CreatedEvent, EventFlow } from '@schemeless/event-store-types';
import { storeGet, storeSet } from './mockStore';

const DOMAIN = 'test';
const TYPE = 'standard';

interface Payload {
  key: string;
  positiveNumber: number;
}

function wait(ms = 1000, value = null) {
  return new Promise((resolve) => setTimeout(resolve, ms, value));
}

export const StandardEvent: EventFlow<Payload> = {
  domain: DOMAIN,
  type: TYPE,
  samplePayload: {
    key: 's',
    positiveNumber: 1,
  },

  async validate(event: CreatedEvent<Payload>) {
    if (event.payload.positiveNumber < 0) {
      return new Error(`Invalid positive number`);
    }
  },

  async apply(event: CreatedEvent<Payload>) {
    await wait(10);
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

  receive: (eventStore) => (eventInputArgs) => {
    return eventStore.receive(StandardEvent)(eventInputArgs);
  },
};
