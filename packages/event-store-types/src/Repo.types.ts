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
  readonly created: Date;
}

interface GetAllEventsResult<PAYLOAD, META> {
  events: IEventStoreEntity<PAYLOAD, META>[];
  getNextBatch: () => Promise<GetAllEventsResult<PAYLOAD, META>>;
  hasNextBatch: boolean;
}

export interface IEventStoreRepo<PAYLOAD = any, META = any> {
  init: () => Promise<void>;
  getAllEvents: (
    pageSize: number,
    startFromId?: string
  ) => Promise<AsyncIterableIterator<Array<IEventStoreEntity<PAYLOAD, META>>>>;
  createEventEntity: (event: CreatedEvent<any>) => IEventStoreEntity<PAYLOAD, META>;
  storeEvents: (events: CreatedEvent<any>[]) => Promise<void>;
  resetStore: () => Promise<void>;

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
