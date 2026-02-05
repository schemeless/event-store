import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { TIME_BUCKET_INDEX, EventStoreEntity } from './EventStore.dynamodb.entity';
import { EventStoreRepo } from './EventStore.dynamodb.repo';

export class EventStoreDynamodbIterator implements AsyncIterableIterator<EventStoreEntity[]> {
  private startDate = new Date('2020-01-01');
  private internalIterator: AsyncIterator<EventStoreEntity[]>;

  constructor(protected repo: EventStoreRepo, protected pageSize = 100) { }

  public async init() { }

  public async next(): Promise<IteratorResult<EventStoreEntity[]>> {
    if (!this.internalIterator) {
      this.internalIterator = this.generator();
    }
    return this.internalIterator.next();
  }

  private async *generator(): AsyncIterator<EventStoreEntity[]> {
    let currentMonth = new Date(this.startDate);
    const now = new Date();

    while (currentMonth <= now) {
      const timeBucket = currentMonth.toISOString().slice(0, 7);
      let lastEvaluatedKey: any = undefined;

      do {
        const response = await this.repo.ddbDocClient.send(
          new QueryCommand({
            TableName: this.repo.tableName,
            IndexName: TIME_BUCKET_INDEX,
            KeyConditionExpression: 'timeBucket = :timeBucket',
            ExpressionAttributeValues: {
              ':timeBucket': timeBucket,
            },
            Limit: this.pageSize,
            ScanIndexForward: true,
            ExclusiveStartKey: lastEvaluatedKey,
          })
        );

        if (response.Items && response.Items.length > 0) {
          const buffer: EventStoreEntity[] = [];
          for (const item of response.Items) {
            const fullEvent = await this.repo.getFullEvent(EventStoreEntity.fromItem(item));
            buffer.push(fullEvent);
          }
          yield buffer;
        }

        lastEvaluatedKey = response.LastEvaluatedKey;
      } while (lastEvaluatedKey);

      currentMonth.setMonth(currentMonth.getMonth() + 1);
    }
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<EventStoreEntity[]> {
    return this;
  }
}
