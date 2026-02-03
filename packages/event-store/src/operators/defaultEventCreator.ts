import type { BaseEvent, CreatedEvent } from '@schemeless/event-store-types';
import { getUlid } from '../util/ulid';

const dateDefault = (date: string | Date | undefined): Date => {
  if (!date) return new Date();
  return typeof date === 'string' ? new Date(date) : date;
};

export function defaultEventCreator<Payload>(
  eventArgs: BaseEvent<Payload>,
  causalEvent?: CreatedEvent<any>
): CreatedEvent<Payload> {
  // Deprecation warning for manually set causationId
  if (eventArgs.causationId !== undefined) {
    console.warn(
      '[event-store] Manual causationId is deprecated and will be ignored in v3.0. ' +
        'The framework now manages this field automatically via createConsequentEvents and sideEffect hooks.'
    );
  }

  const id = getUlid();
  return {
    ...eventArgs,
    id,
    // v2.x: Still respect manual value for backwards compatibility
    // v3.0: Will ignore eventArgs.causationId completely
    causationId: eventArgs.causationId ?? (causalEvent ? causalEvent.id : undefined),
    correlationId: eventArgs.correlationId || (causalEvent ? causalEvent.correlationId || causalEvent.id : id),
    identifier: eventArgs.identifier || (causalEvent ? causalEvent.identifier : undefined),

    created: dateDefault(eventArgs.created),
  };
}
