import type { ClientConfiguration } from 'aws-sdk/clients/dynamodb';
import type { CreatedEvent, IEventStoreRepo } from '@schemeless/event-store-types';
import { DataMapper } from '@aws/dynamodb-data-mapper';
import * as Dynamodb from 'aws-sdk/clients/dynamodb';
import { beginsWith } from '@aws/dynamodb-expressions'
import { EventStoreEntity } from './EventStore.dynamodb.entity';
import { logger } from './utils/logger';

interface Options {
  skipInitialise?: boolean;
  readCapacityUnits?: number;
  writeCapacityUnits?: number;
}

const defaultOptions = {
  skipInitialise: false,
  readCapacityUnits: 10,
  writeCapacityUnits: 10,
}

export class EventStoreRepo implements IEventStoreRepo {
  public dynamodbClient: Dynamodb;
  public mapper: DataMapper;
  public initialized: boolean;

  constructor(
    private tableNamePrefix: string,
    clientConfiguration: ClientConfiguration,
    public options: Options = {
      skipInitialise: false
    }
  ) {
    this.dynamodbClient = new Dynamodb(clientConfiguration);
    this.mapper = new DataMapper({
      client: this.dynamodbClient as any,
      tableNamePrefix: this.tableNamePrefix,
    });
    this.initialized = false;
  }

  async init(force = false) {
    if (this.options.skipInitialise) return;
    if (this.initialized && !force) return;
    await this.mapper.ensureTableExists(EventStoreEntity, {
      readCapacityUnits: this.options.readCapacityUnits,
      writeCapacityUnits: this.options.writeCapacityUnits,
    });
    logger.info('initialized');
    this.initialized = true;
  }

  async getAllEvents(pageSize: number = 100): Promise<AsyncIterableIterator<Array<EventStoreEntity>>> {
    await this.init();
    return this.mapper
      .query(EventStoreEntity,{id: }, {
        pageSize: pageSize,
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

  resetStore = async () => {
    await this.mapper.deleteTable(EventStoreEntity);
    this.initialized = false;
    await this.init(true);
  };
}
