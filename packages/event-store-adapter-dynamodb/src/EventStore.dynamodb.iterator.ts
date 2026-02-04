import { TIME_BUCKET_INDEX, EventStoreEntity } from './EventStore.dynamodb.entity';
import { EventStoreRepo } from './EventStore.dynamodb.repo';

export class EventStoreDynamodbIterator implements AsyncIterableIterator<EventStoreEntity[]> {

  // Default start date for replay. 
  // Ideally this should be configurable or stored in metadata.
  private startDate = new Date('2020-01-01');

  constructor(protected repo: EventStoreRepo, protected pageSize = 100) { }

  public async init() {
    // No initialization needed for Query-based approach
    // (Old implementation sorted in memory here)
  }

  public async next(): Promise<IteratorResult<EventStoreEntity[]>> {
    // Use the generator defined in [Symbol.asyncIterator]
    // However, since we implement both next() manually and Symbol.asyncIterator, 
    // it's tricky to map the generator back to next() without a wrapper.
    // Given the consumption pattern usually uses `for await (const batch of iterator)`,
    // the Symbol.asyncIterator is key.
    // If explicit next() calls are used, this won't work well unless we instantiate the generator.

    // For compatibility, let's just throw or return done if called directly?
    // Actually, AsyncIterableIterator requires next() to be implemented.
    // We can delegate to an internal generator.
    if (!this.internalIterator) {
      this.internalIterator = this.generator();
    }
    return this.internalIterator.next();
  }

  private internalIterator: AsyncIterator<EventStoreEntity[]>;

  private async *generator(): AsyncIterator<EventStoreEntity[]> {
    let currentMonth = new Date(this.startDate);
    const now = new Date();

    // Loop through months from StartDate to Now
    while (currentMonth <= now) {
      const timeBucket = currentMonth.toISOString().slice(0, 7); // YYYY-MM

      const queryIterator = this.repo.mapper.query(
        EventStoreEntity,
        { timeBucket },
        {
          indexName: TIME_BUCKET_INDEX,
          limit: this.pageSize,
          scanIndexForward: true // Oldest first
        }
      );

      let buffer: EventStoreEntity[] = [];

      for await (const item of queryIterator) {
        // Hydrate full event (S3 checks etc)
        const fullEvent = await this.repo.getFullEvent(item);
        buffer.push(fullEvent);

        if (buffer.length >= this.pageSize) {
          yield buffer;
          buffer = [];
        }
      }

      if (buffer.length > 0) {
        yield buffer;
      }

      // Move to next month
      currentMonth.setMonth(currentMonth.getMonth() + 1);
    }
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<EventStoreEntity[]> {
    return this;
  }
}
