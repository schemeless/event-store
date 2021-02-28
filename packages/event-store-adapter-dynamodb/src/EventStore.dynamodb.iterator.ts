import { dateIndexName, EventStoreEntity } from './EventStore.dynamodb.entity';
import { EventStoreRepo } from './EventStore.dynamodb.repo';

export class EventStoreDynamodbIterator implements AsyncIterableIterator<EventStoreEntity[]> {
  protected currentPage = 0;
  public allItems: { id: string; created: Date }[];

  constructor(protected repo: EventStoreRepo, protected pageSize = 100) {
    this.allItems = [];
  }

  public async init() {
    const pages = this.repo.mapper
      .scan(EventStoreEntity, {
        indexName: dateIndexName,
        pageSize: 5000,
      })
      .pages();
    for await (const items of pages) {
      this.allItems = this.allItems.concat(items);
    }
    this.allItems.sort((a, b) => +a.created - +b.created);
  }

  public async next(): Promise<IteratorResult<EventStoreEntity[]>> {
    const take = this.pageSize;
    const skip = take * this.currentPage;
    const entities = this.allItems.slice(skip, skip + take);

    const _gets = entities.map((attrs) => Object.assign(new EventStoreEntity(), attrs));
    let items = [];
    for await (const _result of this.repo.mapper.batchGet(_gets)) {
      items = items.concat(_result);
    }

    items.sort((a, b) => +a.created - +b.created);

    const isDone = this.currentPage * this.pageSize >= this.allItems.length;
    this.currentPage = this.currentPage + 1;

    return {
      done: isDone,
      value: items,
    };
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<EventStoreEntity[]> {
    return this;
  }
}
