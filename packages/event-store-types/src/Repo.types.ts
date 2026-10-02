import type { CreatedEvent, EventMeta } from './EventStore.types';

export interface PersistedEvent<Payload = any, META extends EventMeta = EventMeta> extends CreatedEvent<Payload, META> {
  sequence?: number;
}

export type AppendableEvent<Payload = any, META extends EventMeta = EventMeta> = Omit<
  PersistedEvent<Payload, META>,
  'id'
> & {
  id?: string;
};

export type StreamAppendableEvent<Payload = any, META extends EventMeta = EventMeta> = AppendableEvent<
  Payload,
  META
> & {
  identifier: string;
};

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
  append(events: AppendableEvent[]): Promise<void>;
  getAllEvents(pageSize?: number, startFromId?: string): Promise<AsyncIterableIterator<Array<PersistedEvent>>>;
  reset?(): Promise<void>;
}

export interface StreamEventStoreAdapter extends EventStoreAdapter {
  getStreamEvents(domain: string, identifier: string, fromSequence?: number): Promise<PersistedEvent[]>;
  appendToStream(events: StreamAppendableEvent[], expectedVersion: number): Promise<{ nextVersion: number }>;
  getSnapshot?<State>(domain: string, identifier: string): Promise<Snapshot<State> | null>;
  saveSnapshot?<State>(snapshot: Snapshot<State>): Promise<void>;
}

export interface RevertableEventStoreAdapter {
  getEventById(id: string): Promise<PersistedEvent | null>;
  findByCausationId(causationId: string): Promise<PersistedEvent[]>;
  append(events: AppendableEvent[]): Promise<void>;
}

/** Omit identifier for the legacy domain-only stream; empty identifiers are invalid. */
export interface ExpectedStreamVersion {
  domain: string;
  identifier?: string;
  expectedVersion: number;
}

/** Optional capability: core and other adapters need not implement this interface. */
export interface BatchEventStoreAdapter extends StreamEventStoreAdapter {
  appendBatch(events: AppendableEvent[], expectedVersions: readonly ExpectedStreamVersion[]): Promise<void>;
  getStreamVersions(
    streams: readonly Pick<ExpectedStreamVersion, 'domain' | 'identifier'>[]
  ): Promise<ExpectedStreamVersion[]>;
}

/** A per-stream checkpoint, scoped to one adapter event table, not a commit-order cursor. */
export interface StreamLogPage {
  events: PersistedEvent[];
  cursor: ExpectedStreamVersion[];
}

export interface IncrementalEventStoreAdapter extends EventStoreAdapter {
  getLogPage(cursor?: readonly ExpectedStreamVersion[], pageSize?: number): Promise<StreamLogPage>;
}

export function supportsAppendBatch(adapter: EventStoreAdapter): adapter is BatchEventStoreAdapter {
  const candidate = adapter as BatchEventStoreAdapter;
  return typeof candidate.appendBatch === 'function' && typeof candidate.getStreamVersions === 'function';
}

export function supportsIncrementalLog(adapter: EventStoreAdapter): adapter is IncrementalEventStoreAdapter {
  return typeof (adapter as IncrementalEventStoreAdapter).getLogPage === 'function';
}
