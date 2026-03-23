import type { AppendableEvent, BaseEvent, PersistedEvent } from '@schemeless/event-store-types';

export type { RevertableEventStoreAdapter } from '@schemeless/event-store-types';

export type CompensationFn<P = any> = (event: PersistedEvent<P>) => BaseEvent | BaseEvent[];

export interface CompensationRegistry {
  register(domain: string, type: string, fn: CompensationFn): void;
  get(domain: string, type: string): CompensationFn | undefined;
}

export interface CanRevertResult {
  canRevert: boolean;
  blockedBy?: Array<{ eventId: string; domain: string; type: string; reason: string }>;
}

export interface PreviewRevertResult {
  rootEvent: PersistedEvent;
  descendantEvents: PersistedEvent[];
}

export interface RevertResult {
  compensatingEvents: AppendableEvent[];
}

export interface EventStoreRevert {
  canRevert(eventId: string): Promise<CanRevertResult>;
  previewRevert(eventId: string): Promise<PreviewRevertResult>;
  revert(eventId: string): Promise<RevertResult>;
}
