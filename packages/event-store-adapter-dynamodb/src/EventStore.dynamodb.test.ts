import { EventStoreRepo } from './EventStore.dynamodb.repo';
import { CreatedEvent } from '@schemeless/event-store-types';
import { EventStoreEntity } from './EventStore.dynamodb.entity';
import { DynamoDB, S3 } from 'aws-sdk';

const makeEvent = (id: string | number, payload: any = { id: 'test' }): CreatedEvent<any, any> => ({
  id: id + '',
  domain: 'test',
  type: 'test',
  payload,

  created: new Date(Date.now() + Math.round(1000 * 1000 * +id)),
});
const dynamodbClient = new DynamoDB({
  region: 'ap-southeast-2',
  endpoint: 'http://192.168.1.146:8019',
});

const s3Client = new S3({
  endpoint: 'http://192.168.1.146:8020',
});
describe('EventStore Dynamodb', () => {
  it('should make 50 events works', async () => {
    const eventStoreRepo = new EventStoreRepo(dynamodbClient, s3Client, {
      s3BucketName: 'test-bucket.mock',
      tableNamePrefix: 'test1',
    });
    try {
      await eventStoreRepo.mapper.deleteTable(EventStoreEntity);
    } catch {}
    const eventsToStore = [...new Array(50).keys()].map((_) => makeEvent(_));
    await eventStoreRepo.init(true);
    await eventStoreRepo.storeEvents(eventsToStore);
    const pages = await eventStoreRepo.getAllEvents(100);
    let allEvents: CreatedEvent<any, any>[] = [];
    for await (const events of pages) {
      allEvents = allEvents.concat(events);
    }
    expect(allEvents.length).toBe(50);
    const rightOrder = allEvents.every((currentEvent, index) => {
      const nextEvent = allEvents[index + 1];
      if (!nextEvent) return true;
      return nextEvent.created >= currentEvent.created;
    });
    expect(rightOrder).toBe(true);
  });

  it('should make 5000 events works', async () => {
    const eventStoreRepo = new EventStoreRepo(dynamodbClient, s3Client, {
      s3BucketName: 'test-bucket.mock',
      tableNamePrefix: 'test2',
    });
    try {
      await eventStoreRepo.mapper.deleteTable(EventStoreEntity);
    } catch {}
    const eventsToStore = [...new Array(5000).keys()].map((_) => makeEvent(_));
    await eventStoreRepo.init(true);
    await eventStoreRepo.storeEvents(eventsToStore);
    const pages = await eventStoreRepo.getAllEvents(100);
    let allEvents: CreatedEvent<any, any>[] = [];
    for await (const events of pages) {
      allEvents = allEvents.concat(events);
    }
    expect(allEvents.length).toBe(5000);
    const rightOrder = allEvents.every((currentEvent, index) => {
      const nextEvent = allEvents[index + 1];
      if (!nextEvent) return true;
      return nextEvent.created >= currentEvent.created;
    });
    expect(rightOrder).toBe(true);
  });

  it('should make big event work', async () => {
    const eventStoreRepo = new EventStoreRepo(dynamodbClient, s3Client, {
      s3BucketName: 'test-bucket.mock',
      tableNamePrefix: 'test3',
    });
    try {
      await eventStoreRepo.mapper.deleteTable(EventStoreEntity);
    } catch {}
    const eventsToStore = [...new Array(50).keys()].map((_) => makeEvent(_, 'a'.repeat(400 * 1000)));
    await eventStoreRepo.init(true);
    await eventStoreRepo.storeEvents(eventsToStore);
    const pages = await eventStoreRepo.getAllEvents(100);
    let allEvents: CreatedEvent<any, any>[] = [];
    for await (const events of pages) {
      allEvents = allEvents.concat(events);
    }
    expect(allEvents.length).toBe(50);
    expect(allEvents[0].payload.length).toBe(400 * 1000);
  });
});
