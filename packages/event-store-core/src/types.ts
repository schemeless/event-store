import type { EventStoreAdapter, PersistedEvent, StreamEventStoreAdapter } from '@schemeless/event-store-types';

export type { PersistedEvent } from '@schemeless/event-store-types';

export interface Observer {
  name: string;
  filters: Array<{ domain: string; type: string }>;
  priority?: number;
  fireAndForget?: boolean;
  apply(event: PersistedEvent): Promise<void> | void;
}

export interface EventStoreCore {
  append(events: PersistedEvent[]): Promise<void>;
  stream(
    domain: string,
    identifier: string,
    options?: { fromSequence?: number }
  ): Promise<PersistedEvent[]>;
  scan(options?: { pageSize?: number; startFromId?: string }): Promise<AsyncIterable<PersistedEvent[]>>;
  rebuildReadModels(options?: {
    startFromId?: string;
    observers?: Observer[];
    reset?: () => Promise<void>;
  }): Promise<void>;
  export(options?: { pageSize?: number }): Promise<PersistedEvent[]>;
  import(
    events: PersistedEvent[],
    options?: {
      replace?: boolean;
    }
  ): Promise<void>;
}

export type EventStoreCoreRepo = EventStoreAdapter &
  Partial<Pick<StreamEventStoreAdapter, 'getStreamEvents'>> & {
    reset?: () => Promise<void>;
  };
