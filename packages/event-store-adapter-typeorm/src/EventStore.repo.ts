import type { CreatedEvent, IEventStoreEntity, IEventStoreRepo } from '@schemeless/event-store-types';
import { Connection, Repository } from 'typeorm';
import { EventStoreEntity, EventStoreEntitySqliteSpecial } from './EventStore.entity';
import { ConnectionOptions } from 'typeorm';
import { getConnection } from './getConnection';
import { EventStoreIterator } from './EventStoreIterator';
import { logger } from './utils/logger';

const isConnForSqlite = (connectionOptions: ConnectionOptions): boolean => connectionOptions.type === 'sqlite';
type GeneralEventStoreEntity = EventStoreEntity | EventStoreEntitySqliteSpecial;

export class EventStoreRepo implements IEventStoreRepo {
  public repo: Repository<GeneralEventStoreEntity>;
  public conn: Connection;

  constructor(private connectionOptions: ConnectionOptions) {}

  async init() {
    const SelectedEventStoreEntity = isConnForSqlite(this.connectionOptions)
      ? EventStoreEntitySqliteSpecial
      : EventStoreEntity;
    if (!this.conn) {
      this.conn = await getConnection([SelectedEventStoreEntity], this.connectionOptions);
      this.repo = this.conn.getRepository(SelectedEventStoreEntity);
    }
  }

  async getAllEvents(pageSize: number = 100): Promise<AsyncIterableIterator<Array<IEventStoreEntity>>> {
    await this.init();
    return new EventStoreIterator(this.repo, pageSize);
  }

  createEventEntity = (event: CreatedEvent<any>): GeneralEventStoreEntity => {
    const SelectedEventStoreEntity = isConnForSqlite(this.connectionOptions)
      ? EventStoreEntitySqliteSpecial
      : EventStoreEntity;
    const newEventEntity = new SelectedEventStoreEntity();
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

  resetStore = async () => {
    await this.init();
    const eventStoreConn: Connection = this.conn;
    await eventStoreConn.query(`CREATE DATABASE IF NOT EXISTS ${this.connectionOptions.database};`);
    await eventStoreConn
      .createQueryRunner()
      .query(`ALTER DATABASE \`${this.connectionOptions.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    await eventStoreConn.synchronize(true);
    logger.info('Event Store reset finished');
  };
}
