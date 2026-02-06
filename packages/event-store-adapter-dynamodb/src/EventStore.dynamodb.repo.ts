import type { CreatedEvent, IEventStoreRepo } from '@schemeless/event-store-types';
import { S3Client, HeadBucketCommand, CreateBucketCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import {
  DynamoDBClient,
  DescribeTableCommand,
  CreateTableCommand,
  DeleteTableCommand,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import sizeof from 'object-sizeof';
import {
  TIME_BUCKET_INDEX,
  CAUSATION_INDEX,
  dateIndexGSIOptions,
  EventStoreEntity,
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

  storeEvents = async (events: CreatedEvent<any>[]) => {
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

    await Promise.all(
      reshapedEvents.map((event) =>
        this.ddbDocClient.send(
          new PutCommand({
            TableName: this.tableName,
            Item: event.toItem(),
            ConditionExpression: 'attribute_not_exists(id)',
          })
        )
      )
    );
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
