export interface EventMeta {
  schemaVersion?: number;
  [key: string]: any;
}

export interface BaseEventInput<Payload = any, META extends EventMeta = EventMeta> {
  payload: Payload;
  meta?: META;
  identifier?: string;
  correlationId?: string;
  causationId?: string;
  created?: Date;
}

export interface BaseEvent<Payload = any, META extends EventMeta = EventMeta> extends BaseEventInput<Payload, META> {
  id?: string;
  domain: string;
  type: string;
}

export interface CreatedEvent<Payload = any, META extends EventMeta = EventMeta> extends BaseEvent<Payload, META> {
  id: string;
  created: Date;
}

export interface StoredEvent<Payload = any, META extends EventMeta = EventMeta> extends CreatedEvent<Payload, META> {
  sequence?: number;
}

export type Event<Payload, META extends EventMeta = EventMeta> = StoredEvent<Payload, META>;
