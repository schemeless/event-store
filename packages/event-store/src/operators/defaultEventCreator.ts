import type { BaseEvent, CreatedEvent } from '@schemeless/event-store-types';
import { getUlid } from '../util/ulid';

export function defaultEventCreator<Payload>(
  eventArgs: BaseEvent<Payload>,
  causalEvent?: CreatedEvent<any>
): CreatedEvent<Payload> {
  const id = getUlid();
  return {
    ...eventArgs,
    id,
    causationId: eventArgs.causationId || causalEvent ? causalEvent.id : undefined,
    correlationId: eventArgs.correlationId || (causalEvent ? causalEvent.correlationId || causalEvent.id : id),
    identifier: eventArgs.identifier || (causalEvent ? causalEvent.identifier : undefined),

    created: new Date(),
  };
}
