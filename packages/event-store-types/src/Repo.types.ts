import type { CreatedEvent, EventMeta } from './EventStore.types';

export interface PersistedEvent<Payload = any, META extends EventMeta = EventMeta> extends CreatedEvent<Payload, META> {
  sequence?: number;
}

export interface Snapshot<State = any> {
  domain: string;
  identifier: string;
  state: State;
  sequence: number;
  created: Date;
}

export interface EventStoreAdapter {
  init(): Promise<void>;
  close?(): Promise<void>;
  append(events: PersistedEvent[]): Promise<void>;
  getAllEvents(pageSize?: number, startFromId?: string): Promise<AsyncIterableIterator<Array<PersistedEvent>>>;
  reset?(): Promise<void>;
}

export interface StreamEventStoreAdapter extends EventStoreAdapter {
  getStreamEvents(domain: string, identifier: string, fromSequence?: number): Promise<PersistedEvent[]>;
  appendToStream(events: PersistedEvent[], expectedVersion: number): Promise<{ nextVersion: number }>;
  getSnapshot?<State>(domain: string, identifier: string): Promise<Snapshot<State> | null>;
  saveSnapshot?<State>(snapshot: Snapshot<State>): Promise<void>;
  capabilities: {
    streamQuery: true;
    optimisticConcurrency: true;
    snapshot?: boolean;
  };
}

export interface RevertableEventStoreAdapter {
  getEventById(id: string): Promise<PersistedEvent | null>;
  findByCausationId(causationId: string): Promise<PersistedEvent[]>;
  append(events: PersistedEvent[]): Promise<void>;
}
