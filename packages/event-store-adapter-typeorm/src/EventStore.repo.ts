import {
  ConcurrencyError,
  CreatedEvent,
  IEventStoreEntity,
  IEventStoreRepo,
  StoreEventsOptions,
} from '@schemeless/event-store-types';
import { Connection, Repository } from 'typeorm';
import { EventStoreEntity } from './EventStore.entity';
import { EventStoreEntitySqliteSpecial } from './EventStore.entity.sqlite';
import { ConnectionOptions } from 'typeorm';
import { getConnection } from './getConnection';
import { EventStoreIterator } from './EventStoreIterator';
import { logger } from './utils/logger';

const isConnForSqlite = (connectionOptions: ConnectionOptions): boolean => connectionOptions.type === 'sqlite';
type GeneralEventStoreEntity = EventStoreEntity | EventStoreEntitySqliteSpecial;

const groupBy = <T>(array: T[], keyGetter: (item: T) => string): Record<string, T[]> => {
  return array.reduce((result, item) => {
    const key = keyGetter(item);
    (result[key] = result[key] || []).push(item);
    return result;
  }, {} as Record<string, T[]>);
};

export class EventStoreRepo implements IEventStoreRepo {
  public repo: Repository<GeneralEventStoreEntity>;
  public conn: Connection;

  constructor(private connectionOptions: ConnectionOptions) { }

  async init() {
    const SelectedEventStoreEntity = isConnForSqlite(this.connectionOptions)
      ? EventStoreEntitySqliteSpecial
      : EventStoreEntity;
    if (!this.conn) {
      this.conn = await getConnection([SelectedEventStoreEntity], this.connectionOptions);
      this.repo = this.conn.getRepository(SelectedEventStoreEntity);
    }
  }

  async getAllEvents(
    pageSize: number = 100,
    startFromId?: string
  ): Promise<AsyncIterableIterator<Array<IEventStoreEntity>>> {
    await this.init();
    return new EventStoreIterator(this.repo, pageSize, startFromId);
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

  getStreamSequence = async (domain: string, identifier: string): Promise<number> => {
    await this.init();
    const SelectedEventStoreEntity = isConnForSqlite(this.connectionOptions)
      ? EventStoreEntitySqliteSpecial
      : EventStoreEntity;

    const query = this.repo
      .createQueryBuilder('e')
      .select('MAX(e.sequence)', 'maxSeq')
      .where('e.domain = :domain', { domain });

    if (identifier) {
      query.andWhere('e.identifier = :identifier', { identifier });
    } else {
      query.andWhere('e.identifier IS NULL');
    }

    const result = await query.getRawOne();
    return result && result.maxSeq !== null ? parseInt(result.maxSeq, 10) : 0;
  };

  storeEvents = async (events: CreatedEvent<any>[], options?: StoreEventsOptions) => {
    await this.init();
    const SelectedEventStoreEntity = isConnForSqlite(this.connectionOptions)
      ? EventStoreEntitySqliteSpecial
      : EventStoreEntity;

    await this.conn.transaction(async (entityManager) => {
      // Group events by stream key: domain + identifier
      const streamGroups = groupBy(events, (e) => `${e.domain}::${e.identifier ?? ''}`);

      for (const [streamKey, streamEvents] of Object.entries(streamGroups)) {
        const [domain, identifier] = streamKey.split('::');
        const realIdentifier = identifier === '' ? undefined : identifier;

        // Get current max sequence for this stream
        // We act inside a transaction, so we should be safe effectively if we had serializable isolation
        // However, standard read committed might allow phantom reads.
        // For strict OCC, we rely on the unique index constraint on [domain, identifier, sequence] as the final guard.
        // We just need to try to get the "latest" sequence we can see.

        const query = entityManager
          .createQueryBuilder(SelectedEventStoreEntity, 'e')
          .select('MAX(e.sequence)', 'maxSeq')
          .where('e.domain = :domain', { domain });

        if (realIdentifier) {
          query.andWhere('e.identifier = :identifier', { identifier: realIdentifier });
        } else {
          query.andWhere('e.identifier IS NULL');
        }

        // For some DBs, we might want to lock, but unique constraint is the ultimate truth.
        const result = await query.getRawOne();
        const currentSequence = result && result.maxSeq !== null ? parseInt(result.maxSeq, 10) : 0;

        // Validate expectedSequence if provided (Constraint Check)
        // If multiple streams are involved, expectedSequence logic is ambiguous in the current API design
        // because options.expectedSequence is a single number.
        // Assumption: storeEvents is called for a Single Stream when expectedSequence is provided.
        // If it's called for multiple streams, expectedSequence behavior is undefined/not supported by this simple signature.
        // We will enforce it against the FIRST stream we find, or we can assume the caller knows what they are doing.
        // Given the requirement "createEvent(event, options)", it's usually one event.
        // If it is a batch, they likely belong to the same stream if expectedSequence is passed.

        if (options?.expectedSequence !== undefined) {
          // If the batch contains multiple streams, this check is weird.
          // But strict OCC usually implies working on one stream.
          if (currentSequence !== options.expectedSequence) {
            throw new ConcurrencyError(streamKey, options.expectedSequence, currentSequence);
          }
        }

        // Assign sequence numbers
        let nextSequence = currentSequence + 1;
        for (const event of streamEvents) {
          const entity = this.createEventEntity(event);
          entity.sequence = nextSequence++;
          try {
            await entityManager.save(entity);
          } catch (err) {
            // Handle unique constraint violations from concurrent writes
            if (err.code === 'SQLITE_CONSTRAINT' || err.code === '23505' || err.code === 'ER_DUP_ENTRY') {
              // Re-query to get the actual current sequence
              const actualResult = await entityManager
                .createQueryBuilder(SelectedEventStoreEntity, 'e')
                .select('MAX(e.sequence)', 'maxSeq')
                .where('e.domain = :domain', { domain })
                .andWhere(realIdentifier ? 'e.identifier = :identifier' : 'e.identifier IS NULL',
                  realIdentifier ? { identifier: realIdentifier } : {})
                .getRawOne();
              const actualSequence = actualResult && actualResult.maxSeq !== null ? parseInt(actualResult.maxSeq, 10) : 0;
              throw new ConcurrencyError(streamKey, currentSequence, actualSequence);
            }
            throw err;
          }
        }
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

  getEventById = async (id: string): Promise<IEventStoreEntity | null> => {
    await this.init();
    const entity = await this.repo.findOne({ where: { id } });
    if (!entity) {
      return null;
    }
    return {
      ...entity,
      meta: entity.meta ? JSON.parse(entity.meta) : undefined,
      payload: entity.payload ? JSON.parse(entity.payload) : undefined,
    };
  };

  findByCausationId = async (causationId: string): Promise<IEventStoreEntity[]> => {
    await this.init();
    const entities = await this.repo.find({
      where: { causationId },
      order: { created: 'ASC', id: 'ASC' },
    });
    return entities.map((entity) => ({
      ...entity,
      meta: entity.meta ? JSON.parse(entity.meta) : undefined,
      payload: entity.payload ? JSON.parse(entity.payload) : undefined,
    }));
  };
}
