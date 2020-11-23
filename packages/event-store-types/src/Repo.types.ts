import type { CreatedEvent } from './EventStore.types';

export interface IEventStoreEntity {
  readonly id: number;
  domain: string;
  type: string;
  meta?: string;
  payload: string;
  identifier?: string;
  trackingId: string;
  correlationId?: string;
  causationId?: string;
  readonly created: Date;
}

export interface IEventStoreRepo {
  init: () => Promise<void>;
  getAllEvents: (page: number) => Promise<IEventStoreEntity[]>;
  createEventEntity: (event: CreatedEvent<any>) => IEventStoreEntity;
  storeEvents: (events: CreatedEvent<any>[]) => Promise<void>;
}
