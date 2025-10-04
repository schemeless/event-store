import type { Collection, Database } from '@nozbe/watermelondb';
import { Q } from '@nozbe/watermelondb';
import type { CreatedEvent, IEventStoreEntity, IEventStoreRepo } from '@schemeless/event-store-types';

import { EventModel } from './Event.model';

const TABLE_NAME = 'events';

export class EventStoreRepo<PAYLOAD = any, META = any> implements IEventStoreRepo<PAYLOAD, META> {
  private readonly database: Database;
  private readonly collection: Collection<EventModel>;

  constructor(database: Database) {
    this.database = database;
    this.collection = database.collections.get<EventModel>(TABLE_NAME);
  }

  async init(): Promise<void> {
    return Promise.resolve();
  }

  createEventEntity(event: CreatedEvent<PAYLOAD, META>): IEventStoreEntity<PAYLOAD, META> {
    const created = event.created instanceof Date ? event.created : new Date(event.created);

    return {
      id: event.id,
      domain: event.domain,
      type: event.type,
      payload: event.payload,
      meta: event.meta,
      identifier: event.identifier,
      correlationId: event.correlationId,
      causationId: event.causationId,
      created,
    };
  }

  async storeEvents(events: CreatedEvent<PAYLOAD, META>[]): Promise<void> {
    if (!events.length) {
      return;
    }

    await this.database.write(async () => {
      const operations = events.map((event) =>
        this.collection.prepareCreate((record) => {
          const created = event.created instanceof Date ? event.created : new Date(event.created);

          // WatermelonDB generates identifiers automatically, but we want to keep
          // the event-store id so downstream consumers can resume from it.
          record._raw.id = event.id;

          record.domain = event.domain;
          record.type = event.type;
          record.payload = JSON.stringify(event.payload ?? null);
          record.meta = event.meta !== undefined ? JSON.stringify(event.meta) : null;
          record.identifier = event.identifier ?? null;
          record.correlationId = event.correlationId ?? null;
          record.causationId = event.causationId ?? null;
          record.created = created.getTime();
        })
      );

      if (operations.length) {
        await this.database.batch(...operations);
      }
    });
  }

  async getAllEvents(
    pageSize: number,
    startFromId?: string
  ): Promise<AsyncIterableIterator<Array<IEventStoreEntity<PAYLOAD, META>>>> {
    const { collection } = this;
    const mapToEntity = (model: EventModel) => this.mapModelToEntity(model);

    const iterator = async function* (): AsyncIterableIterator<IEventStoreEntity<PAYLOAD, META>[]> {
      let lastTimestamp: number | null = null;
      let buffer: EventModel[] = [];

      if (startFromId) {
        try {
          const startEvent = await collection.find(startFromId);
          lastTimestamp = startEvent.created;

          const siblings = await collection
            .query(Q.where('created', startEvent.created), Q.sortBy('created', Q.asc))
            .fetch();

          buffer = siblings.filter((model) => model.id !== startFromId);
        } catch (error) {
          lastTimestamp = null;
          buffer = [];
        }
      }

      while (true) {
        if (buffer.length === 0) {
          const conditions = lastTimestamp !== null ? [Q.where('created', Q.gt(lastTimestamp))] : [];

          buffer = await collection.query(...conditions, Q.sortBy('created', Q.asc)).fetch();
        }

        if (buffer.length === 0) {
          break;
        }

        const chunk = buffer.slice(0, pageSize);
        const formattedChunk = chunk.map(mapToEntity);
        yield formattedChunk;

        const lastModelInChunk = chunk[chunk.length - 1];
        lastTimestamp = lastModelInChunk.created;
        buffer = buffer.slice(pageSize);
      }
    };

    return iterator();
  }

  async resetStore(): Promise<void> {
    await this.database.write(async () => {
      const events = await this.collection.query().fetch();

      if (!events.length) {
        return;
      }

      const deletions = events.map((event) => event.prepareDestroyPermanently());
      await this.database.batch(...deletions);
    });
  }

  private mapModelToEntity(model: EventModel): IEventStoreEntity<PAYLOAD, META> {
    return {
      id: model.id,
      domain: model.domain,
      type: model.type,
      payload: this.parseJSON<PAYLOAD>(model.payload),
      meta: this.parseNullableJSON(model.meta),
      identifier: model.identifier ?? undefined,
      correlationId: model.correlationId ?? undefined,
      causationId: model.causationId ?? undefined,
      created: new Date(model.created),
    };
  }

  private parseNullableJSON(value: string | null): META | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }

    return this.parseJSON<META>(value);
  }

  private parseJSON<T>(value: string): T {
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      throw new Error(`Failed to parse JSON from stored event: ${(error as Error).message}`);
    }
  }
}
