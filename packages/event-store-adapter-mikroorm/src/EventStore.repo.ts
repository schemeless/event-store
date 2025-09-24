import type { CreatedEvent, IEventStoreEntity, IEventStoreRepo } from '@schemeless/event-store-types';
import { MikroORM, type EntityManager } from '@mikro-orm/core';
import { EventStoreEntity } from './EventStore.entity';
import { EventStoreIterator } from './EventStoreIterator';

type EventStoreOptions = Parameters<typeof MikroORM.init>[0];

const ensureEntityRegistered = (options: EventStoreOptions): EventStoreOptions => {
  const providedEntities = options.entities ?? [];
  const entityList = Array.isArray(providedEntities) ? providedEntities : [providedEntities];

  if (entityList.includes(EventStoreEntity)) {
    return {
      ...options,
      entities: [...entityList],
    };
  }

  return {
    ...options,
    entities: [...entityList, EventStoreEntity],
  };
};

export class EventStoreRepo implements IEventStoreRepo<any, any> {
  private orm?: MikroORM;

  constructor(private readonly options: EventStoreOptions) {}

  private async getOrm(): Promise<MikroORM> {
    if (!this.orm) {
      const config = ensureEntityRegistered(this.options);
      this.orm = await MikroORM.init(config);
      await this.orm.getSchemaGenerator().updateSchema();
    }

    return this.orm;
  }

  async init(): Promise<void> {
    await this.getOrm();
  }

  async getAllEvents(
    pageSize: number = 100,
    startFromId?: string
  ): Promise<AsyncIterableIterator<Array<IEventStoreEntity>>> {
    const orm = await this.getOrm();
    const iteratorEntityManager = orm.em.fork({ useContext: false });
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

    const orm = await this.getOrm();
    const entities = events.map((event) => this.createEventEntity(event));
    await orm.em.transactional(async (transaction: EntityManager) => {
      for (const entity of entities) {
        transaction.persist(entity);
      }
      await transaction.flush();
    });
  }

  async resetStore(): Promise<void> {
    const orm = await this.getOrm();
    const generator = orm.getSchemaGenerator();
    await generator.dropSchema();
    await generator.createSchema();
  }
}
