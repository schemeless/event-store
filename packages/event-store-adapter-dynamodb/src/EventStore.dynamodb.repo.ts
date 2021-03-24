import type { CreatedEvent, IEventStoreRepo } from '@schemeless/event-store-types';
import type { S3 } from 'aws-sdk';
import type * as Dynamodb from 'aws-sdk/clients/dynamodb';
import * as sizeof from 'object-sizeof';
import { DataMapper } from '@aws/dynamodb-data-mapper';
import { dateIndexGSIOptions, dateIndexName, EventStoreEntity } from './EventStore.dynamodb.entity';
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
  public mapper: DataMapper;
  public initialized: boolean;

  constructor(public dynamodbClient: Dynamodb, public s3Client: S3, public options: Options) {
    this.mapper = new DataMapper({
      client: this.dynamodbClient as any,
      tableNamePrefix: this.options.tableNamePrefix,
    });
    this.options = Object.assign({}, defaultOptions, options);
  }

  async init(force = false) {
    if (this.initialized && !force) return;
    if (!this.options.skipDynamoDBTableCreation) {
      await this.mapper.ensureTableExists(EventStoreEntity, {
        readCapacityUnits: this.options.eventStoreTableReadCapacityUnits,
        writeCapacityUnits: this.options.eventStoreTableWriteCapacityUnits,
        indexOptions: {
          [dateIndexName]: dateIndexGSIOptions,
        },
      });
    }
    if (!this.options.skipS3BucketCreation) {
      try {
        console.log('heading');
        const result = await this.s3Client.headBucket({ Bucket: this.options.s3BucketName }).promise();
        console.log(result);
      } catch (err) {
        console.log(err);
        console.log('creating bucket' + this.options.s3BucketName);
        await this.s3Client.createBucket({ Bucket: this.options.s3BucketName }).promise();
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

  saveS3Object(event: EventStoreEntity) {
    const data = {
      Bucket: this.options.s3BucketName,
      Key: this.createBucketKeyForEvent(event.id),
      Body: Buffer.from(JSON.stringify(event)),
      ContentType: 'application/json',
      ContentEncoding: 'base64',
      ACL: this.options.s3Acl,
    };
    console.log('data', data);
    return this.s3Client.upload(data).promise();
  }

  createEventEntity = (event: CreatedEvent<any>): EventStoreEntity => {
    return Object.assign(new EventStoreEntity(), event);
  };

  async getFullEvent(event: EventStoreEntity): Promise<EventStoreEntity> {
    if (event.s3Reference) {
      const [Bucket, Key] = event.s3Reference.split('::');
      const result = await this.s3Client.getObject({ Bucket, Key }).promise();
      return JSON.parse(result.Body.toString());
    }
    return event;
  }

  storeEvents = async (events: CreatedEvent<any>[]) => {
    await this.init();
    const allEventEntities = events.map(this.createEventEntity);
    // @ts-ignore
    const overSizedEvents = allEventEntities.filter((event) => sizeof(event) > SIZE_LIMIT);

    // store all s3 objects
    await Promise.all(overSizedEvents.map((_) => this.saveS3Object(_)));

    // reshape for saving
    const reshapedEvents = allEventEntities.map((event) =>
      Object.assign(event, {
        payload: overSizedEvents.includes(event) ? undefined : event.payload,
        s3Reference: overSizedEvents.includes(event)
          ? this.options.s3BucketName + '::' + this.createBucketKeyForEvent(event.id)
          : undefined,
      })
    );
    for await (const saved of this.mapper.batchPut(reshapedEvents)) {
    }
  };

  resetStore = async () => {
    await this.mapper.deleteTable(EventStoreEntity);
    this.initialized = false;
    await this.init(true);
  };
}
