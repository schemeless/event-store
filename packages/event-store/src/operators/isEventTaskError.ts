import type { EventTaskAndError } from '@schemeless/event-store-types';

export const isEventTaskError = (eventOrError: unknown): eventOrError is EventTaskAndError => {
  if (!eventOrError || typeof eventOrError !== 'object') {
    return false;
  }
  return 'error' in eventOrError && (eventOrError as EventTaskAndError).error != null;
};
