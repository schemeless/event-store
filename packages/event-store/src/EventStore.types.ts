import { EventStoreService } from './EventStore.service';

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

export interface EventFlow<Payload> {
  domain: string;
  type: string;
  description?: string;

  samplePayload: Payload;

  consequentEventsCreator?: (causalEvent: CreatedEvent<Payload>) => Promise<BaseEvent<any>[]>;
  validator?: (event: CreatedEvent<Payload>) => Promise<Error | void>;
  executor?: (event: CreatedEvent<Payload>) => Promise<void>;
  executorCanceler?: (event: CreatedEvent<Payload>) => Promise<void>;
  sideEffect?: (event: CreatedEvent<Payload>) => Promise<void>;

  receiver: (
    eventStoreService: EventStoreService,
    eventInputArgs: BaseEventInput<Payload>
  ) => Promise<StoredEvent<Payload>>;
}

export interface EventFlowMap {
  [key: string]: EventFlow<any>;
}
