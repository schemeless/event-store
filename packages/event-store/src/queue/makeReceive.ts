import { BaseEventInput, CreatedEvent, EventFlow, EventTaskAndError } from '@schemeless/event-store-types';
import { makeMainQueue } from './makeMainQueue';

export const makeReceive = (mainQueue: ReturnType<typeof makeMainQueue>) => <
  PartialPayload,
  Payload extends PartialPayload
>(
  eventFlow: EventFlow<PartialPayload, Payload>
) => (eventInput: BaseEventInput<PartialPayload>): Promise<[CreatedEvent<Payload>, ...Array<CreatedEvent<any>>]> => {
  const event = Object.assign({}, eventInput, {
    domain: eventFlow.domain,
    type: eventFlow.type,
  });
  return new Promise((resolve, reject) => {
    mainQueue.push(event, (err: EventTaskAndError, doneEvents: [CreatedEvent<Payload>, ...Array<CreatedEvent<any>>]) =>
      err ? reject(err.error) : resolve(doneEvents)
    );
  });
};
