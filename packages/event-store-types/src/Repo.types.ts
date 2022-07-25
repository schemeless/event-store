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
}
