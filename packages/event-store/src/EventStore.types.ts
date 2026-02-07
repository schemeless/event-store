import type { Observable } from 'rxjs';
import type {
  CanRevertResult,
  CreatedEvent,
  EventObserverState,
  EventOutputState,
  IEventStoreEntity,
  IEventStoreRepo,
  PreviewRevertResult,
  RevertResult,
  SideEffectsState,
} from '@schemeless/event-store-types';

import { makeMainQueue } from './queue/makeMainQueue';
import { makeReceive } from './queue/makeReceive';
import { makeReplay } from './makeReplay';
import { makeSideEffectQueue } from './queue/makeSideEffectQueue';

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

export interface EventStore {
  mainQueue: ReturnType<typeof makeMainQueue>;
  sideEffectQueue: ReturnType<typeof makeSideEffectQueue>;
  receive: ReturnType<typeof makeReceive>;
  replay: ReturnType<typeof makeReplay>;
  eventStoreRepo: IEventStoreRepo;
  output$: Observable<EventOutput>;

  /**
   * Load aggregate state by replaying events (with optional snapshot optimization).
   * Requires repo.getStreamEvents to be implemented.
   *
   * @throws Error if repo.getStreamEvents is not implemented
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
