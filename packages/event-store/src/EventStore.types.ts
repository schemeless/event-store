import { makeMainQueue } from './queue/makeMainQueue';
import { EventStoreRepo } from './repo/EventStore.repo';
import { makeReceive } from './queue/makeReceive';
import { makeReplay } from './makeReplay';
import { Observable } from 'rxjs';

export interface BaseEventInput<Payload, META = undefined> {
  payload: Payload;
  meta?: META;

  identifier?: string;
  trackingId?: string;
  correlationId?: string;
  causationId?: string;
}

export interface BaseEvent<Payload, META = undefined> extends BaseEventInput<Payload, META> {
  domain: string;
  type: string;
  payload: Payload;

  identifier?: string;
  trackingId?: string;
  correlationId?: string;
  causationId?: string;
}

export interface CreatedEvent<Payload, META = undefined> extends BaseEvent<Payload, META> {
  trackingId: string;
  readonly created: Date;
}

export interface StoredEvent<Payload, META = undefined> extends CreatedEvent<Payload, META> {
  readonly id?: number;
}

export type Event<Payload, META = undefined> = StoredEvent<Payload, META>;

export interface EventFlow<PartialPayload = any, Payload extends PartialPayload = PartialPayload> {
  readonly domain: string;
  readonly type: string;
  readonly description?: string;

  readonly meta?: {
    readonly sideEffectFailedRetryAllowed?: number;
  };

  readonly eventType?: CreatedEvent<Payload>;
  readonly payloadType?: PartialPayload | Payload;

  readonly samplePayload?: PartialPayload | Payload;

  readonly receive: (
    eventStore: EventStore
  ) => (
    eventInputArgs: BaseEventInput<PartialPayload>
  ) => Promise<[CreatedEvent<Payload>, ...Array<CreatedEvent<any>>]>;

  readonly validate?: (event: CreatedEvent<Payload>) => Promise<Error | void> | Error | void;

  readonly preApply?: (
    event: CreatedEvent<PartialPayload>
  ) => Promise<CreatedEvent<Payload> | void> | CreatedEvent<Payload> | void;

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

interface EventObserverStaticFilter {
  domain: string;
  type: string;
  state: SideEffectsState | EventOutputState;
}

interface EventObserverFunctionFilter {
  (event: CreatedEvent<any>): Promise<boolean> | boolean;
}

type EventObserverFilter = EventObserverStaticFilter | EventObserverFunctionFilter;

export interface EventObserver<Payload> {
  filters: EventObserverFilter[];

  readonly apply?: (event: CreatedEvent<Payload>) => Promise<void> | void;

  readonly sideEffect?: (event: CreatedEvent<Payload>) => Promise<void> | void;

  readonly cancelApply?: (event: CreatedEvent<Payload>) => Promise<void> | void;
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
