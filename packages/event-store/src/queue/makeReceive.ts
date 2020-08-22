import { makeMainQueue } from './makeMainQueue';
import { BaseEventInput, CreatedEvent, EventFlow, EventTaskAndError } from '../EventStore.types';

export const makeReceive = (mainQueue: ReturnType<typeof makeMainQueue>) => <Payload>(
  eventFlow: EventFlow<Payload>
) => (eventInput: BaseEventInput<Payload>): Promise<[CreatedEvent<Payload>, ...Array<CreatedEvent<any>>]> => {
  const event = Object.assign({}, eventInput, {
    domain: eventFlow.domain,
    type: eventFlow.type
  });
  return new Promise((resolve, reject) => {
    mainQueue.push(event, (err: EventTaskAndError, doneEvents: [CreatedEvent<Payload>, ...Array<CreatedEvent<any>>]) =>
      err ? reject(err.error) : resolve(doneEvents)
    );
  });
};
