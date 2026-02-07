import {
  ConcurrencyError,
  CreatedEvent,
  IEventStoreRepo,
  StoreEventsOptions,
} from '@schemeless/event-store-types';
import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import sizeof from 'object-sizeof';
import {
  CAUSATION_INDEX,
  EventStoreEntity,
  TIME_BUCKET_INDEX,
} from './EventStore.dynamodb.entity';
import { logger } from './utils/logger';
import { EventStoreDynamodbIterator } from './EventStore.dynamodb.iterator';

const SIZE_LIMIT = 350000; // Bytes

interface Options {
  tableNamePrefix: string;
  s3BucketName: string;
  s3Acl?: string;
  s3KeyPrefix?: string;
  skipDynamoDBTableCreation?: boolean;
  skipS3BucketCreation?: boolean;
  eventStoreTableReadCapacityUnits?: number;
  eventStoreTableWriteCapacityUnits?: number;
}

const defaultOptions = {
  skipDynamoDBTableCreation: false,
  skipS3BucketCreation: false,
  s3Acl: 'private',
  s3KeyPrefix: 'events/',
  eventStoreTableReadCapacityUnits: 10,
  eventStoreTableWriteCapacityUnits: 10,
};

const groupBy = <T>(array: T[], keyGetter: (item: T) => string): Record<string, T[]> => {
  return array.reduce((result, item) => {
    const key = keyGetter(item);
    (result[key] = result[key] || []).push(item);
    return result;
  }, {} as Record<string, T[]>);
};

export class EventStoreRepo implements IEventStoreRepo {
  public ddbDocClient: DynamoDBDocumentClient;
  public initialized: boolean;
  public tableName: string;

