import type { BaseEvent, CreatedEvent } from '@schemeless/event-store-types';
import { v4 as uuid } from 'uuid';

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

    created: new Date(),
  };
}
