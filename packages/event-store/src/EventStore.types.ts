import { EventStore } from './makeEventStore';

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

export interface EventFlow<Payload = any> {
  domain: string;
  type: string;
  description?: string;

  samplePayload: Payload;

  consequentEventsCreator?: (causalEvent: CreatedEvent<Payload>) => Promise<BaseEvent<any>[]> | BaseEvent<any>[];
  validator?: (event: CreatedEvent<Payload>) => Promise<Error | void> | Error | void;
  executor?: (event: CreatedEvent<Payload>) => Promise<void> | void;
  executorCanceler?: (event: CreatedEvent<Payload>) => Promise<void> | void;
  sideEffect?: (event: CreatedEvent<Payload>) => Promise<void> | void;

  receiver: (
    eventStore: EventStore
  ) => (eventInputArgs: BaseEventInput<Payload>) => Promise<[CreatedEvent<Payload>, ...Array<CreatedEvent<any>>]>;
}

export type EventTaskAndError = { task: CreatedEvent<any>; error: Error };

export interface EventFlowMap {
  [key: string]: EventFlow<any>;
}
export type EventFlowAndEvent<Payload = any> = { eventFlow: EventFlow<Payload>; event: CreatedEvent<Payload> };
