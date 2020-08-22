import { BaseEvent, BaseEventInput, CreatedEvent, EventFlow, StoredEvent } from '../EventStore.types';
import { StandardEvent } from './standard.event';

const testObject = {
  sum: 0
};

const DOMAIN = 'test';
const TYPE = 'nestedOnce';

interface Payload {
  positiveNumber: number;
}

export const NestedOnceEvent: EventFlow<Payload> = {
  domain: DOMAIN,
  type: TYPE,
  samplePayload: {
    positiveNumber: 1
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
        positiveNumber: causalEvent.payload.positiveNumber - 1
      }
    };
    return [standardEvent, standardEvent];
  },

  sideEffect(event: CreatedEvent<Payload>) {
    console.log('sideEffect called');
  },

  receive: eventStore => eventInputArgs => eventStore.receive(NestedOnceEvent)(eventInputArgs)
};
