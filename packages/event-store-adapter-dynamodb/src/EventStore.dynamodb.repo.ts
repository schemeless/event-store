import type { CreatedEvent, IEventStoreRepo } from '@schemeless/event-store-types';
import type { S3 } from 'aws-sdk';
import type * as Dynamodb from 'aws-sdk/clients/dynamodb';
import * as sizeof from 'object-sizeof';
import { DataMapper } from '@aws/dynamodb-data-mapper';
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
          [TIME_BUCKET_INDEX]: dateIndexGSIOptions,
          [CAUSATION_INDEX]: dateIndexGSIOptions,
        },
      });
    }
    if (!this.options.skipS3BucketCreation) {
      try {
        await this.s3Client.headBucket({ Bucket: this.options.s3BucketName }).promise();
      } catch (err) {
        logger.info('creating bucket' + this.options.s3BucketName);
        await this.s3Client.createBucket({ Bucket: this.options.s3BucketName }).promise();
      }
    }
    logger.info('initialized');
    this.initialized = true;
  }

  async getAllEvents(pageSize: number = 100): Promise<AsyncIterableIterator<Array<EventStoreEntity>>> {
    await this.init();
    // Use the optimized TimeBucket iterator
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
    return this.s3Client.upload(data).promise();
  }

  createEventEntity = (event: CreatedEvent<any>): EventStoreEntity => {
    const entity = Object.assign(new EventStoreEntity(), event);
    entity.generateTimeBucket(); // Important: Populate Bucket
    return entity;
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

    // Use Promise.all with Conditional Puts instead of batchPut to ensure idempotency/locking
    // This effectively prevents overwriting existing events with the same ID
    await Promise.all(
      reshapedEvents.map((event) =>
        this.mapper.put(event, {
          condition: {
            type: 'Function',
            name: 'attribute_not_exists',
            subject: 'id',
          },
        })
      )
    );
  };

  resetStore = async () => {
    try {
      await this.mapper.deleteTable(EventStoreEntity);
    } catch (e) {
      // ignore
    }
    this.initialized = false;
    await this.init(true);
  };

  getEventById = async (id: string): Promise<EventStoreEntity | null> => {
    await this.init();
    try {
      const event = await this.mapper.get(Object.assign(new EventStoreEntity(), { id }));
      return await this.getFullEvent(event);
    } catch (e) {
      if (e.name === 'ItemNotFoundException') {
        return null;
      }
      throw e;
    }
  };

  findByCausationId = async (causationId: string): Promise<EventStoreEntity[]> => {
    await this.init();
    const results: EventStoreEntity[] = [];

    // Use Query on GSI instead of Scan
    const iterator = this.mapper.query(
      EventStoreEntity,
      { causationId }, // KeyCondition
      { indexName: CAUSATION_INDEX }
    );

    for await (const item of iterator) {
      const fullEvent = await this.getFullEvent(item);
      results.push(fullEvent);
    }

    return results; // Results are already sorted by 'created' (SortKey of GSI)
  };
}
