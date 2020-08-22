import { makeMainQueue } from './queue/makeMainQueue';
import { EventStoreRepo } from './repo/EventStore.repo';
import { makeReceive } from './queue/makeReceive';
import { makeReplay } from './makeReplay';
import { Observable } from 'rxjs';

export interface BaseEventInput<Payload> {
  payload: Payload;

  identifier?: string;
  trackingId?: string;
  correlationId?: string;
  causationId?: string;
}

export interface BaseEvent<Payload> extends BaseEventInput<Payload> {
  domain: string;
  type: string;
  payload: Payload;

  identifier?: string;
  trackingId?: string;
  correlationId?: string;
  causationId?: string;
}

export interface CreatedEvent<Payload> extends BaseEvent<Payload> {
  trackingId: string;
  readonly created: Date;
}

export interface StoredEvent<Payload> extends CreatedEvent<Payload> {
  readonly id?: number;
}

export type Event<Payload> = StoredEvent<Payload>;

export interface EventFlow<PartialPayload = any, Payload extends PartialPayload = PartialPayload> {
  readonly domain: string;
  readonly type: string;
  readonly description?: string;

  readonly meta?: {
    readonly sideEffectFailedRetryAllowed?: number;
  };

  readonly samplePayload: PartialPayload | Payload;

  readonly receive: (
    eventStore: EventStore
  ) => (
    eventInputArgs: BaseEventInput<PartialPayload>
  ) => Promise<[CreatedEvent<Payload>, ...Array<CreatedEvent<any>>]>;

  readonly validate?: (event: CreatedEvent<Payload>) => Promise<Error | void> | Error | void;

  readonly preApply?: (event: CreatedEvent<Payload>) => Promise<CreatedEvent<Payload> | void> | Promise<void> | void;
  readonly apply?: (event: CreatedEvent<Payload>) => Promise<void> | void;
  readonly sideEffect?: (event: CreatedEvent<Payload>) => Promise<void> | void;

  readonly cancelApply?: (event: CreatedEvent<Payload>) => Promise<void> | void;

  readonly createConsequentEvents?: (
    causalEvent: CreatedEvent<Payload>
  ) => Promise<BaseEvent<any>[]> | BaseEvent<any>[];
}

export type EventTaskAndError = { task: CreatedEvent<any>; error: Error };

export interface EventFlowMap {
  [key: string]: EventFlow;
}

export interface EventStore {
  mainQueue: ReturnType<typeof makeMainQueue>;
  eventStoreRepo: EventStoreRepo;
  receive: ReturnType<typeof makeReceive>;
  replay: ReturnType<typeof makeReplay>;
  output$: Observable<EventStoreOutput>;
}

export enum SideEffectsState {
  done = 'SideEffects:done',
  retry = 'SideEffects:retry',
  fail = 'SideEffects:fail'
}

export enum EventOutputState {
  done = 'Event:done',
  invalid = 'Event:invalid',
  canceled = 'Event:canceled'
}

export interface EventStoreOutput {
  state: SideEffectsState | EventOutputState;
  error?: Error;
  event: CreatedEvent<any>;
}
