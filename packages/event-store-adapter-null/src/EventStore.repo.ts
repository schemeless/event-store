import type { CreatedEvent, IEventStoreEntity, IEventStoreRepo } from '@schemeless/event-store-types';
import { logger } from './utils/logger';

export class EventStoreRepo implements IEventStoreRepo {
  constructor() {}

  async init() {}

  async getAllEvents(pageSize: number = 0): Promise<AsyncIterableIterator<Array<IEventStoreEntity>>> {
    throw new Error('Not implemented');
  }

  createEventEntity(event: CreatedEvent<any>) {
    return event as IEventStoreEntity;
  }

  storeEvents = async (events: CreatedEvent<any>[]) => {};

  resetStore = async () => {
    logger.info('not needed');
  };

  getEventById = async (id: string): Promise<IEventStoreEntity | null> => {
    return null;
  };

  findByCausationId = async (causationId: string): Promise<IEventStoreEntity[]> => {
    return [];
  };
}
