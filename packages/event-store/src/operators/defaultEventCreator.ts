import { BaseEvent, CreatedEvent } from '../EventStore.types';
import * as uuid from 'uuid/v4';

export function defaultEventCreator<Payload>(
  eventArgs: BaseEvent<Payload>,
  causalEvent?: CreatedEvent<any>
): CreatedEvent<Payload> {
  const thisTrackingId = eventArgs.trackingId || uuid();
  return {
    ...eventArgs,

    trackingId: thisTrackingId,
    causationId: eventArgs.causationId || causalEvent ? causalEvent.trackingId : undefined,
    correlationId:
      eventArgs.correlationId || (causalEvent ? causalEvent.correlationId || causalEvent.trackingId : thisTrackingId),
    identifier: eventArgs.identifier || (causalEvent ? causalEvent.identifier : undefined),

    created: new Date()
  };
}
