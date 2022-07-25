import { EventStoreEntity } from './EventStore.entity';
import { MoreThan, Repository } from 'typeorm';
import { IEventStoreEntity } from '@schemeless/event-store-types';

const parseEvent = (event: EventStoreEntity): IEventStoreEntity => ({
  ...event,
  meta: event.meta ? JSON.parse(event.meta) : undefined,
  payload: event.payload ? JSON.parse(event.payload) : undefined,
});

export class EventStoreIterator implements AsyncIterableIterator<EventStoreEntity[]> {
  protected currentPage = 0;

  constructor(protected repo: Repository<EventStoreEntity>, protected pageSize = 100, protected startFromId?: string) {}

  public async next(): Promise<IteratorResult<EventStoreEntity[]>> {
    const take = this.pageSize;
    const skip = take * this.currentPage;
    const startFromId = this.startFromId;

    const results = (
      await this.repo.find({
        order: {
          created: 'ASC',
          id: 'ASC',
        },
        where: {
          ...(startFromId ? { id: MoreThan(startFromId) } : {}),
        },
        take,
        skip,
      })
    ).map(parseEvent);

    this.currentPage = this.currentPage + 1;

    return {
      done: results.length === 0,
      value: results.length ? results : null,
    };
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<EventStoreEntity[]> {
    return this;
  }
}
