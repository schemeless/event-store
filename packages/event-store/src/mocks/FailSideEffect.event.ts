import { CreatedEvent, EventFlow } from '../EventStore.types';
import { storeGet } from './mockStore';

const DOMAIN = 'test';
const TYPE = 'failSideEffect';

interface Payload {
  key: string;
  positiveNumber: number;
}

export const FailsSideEffectEvent: EventFlow<Payload> = {
  domain: DOMAIN,
  type: TYPE,
  samplePayload: {
    key: '1',
    positiveNumber: 1
  },

  meta: {
    sideEffectFailedRetryAllowed: 3
  },

  async validate(event: CreatedEvent<Payload>) {
    if (event.payload.positiveNumber < 0) {
      return new Error(`Invalid positive number`);
    }
  },

  async sideEffect(event: CreatedEvent<Payload>) {
    const num = storeGet(event.payload.key);
    if (num < 0) {
      throw new Error(`sideEffect Error`);
    }
  },

  receive: eventStore => eventInputArgs => eventStore.receive(FailsSideEffectEvent)(eventInputArgs)
};
