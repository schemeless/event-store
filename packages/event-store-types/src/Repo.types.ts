import type { CreatedEvent } from './EventStore.types';

export interface IEventStoreEntity<PAYLOAD = any, META = any> {
  id: string;
  domain: string;
  type: string;
  meta?: META;
  payload: PAYLOAD;
  identifier?: string;
  correlationId?: string;
  causationId?: string;
  sequence?: number; // Per-stream sequence number
  readonly created: Date;
}

export interface StoreEventsOptions {
  /**
   * Expected sequence number for the stream (domain + identifier).
   * If provided, the store will verify the current sequence matches
   * before writing. Throws ConcurrencyError on mismatch.
   */
  expectedSequence?: number;
}

interface GetAllEventsResult<PAYLOAD, META> {
  events: IEventStoreEntity<PAYLOAD, META>[];
  getNextBatch: () => Promise<GetAllEventsResult<PAYLOAD, META>>;
  hasNextBatch: boolean;
}

export interface ISnapshotEntity<STATE = any> {
  domain: string;
  identifier: string;
  state: STATE;
  sequence: number;
  created: Date;
}

export interface IEventStoreRepo<PAYLOAD = any, META = any> {
  init: () => Promise<void>;
  getAllEvents: (
    pageSize: number,
    startFromId?: string
  ) => Promise<AsyncIterableIterator<Array<IEventStoreEntity<PAYLOAD, META>>>>;
  createEventEntity: (event: CreatedEvent<any>) => IEventStoreEntity<PAYLOAD, META>;
  storeEvents: (events: CreatedEvent<any>[], options?: StoreEventsOptions) => Promise<void>;
  resetStore: () => Promise<void>;

  /**
   * Get events for a specific stream (domain + identifier).
   * MUST use efficient index-based query (e.g., DynamoDB Query, SQL WHERE).
   * Required for getAggregate to work.
   *
   * @param domain - Event domain
   * @param identifier - Stream identifier
   * @param fromSequence - Start from this sequence (exclusive), 0 = from beginning
   * @returns Events ordered by sequence ascending
   */
  getStreamEvents?: (
    domain: string,
    identifier: string,
    fromSequence?: number
  ) => Promise<IEventStoreEntity<PAYLOAD, META>[]>;

  // Snapshot support (optional)
  getSnapshot?: <STATE>(
    domain: string,
    identifier: string
  ) => Promise<ISnapshotEntity<STATE> | null>;
  saveSnapshot?: <STATE>(snapshot: ISnapshotEntity<STATE>) => Promise<void>;

  /**
   * Get the current sequence number for a stream.
   * Returns 0 if no events exist for this stream.
   */
  getStreamSequence?: (domain: string, identifier: string) => Promise<number>;

  /**
   * Retrieves a single event by its ID.
   * Required for revert operations.
   */
  getEventById?: (id: string) => Promise<IEventStoreEntity<PAYLOAD, META> | null>;

  /**
   * Finds all events directly caused by the specified event.
   * Returns events where causationId equals the given eventId.
   * Required for revert operations to traverse the event tree.
   *
   * Note for DynamoDB: Consider adding a GSI on causationId for better
   * performance. Without a GSI, this will result in a table scan.
   */
  findByCausationId?: (causationId: string) => Promise<IEventStoreEntity<PAYLOAD, META>[]>;

  /**
   * Closes the database connection and releases resources.
   * Called during graceful shutdown.
   */
  close?: () => Promise<void>;
}
