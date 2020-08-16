import { BaseEvent, CreatedEvent, EventFlow } from '../EventStore.types';
import { NestedOnceEvent } from './NestedOnce.event';

const testObject = {
  sum: 0
};

const DOMAIN = 'test';
const TYPE = 'nestedTwice';

interface Payload {
  positiveNumber: number;
}

export const NestedTwiceEvent: EventFlow<Payload> = {
  domain: DOMAIN,
  type: TYPE,
  samplePayload: {
    positiveNumber: 1
  },

  async validator(event: CreatedEvent<Payload>) {
    if (event.payload.positiveNumber < 0) {
      throw new Error(`Invalid positive number`);
    }
  },

  consequentEventsCreator(causalEvent) {
    const nestedOnceEvent: BaseEvent<typeof NestedOnceEvent.samplePayload> = {
      domain: NestedOnceEvent.domain,
      type: NestedOnceEvent.type,
      payload: {
        positiveNumber: causalEvent.payload.positiveNumber - 1
      }
    };
    return [nestedOnceEvent, nestedOnceEvent];
  },

  sideEffect(event: CreatedEvent<Payload>) {
    console.log('sideEffect called');
  },

  receiver: eventStore => eventInputArgs => eventStore.receiver(NestedTwiceEvent)(eventInputArgs)
};