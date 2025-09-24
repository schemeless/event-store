import type { EntityManager, FilterQuery } from '@mikro-orm/core';
import type { IEventStoreEntity } from '@schemeless/event-store-types';
import { EventStoreEntity } from './EventStore.entity';

const deserializeEvent = (entity: EventStoreEntity): IEventStoreEntity => ({
  id: entity.id,
  domain: entity.domain,
  type: entity.type,
  identifier: entity.identifier ?? undefined,
  correlationId: entity.correlationId ?? undefined,
  causationId: entity.causationId ?? undefined,
  created: entity.created,
  payload: entity.payload != null ? JSON.parse(entity.payload) : undefined,
  meta: entity.meta != null ? JSON.parse(entity.meta) : undefined,
});

export class EventStoreIterator implements AsyncIterableIterator<IEventStoreEntity[]> {
  private readonly em: EntityManager;
  private currentPage = 0;

  constructor(entityManager: EntityManager, private readonly pageSize = 100, private readonly startFromId?: string) {
    this.em = entityManager.fork({ useContext: false });
  }

  async next(): Promise<IteratorResult<IEventStoreEntity[]>> {
    const limit = this.pageSize;
    const offset = limit * this.currentPage;
    const where: FilterQuery<EventStoreEntity> = this.startFromId ? { id: { $gt: this.startFromId } } : {};

    const entities = await this.em.find(EventStoreEntity, where, {
      limit,
      offset,
      orderBy: { created: 'asc', id: 'asc' },
    });

    this.currentPage += 1;

    if (entities.length === 0) {
      return { done: true, value: undefined };
    }

    return { done: false, value: entities.map(deserializeEvent) };
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<IEventStoreEntity[]> {
    return this;
  }
}
