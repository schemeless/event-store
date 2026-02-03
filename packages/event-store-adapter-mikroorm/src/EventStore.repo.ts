import type { CreatedEvent, IEventStoreEntity, IEventStoreRepo } from '@schemeless/event-store-types';
import type { EntityManager } from '@mikro-orm/core';
import { EventStoreEntity } from './EventStore.entity';
import { EventStoreIterator } from './EventStoreIterator';

export class EventStoreRepo implements IEventStoreRepo<any, any> {
  constructor(private readonly em: EntityManager) {}

  async init(): Promise<void> {}

  async getAllEvents(
    pageSize: number = 100,
    startFromId?: string
  ): Promise<AsyncIterableIterator<Array<IEventStoreEntity>>> {
    const iteratorEntityManager = this.em.fork();
    return new EventStoreIterator(iteratorEntityManager, pageSize, startFromId);
  }

  createEventEntity(event: CreatedEvent<any>): EventStoreEntity {
    const entity = new EventStoreEntity();
    const { id, domain, type, payload, meta, created, correlationId, causationId, identifier } = event;

    Object.assign(entity, {
      id,
      domain,
      type,
      identifier: identifier ?? null,
      correlationId: correlationId ?? null,
      causationId: causationId ?? null,
      created,
    });

    entity.payload = JSON.stringify(payload ?? null);
    entity.meta = meta === undefined ? null : JSON.stringify(meta);

    return entity;
  }

  async storeEvents(events: CreatedEvent<any>[]): Promise<void> {
    if (!events.length) {
      return;
    }

    const entities = events.map((event) => this.createEventEntity(event));
    const forkedEm = this.em.fork();
    await forkedEm.transactional(async (transactionalEm) => {
      for (const entity of entities) {
        transactionalEm.persist(entity);
      }
      await transactionalEm.flush();
    });
  }

  async resetStore(): Promise<void> {
    throw new Error(
      'EventStoreRepo no longer manages schema. Schema reset should be handled by the application-level ORM instance.'
    );
  }

  async getEventById(id: string): Promise<IEventStoreEntity | null> {
    const forkedEm = this.em.fork();
    const entity = await forkedEm.findOne(EventStoreEntity, { id });
    if (!entity) {
      return null;
    }
    return {
      id: entity.id,
      domain: entity.domain,
      type: entity.type,
      identifier: entity.identifier ?? undefined,
      correlationId: entity.correlationId ?? undefined,
      causationId: entity.causationId ?? undefined,
      created: entity.created,
      payload: entity.payload != null ? JSON.parse(entity.payload) : undefined,
      meta: entity.meta != null ? JSON.parse(entity.meta) : undefined,
    };
  }

  async findByCausationId(causationId: string): Promise<IEventStoreEntity[]> {
    const forkedEm = this.em.fork();
    const entities = await forkedEm.find(EventStoreEntity, { causationId }, { orderBy: { created: 'asc', id: 'asc' } });
    return entities.map((entity) => ({
      id: entity.id,
      domain: entity.domain,
      type: entity.type,
      identifier: entity.identifier ?? undefined,
      correlationId: entity.correlationId ?? undefined,
      causationId: entity.causationId ?? undefined,
      created: entity.created,
      payload: entity.payload != null ? JSON.parse(entity.payload) : undefined,
      meta: entity.meta != null ? JSON.parse(entity.meta) : undefined,
    }));
  }
}