  constructor(public dynamodbClient: DynamoDBClient, public s3Client: S3Client, public options: Options) {
    this.ddbDocClient = DynamoDBDocumentClient.from(this.dynamodbClient, {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.options = Object.assign({}, defaultOptions, options);
    this.tableName = `${this.options.tableNamePrefix}schemeless-event-store`;
  }

  async init(force = false) {
    if (this.initialized && !force) return;
    if (!this.options.skipDynamoDBTableCreation) {
      try {
        await this.dynamodbClient.send(new DescribeTableCommand({ TableName: this.tableName }));
      } catch (err) {
        if (err.name === 'ResourceNotFoundException') {
          logger.info('creating table ' + this.tableName);
          await this.dynamodbClient.send(
            new CreateTableCommand({
              TableName: this.tableName,
              AttributeDefinitions: [
                { AttributeName: 'id', AttributeType: 'S' },
                { AttributeName: 'timeBucket', AttributeType: 'S' },
                { AttributeName: 'causationId', AttributeType: 'S' },
                { AttributeName: 'created', AttributeType: 'S' },
              ],
              KeySchema: [
                { AttributeName: 'id', KeyType: 'HASH' },
                { AttributeName: 'created', KeyType: 'RANGE' },
              ],
              GlobalSecondaryIndexes: [
                {
                  IndexName: TIME_BUCKET_INDEX,
                  KeySchema: [
                    { AttributeName: 'timeBucket', KeyType: 'HASH' },
                    { AttributeName: 'created', KeyType: 'RANGE' },
                  ],
                  Projection: { ProjectionType: 'KEYS_ONLY' },
                  ProvisionedThroughput: {
                    ReadCapacityUnits: this.options.eventStoreTableReadCapacityUnits || 10,
                    WriteCapacityUnits: this.options.eventStoreTableWriteCapacityUnits || 10,
                  },
                },
                {
                  IndexName: CAUSATION_INDEX,
                  KeySchema: [
                    { AttributeName: 'causationId', KeyType: 'HASH' },
                    { AttributeName: 'created', KeyType: 'RANGE' },
                  ],
                  Projection: { ProjectionType: 'KEYS_ONLY' },
                  ProvisionedThroughput: {
                    ReadCapacityUnits: this.options.eventStoreTableReadCapacityUnits || 10,
                    WriteCapacityUnits: this.options.eventStoreTableWriteCapacityUnits || 10,
                  },
                },
              ],
              ProvisionedThroughput: {
                ReadCapacityUnits: this.options.eventStoreTableReadCapacityUnits || 10,
                WriteCapacityUnits: this.options.eventStoreTableWriteCapacityUnits || 10,
              },
            })
          );
        } else {
          throw err;
        }
      }
    }
    if (!this.options.skipS3BucketCreation) {
      try {
        await this.s3Client.send(new HeadBucketCommand({ Bucket: this.options.s3BucketName }));
      } catch (err) {
        logger.info('creating bucket ' + this.options.s3BucketName);
        await this.s3Client.send(new CreateBucketCommand({ Bucket: this.options.s3BucketName }));
      }
    }
    logger.info('initialized');
    this.initialized = true;
  }

  async getAllEvents(pageSize: number = 100): Promise<AsyncIterableIterator<Array<EventStoreEntity>>> {
    await this.init();
    const pages = new EventStoreDynamodbIterator(this, pageSize);
    await pages.init();
    return pages;
  }

  createBucketKeyForEvent(eventId): string {
    return this.options.s3KeyPrefix + eventId + '.json';
  }

  async saveS3Object(event: EventStoreEntity) {
    const upload = new Upload({
      client: this.s3Client,
      params: {
        Bucket: this.options.s3BucketName,
        Key: this.createBucketKeyForEvent(event.id),
        Body: JSON.stringify(event),
        ContentType: 'application/json',
        ACL: this.options.s3Acl as any,
      },
    });
    return upload.done();
  }

  createEventEntity = (event: CreatedEvent<any>): EventStoreEntity => {
    const entity = Object.assign(new EventStoreEntity(), event);
    entity.generateTimeBucket();
    return entity;
  };

  async getFullEvent(event: EventStoreEntity): Promise<EventStoreEntity> {
    if (event.s3Reference) {
      const [Bucket, Key] = event.s3Reference.split('::');
      const result = await this.s3Client.send(new GetObjectCommand({ Bucket, Key }));
      const body = await result.Body?.transformToString();
      const rawData = JSON.parse(body || '{}');
      // Ensure the S3 data is properly deserialized through EventStoreEntity.fromItem
      return EventStoreEntity.fromItem(rawData);
    }
    return event;
  }

  getStreamSequence = async (domain: string, identifier: string): Promise<number> => {
    await this.init();
    const headItemId = `HEAD::${domain}::${identifier ?? ''}`;
    const result = await this.ddbDocClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { id: `EventID#${headItemId}`, created: 'HEAD' },
      })
    );
    return result.Item?.version ?? 0;
  };

  /**
   * Internal method to store already-processed EventStoreEntity items with chunking.
   * This avoids duplicate S3 offload and entity creation in recursive batching.
   */
  private storeProcessedEvents = async (
    streamKey: string,
    streamEvents: EventStoreEntity[],
    options?: StoreEventsOptions
  ) => {
    const headItemId = `HEAD::${streamKey}`;
    let currentExpectedSequence = options?.expectedSequence;

    if (currentExpectedSequence === undefined) {
      const [domain, identifier] = streamKey.split('::');
      currentExpectedSequence = await this.getStreamSequence(domain, identifier === '' ? undefined : identifier);
    }

    // Chunking if > 25 (allowing margin for HEAD item)
    // DynamoDB Limit is 100. We use 25 as a safe limit.
    const MAX_ITEMS_PER_TX = 25;

    if (streamEvents.length > MAX_ITEMS_PER_TX) {
      // Recursive chunking
      const chunkSize = MAX_ITEMS_PER_TX;
      for (let i = 0; i < streamEvents.length; i += chunkSize) {
        const chunk = streamEvents.slice(i, i + chunkSize);
        const chunkSequence = currentExpectedSequence + i;
        await this.storeProcessedEvents(streamKey, chunk, { expectedSequence: chunkSequence });
      }
      return; // All chunks processed recursively
    }

    const currentVersion = currentExpectedSequence!;
    const newVersion = currentVersion + streamEvents.length;

    const transactItems: any[] = [
      // 1. Update HEAD item with version check
      {
        Update: {
          TableName: this.tableName,
          Key: { id: `EventID#${headItemId}`, created: 'HEAD' },
          UpdateExpression: 'SET version = :newVersion',
          ConditionExpression:
            options?.expectedSequence !== undefined
              ? 'version = :expected'
              : 'attribute_not_exists(version) OR version = :expected',
          ExpressionAttributeValues: {
            ':newVersion': newVersion,
            ':expected': currentVersion,
          },
        },
      },
      // 2. Put each event with sequence
      ...streamEvents.map((event, idx) => {
        event.sequence = currentVersion + idx + 1;
        return {
          Put: {
            TableName: this.tableName,
            Item: event.toItem(),
            ConditionExpression: 'attribute_not_exists(id)',
          },
        };
      }),
    ];

    try {
      await this.ddbDocClient.send(new TransactWriteCommand({ TransactItems: transactItems }));
    } catch (err) {
      if (err.name === 'TransactionCanceledException') {
        // Check if it's a version mismatch
        const [domain, identifier] = streamKey.split('::');
        const actualVersion = await this.getStreamSequence(domain, identifier === '' ? undefined : identifier);
        throw new ConcurrencyError(streamKey, options?.expectedSequence ?? currentVersion, actualVersion);
      }
      throw err;
    }
  };

  storeEvents = async (events: CreatedEvent<any>[], options?: StoreEventsOptions) => {
    await this.init();
    const allEventEntities = events.map(this.createEventEntity);
    const overSizedEvents = allEventEntities.filter((event) => sizeof(event) > SIZE_LIMIT);

    await Promise.all(overSizedEvents.map((_) => this.saveS3Object(_)));

    const reshapedEvents = allEventEntities.map((event) => {
      const isOversized = overSizedEvents.includes(event);
      return Object.assign(event, {
        payload: isOversized ? undefined : event.payload,
        s3Reference: isOversized
          ? this.options.s3BucketName + '::' + this.createBucketKeyForEvent(event.id)
          : undefined,
      });
    });

    const streamGroups = groupBy(reshapedEvents, (e) => `${e.domain}::${e.identifier ?? ''}`);

    for (const [streamKey, streamEvents] of Object.entries(streamGroups)) {
      await this.storeProcessedEvents(streamKey, streamEvents, options);
    }
  };

  resetStore = async () => {
    try {
      await this.dynamodbClient.send(new DeleteTableCommand({ TableName: this.tableName }));
    } catch (e) {
      // ignore
    }
    this.initialized = false;
    await this.init(true);
  };

  getEventById = async (id: string): Promise<EventStoreEntity | null> => {
    await this.init();
    try {
      const response = await this.ddbDocClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { id: `EventID#${id}` },
        })
      );
      if (!response.Item) return null;
      const event = EventStoreEntity.fromItem(response.Item);
      return await this.getFullEvent(event);
    } catch (e) {
      throw e;
    }
  };

  findByCausationId = async (causationId: string): Promise<EventStoreEntity[]> => {
    await this.init();
    const results: EventStoreEntity[] = [];

    const response = await this.ddbDocClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: CAUSATION_INDEX,
        KeyConditionExpression: 'causationId = :causationId',
        ExpressionAttributeValues: {
          ':causationId': causationId,
        },
      })
    );

    if (response.Items) {
      for (const item of response.Items) {
        const fullEvent = await this.getFullEvent(EventStoreEntity.fromItem(item));
        results.push(fullEvent);
      }
    }

    return results;
  };
}
