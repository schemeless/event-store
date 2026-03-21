import type { Observable } from 'rxjs';
import type {
  BaseEventInput,
  CanRevertResult,
  CreatedEvent,
  EventFlow,
  EventObserverState,
  EventOutputState,
  IEventStoreEntity,
  IEventStoreRepo,
  PreviewRevertResult,
  RevertResult,
  SideEffectsState,
} from '@schemeless/event-store-types';

import { makeReplay } from './makeReplay';

export interface EventOutput<Payload = any> {
  state: SideEffectsState | EventOutputState | EventObserverState;
  error?: Error;
  event: CreatedEvent<Payload>;
}

export interface AggregateResult<State> {
  state: State;
  sequence: number;
}

export interface EventStoreOptions {
  /**
   * Concurrency for the main event queue.
   * @default 1 (sequential processing to maintain event ordering)
   */
  mainQueueConcurrent?: number;

  /**
   * Concurrency for the side effect queue.
   * @default 1
   */
  sideEffectQueueConcurrent?: number;

  /**
   * Concurrency for the observer queue.
   * @default 1
   */
  observerQueueConcurrent?: number;
}

export interface EventStoreCapabilities {
  /**
   * Indicates whether getAggregate is available for this repository.
   */
  aggregate: boolean;
}

export interface EventStore {
  /**
   * @deprecated Internal implementation detail. Do not use directly.
   * Use `submit()` for sending events and `on('processed', handler)` for notifications.
   * Will be removed in v5.
   */
  mainQueue: any;

  /**
   * @deprecated Internal implementation detail. Do not use directly.
   * Will be removed in v5.
   */
  sideEffectQueue: any;

  /**
   * @deprecated Use `submit(flow, input)` instead. Will be removed in v5.
   */
  receive: <PartialPayload, Payload extends PartialPayload>(
    flow: EventFlow<PartialPayload, Payload>
  ) => (input: BaseEventInput<PartialPayload>) => Promise<[CreatedEvent<Payload>, ...Array<CreatedEvent<any>>]>;


  /**
   * Submit an event for processing. This is the preferred API over `receive`.
   * Validates, applies, persists, runs side effects, and notifies observers.
   *
   * @param flow - The EventFlow definition for this event type
   * @param input - The event input (payload, identifier, etc.)
   * @returns All created events (root + consequent events)
   * @throws ValidationError if validation fails
   */
  submit: <PartialPayload, Payload extends PartialPayload>(
    flow: EventFlow<PartialPayload, Payload>,
    input: BaseEventInput<PartialPayload>
  ) => Promise<[CreatedEvent<Payload>, ...Array<CreatedEvent<any>>]>;

  replay: ReturnType<typeof makeReplay>;
  eventStoreRepo: IEventStoreRepo;
  capabilities: EventStoreCapabilities;

  /**
   * @deprecated Use `on('processed', handler)` instead. Will be removed in v5.
   * Requires RxJS subscription.
   */
  output$: Observable<EventOutput>;

  /**
   * Subscribe to event processing notifications.
   * Alternative to output$ that doesn't require RxJS.
   *
   * @returns Unsubscribe function
   */
  on: (event: 'processed', handler: (output: EventOutput) => void) => () => void;

  /**
   * Load aggregate state by replaying events (with optional snapshot optimization).
   * Requires aggregate capability support from the repo.
   *
   * @throws Error if aggregate replay is not supported by the adapter
   */
  getAggregate: <State>(
    domain: string,
    identifier: string,
    reducer: (state: State, event: IEventStoreEntity) => State,
    initialState: State
  ) => Promise<AggregateResult<State>>;

  /**
   * Checks if an event and all its descendants can be reverted.
   * Returns information about missing compensate hooks.
   */
  canRevert: (eventId: string) => Promise<CanRevertResult>;

  /**
   * Preview which events would be affected by a revert operation.
   * Does not execute any changes.
   */
  previewRevert: (eventId: string) => Promise<PreviewRevertResult>;

  /**
   * Reverts a root event and all its descendants.
   * Generates compensating events for each reverted event.
   *
   * @throws Error if the event is not a root event or any event lacks a compensate hook
   */
  revert: (eventId: string) => Promise<RevertResult>;

  /**
   * Gracefully shuts down the event store.
   * - Stops accepting new events
   * - Waits for queued events to complete (up to timeout)
   * - Releases all resources
   *
   * @param timeout - Maximum time to wait for shutdown in ms (default: 5000)
   * @throws Error if shutdown times out
   */
  shutdown: (timeout?: number) => Promise<void>;
}

export * from '@schemeless/event-store-types';
