import type {
  AppendableEvent,
  EventStoreAdapter,
  PersistedEvent,
  StreamEventStoreAdapter,
} from '@schemeless/event-store-types';

export type { PersistedEvent } from '@schemeless/event-store-types';

export interface Observer {
  name: string;
  filters: Array<{ domain: string; type: string }>;
  priority?: number;
  fireAndForget?: boolean;
  onError?: (error: unknown, event: PersistedEvent) => void;
  apply(event: PersistedEvent): Promise<void> | void;
}

export interface EventStoreCore {
  append(events: AppendableEvent[]): Promise<void>;
  stream(domain: string, identifier: string, options?: { fromSequence?: number }): Promise<PersistedEvent[]>;
  scan(options?: { pageSize?: number; startFromId?: string }): AsyncIterable<PersistedEvent[]>;
  rebuildReadModels(options?: {
    startFromId?: string;
    observers?: Observer[];
    reset?: () => Promise<void>;
  }): Promise<void>;
  export(options?: { pageSize?: number }): AsyncIterable<PersistedEvent[]>;
  import(
    events: PersistedEvent[],
    options?: {
      replace?: boolean;
    }
  ): Promise<void>;
}

export type EventStoreCoreRepo = EventStoreAdapter & Partial<Pick<StreamEventStoreAdapter, 'getStreamEvents'>>;
