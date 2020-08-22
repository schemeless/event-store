import { CreatedEvent, EventTaskAndError } from '../EventStore.types';

export const isEventTaskError = (
  eventOrError: CreatedEvent<any> | EventTaskAndError
): eventOrError is EventTaskAndError => (eventOrError as EventTaskAndError).error != null;
