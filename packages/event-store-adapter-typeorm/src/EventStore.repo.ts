import type { CreatedEvent, IEventStoreEntity, IEventStoreRepo } from '@schemeless/event-store-types';
import { Connection, Repository } from 'typeorm';
import { EventStoreEntity } from './EventStore.entity';
import { ConnectionOptions } from 'typeorm';
import { getConnection } from './getConnection';
import { EventStoreIterator } from './EventStoreIterator';

export class EventStoreRepo implements IEventStoreRepo {
  public repo: Repository<EventStoreEntity>;
  public conn: Connection;

  constructor(private connectionOptions: ConnectionOptions) {}

  async init() {
    if (!this.conn) {
      this.conn = await getConnection([EventStoreEntity], this.connectionOptions);
      this.repo = this.conn.getRepository<EventStoreEntity>(EventStoreEntity);
    }
  }

  async getAllEvents(pageSize: number = 100): Promise<AsyncIterableIterator<Array<IEventStoreEntity>>> {
    await this.init();
    return new EventStoreIterator(this.repo, pageSize);
  }

  createEventEntity = (event: CreatedEvent<any>): EventStoreEntity => {
    const newEventEntity = new EventStoreEntity();
    const { id, domain, type, payload, meta, created, correlationId, causationId, identifier } = event;

    Object.assign(newEventEntity, {
      id,
      domain,
      type,
      identifier,
      correlationId,
      causationId,
      created,
    });

    if (payload) {
      newEventEntity.payload = JSON.stringify(payload);
    }

    if (meta) {
      newEventEntity.meta = JSON.stringify(meta);
    }

    return newEventEntity;
  };

  storeEvents = async (events: CreatedEvent<any>[]) => {
    await this.init();
    const allEventEntities = events.map(this.createEventEntity);
    await this.conn.transaction(async (entityManager) => {
      for await (const currentEventEntity of allEventEntities) {
        await entityManager.save(currentEventEntity);
      }
    });
  };
}