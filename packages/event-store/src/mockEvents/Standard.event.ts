import { CreatedEvent, EventFlow } from '../EventStore.types';

export const testObject = {
  sum: 0
};

const DOMAIN = 'test';
const TYPE = 'standard';

interface Payload {
  positiveNumber: number;
}

function wait(ms = 1000, value = null) {
  return new Promise(resolve => setTimeout(resolve, ms, value));
}

export const StandardEvent: EventFlow<Payload> = {
  domain: DOMAIN,
  type: TYPE,
  samplePayload: {
    positiveNumber: 1
  },

  async validate(event: CreatedEvent<Payload>) {
    if (event.payload.positiveNumber < 0) {
      return new Error(`Invalid positive number`);
    }
  },

  async apply(event: CreatedEvent<Payload>) {
    await wait(10);
    testObject.sum += event.payload.positiveNumber;
  },

  cancelApply(event: CreatedEvent<Payload>) {
    testObject.sum -= event.payload.positiveNumber;
  },

  sideEffect(event: CreatedEvent<Payload>) {
    console.log('sideEffect called');
  },

  receive: eventStore => eventInputArgs => {
    console.log(eventInputArgs);
    return eventStore.receive(StandardEvent)(eventInputArgs);
  }
};
