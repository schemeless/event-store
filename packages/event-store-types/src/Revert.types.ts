import type { CreatedEvent } from './EventStore.types';

/**
 * Result of canRevert() check
 */
export interface CanRevertResult {
  /** Whether the event can be reverted */
  canRevert: boolean;
  /** Reason why revert is not possible (if canRevert is false) */
  reason?: string;
  /** Events missing the 'compensate' hook */
  missingCompensateEvents?: Array<{
    id: string;
    domain: string;
    type: string;
  }>;
}

/**
 * Result of previewRevert() - shows what would be affected
 */
export interface PreviewRevertResult {
  /** The root event that would be reverted */
  rootEvent: CreatedEvent<any>;
  /** All descendant events that would be reverted */
  descendantEvents: CreatedEvent<any>[];
  /** Total count of events affected */
  totalEventCount: number;
}

/**
 * Result of a successful revert() operation
 */
export interface RevertResult {
  /** ID of the event that was reverted */
  revertedEventId: string;
  /** Compensating events generated for this event */
  compensatingEvents: CreatedEvent<any>[];
  /** Revert results for child events */
  childResults: RevertResult[];
}
