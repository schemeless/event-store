import type { CreatedEvent, EventTaskAndError } from '@schemeless/event-store-types';

export const isEventTaskError = (
  eventOrError: CreatedEvent<any> | EventTaskAndError
): eventOrError is EventTaskAndError => (eventOrError as EventTaskAndError).error != null;
