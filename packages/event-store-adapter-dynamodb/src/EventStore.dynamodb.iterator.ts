import { QueryCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { TIME_BUCKET_INDEX, EventStoreEntity } from './EventStore.dynamodb.entity';
import { EventStoreRepo } from './EventStore.dynamodb.repo';

interface IteratorOptions {
  startDate?: Date;
  maxRetries?: number;
  retryDelayMs?: number;
}

export class EventStoreDynamodbIterator implements AsyncIterableIterator<EventStoreEntity[]> {
  private startDate: Date;
  private maxRetries: number;
  private retryDelayMs: number;
  private internalIterator: AsyncIterator<EventStoreEntity[]>;

  constructor(
    protected repo: EventStoreRepo,
    protected pageSize = 100,
    options: IteratorOptions = {}
  ) {
    this.startDate = options.startDate || new Date('2020-01-01');
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
  }

  public async init() { }

  public async next(): Promise<IteratorResult<EventStoreEntity[]>> {
    if (!this.internalIterator) {
      this.internalIterator = this.generator();
    }
    return this.internalIterator.next();
  }

  private async retryableOperation<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        if (attempt < this.maxRetries) {
          const delay = this.retryDelayMs * Math.pow(2, attempt);
          console.warn(
            `${operationName} failed (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying in ${delay}ms...`,
            error
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    throw new Error(`${operationName} failed after ${this.maxRetries + 1} attempts: ${lastError!.message}`);
  }

  private async batchGetWithRetry(keys: any[]): Promise<Map<string, any>> {
    const hydratedItemsMap = new Map<string, any>();
    let unprocessedKeys = keys;

    while (unprocessedKeys.length > 0) {
      const batchResponse = await this.retryableOperation(
        () =>
          this.repo.ddbDocClient.send(
            new BatchGetCommand({
              RequestItems: {
                [this.repo.tableName]: {
                  Keys: unprocessedKeys,
                },
              },
            })
          ),
        'BatchGetCommand'
      );

      // Process successfully retrieved items
      if (batchResponse.Responses && batchResponse.Responses[this.repo.tableName]) {
        batchResponse.Responses[this.repo.tableName].forEach((item) => {
          // Use composite key (id + created) to avoid potential collisions
          const compositeKey = `${item.id}::${item.created}`;
          hydratedItemsMap.set(compositeKey, item);
        });
      }

      // Handle UnprocessedKeys - critical for data integrity!
      if (batchResponse.UnprocessedKeys && batchResponse.UnprocessedKeys[this.repo.tableName]) {
        unprocessedKeys = batchResponse.UnprocessedKeys[this.repo.tableName].Keys || [];
        if (unprocessedKeys.length > 0) {
          console.warn(`BatchGet has ${unprocessedKeys.length} unprocessed keys, retrying...`);
          // Add a small delay before retrying unprocessed keys
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } else {
        unprocessedKeys = [];
      }
    }

    return hydratedItemsMap;
  }

  private async *generator(): AsyncIterator<EventStoreEntity[]> {
    let currentMonth = new Date(this.startDate);
    const now = new Date();

    while (currentMonth <= now) {
      // Always set to first day of month to avoid date overflow issues
      currentMonth.setDate(1);
      const timeBucket = currentMonth.toISOString().slice(0, 7);
      let lastEvaluatedKey: any = undefined;

      do {
        const response = await this.retryableOperation(
          () =>
            this.repo.ddbDocClient.send(
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
            ),
          'QueryCommand'
        );

        if (response.Items && response.Items.length > 0) {
          // GSI is KEYS_ONLY, so we must hydrate the full events from the main table
          const keys = response.Items.map((item) => ({
            id: item.id,
            created: item.created,
          }));

          // BatchGetItem has a limit of 100 keys per request
          const chunks = [];
          for (let i = 0; i < keys.length; i += 100) {
            chunks.push(keys.slice(i, i + 100));
          }

          const hydratedItemsMap = new Map<string, any>();

          // Process all chunks and handle UnprocessedKeys
          for (const chunk of chunks) {
            const chunkMap = await this.batchGetWithRetry(chunk);
            chunkMap.forEach((value, key) => hydratedItemsMap.set(key, value));
          }

          // Reconstruct in original order from Query and parallelize getFullEvent
          const entityPromises = response.Items.map(async (keyItem) => {
            const compositeKey = `${keyItem.id}::${keyItem.created}`;
            const fullItem = hydratedItemsMap.get(compositeKey);

            if (fullItem) {
              const entity = EventStoreEntity.fromItem(fullItem);
              return await this.repo.getFullEvent(entity);
            } else {
              // If item is in GSI but not in main table, it's a data inconsistency
              // Log warning but don't fail the entire iteration
              console.warn(
                `Data inconsistency: Event ${keyItem.id} (${keyItem.created}) found in GSI but not in main table`
              );
              return null;
            }
          });

          // Wait for all getFullEvent calls in parallel
          const entities = await Promise.all(entityPromises);

          // Filter out nulls and only yield if we have data
          const buffer = entities.filter((e): e is EventStoreEntity => e !== null);

          if (buffer.length > 0) {
            yield buffer;
          }
        }

        lastEvaluatedKey = response.LastEvaluatedKey;
      } while (lastEvaluatedKey);

      // Move to next month - always set to 1st to avoid overflow
      currentMonth.setMonth(currentMonth.getMonth() + 1);
      currentMonth.setDate(1);
    }
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<EventStoreEntity[]> {
    return this;
  }
}
