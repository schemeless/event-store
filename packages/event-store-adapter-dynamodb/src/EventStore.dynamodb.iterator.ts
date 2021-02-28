import type { ScanPaginator } from '@aws/dynamodb-data-mapper';
import { dateIndexName, EventStoreEntity } from './EventStore.dynamodb.entity';
import { EventStoreRepo } from './EventStore.dynamodb.repo';

export class EventStoreDynamodbIterator implements AsyncIterableIterator<EventStoreEntity[]> {
  protected pages: ScanPaginator<EventStoreEntity>;

  constructor(protected repo: EventStoreRepo, protected pageSize = 100) {
    this.pages = this.repo.mapper
      .query(
        EventStoreEntity,
        {},
        {
          indexName: dateIndexName,
          pageSize,
        }
      )
      .pages();
  }

  public async next(): Promise<IteratorResult<EventStoreEntity[]>> {
    const _next = await this.pages.next();
    if (_next.done === true) {
      return {
        done: true,
        value: undefined,
      };
    }
    console.log(_next.value);
    const entities = _next.value as EventStoreEntity[];
    const _gets = entities.map(({ id }) => Object.assign(new EventStoreEntity(), { id: id }));
    let value = [];
    for await (const _result of this.repo.mapper.batchGet(_gets)) {
      value = value.concat(_result);
    }

    return {
      done: _next.done,
      value: value,
    };
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<EventStoreEntity[]> {
    return this;
  }
}
