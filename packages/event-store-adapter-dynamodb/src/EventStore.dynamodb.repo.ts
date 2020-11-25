import type { ClientConfiguration } from 'aws-sdk/clients/dynamodb';
import type { CreatedEvent, IEventStoreRepo } from '@schemeless/event-store-types';
import { DataMapper } from '@aws/dynamodb-data-mapper';
import * as Dynamodb from 'aws-sdk/clients/dynamodb';
import { dateIndexGSIOptions, EventStoreEntity } from './EventStore.dynamodb.entity';

const dateIndexName = 'created';

export class EventStoreRepo implements IEventStoreRepo {
  public dynamodbClient: Dynamodb;
  public mapper: DataMapper;
  public initialized: boolean;

  constructor(private tableNamePrefix: string, clientConfiguration: ClientConfiguration) {
    this.dynamodbClient = new Dynamodb(clientConfiguration);
    this.mapper = new DataMapper({
      client: this.dynamodbClient as any,
      tableNamePrefix: this.tableNamePrefix,
    });
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    const result = await this.mapper.ensureTableExists(EventStoreEntity, {
      readCapacityUnits: 10,
      writeCapacityUnits: 10,
      indexOptions: {
        [dateIndexName]: dateIndexGSIOptions,
      },
    });
    console.log(result);
    this.initialized = true;
  }

  async getAllEvents(pageSize: number = 100): Promise<AsyncIterableIterator<Array<EventStoreEntity>>> {
    await this.init();
    return this.mapper
      .scan(EventStoreEntity, {
        indexName: dateIndexName,
        pageSize,
      })
      .pages();
  }

  createEventEntity = (event: CreatedEvent<any>): EventStoreEntity => {
    return Object.assign(new EventStoreEntity(), event);
  };

  storeEvents = async (events: CreatedEvent<any>[]) => {
    await this.init();
    const allEventEntities = events.map(this.createEventEntity);
    for await (const saved of this.mapper.batchPut(allEventEntities)) {
    }
  };
}
