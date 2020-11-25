import { EventStoreRepo } from './EventStore.dynamodb.repo';
import { CreatedEvent } from '@schemeless/event-store-types';
import { v4 as uuid } from 'uuid';
import { EventStoreEntity } from './EventStore.dynamodb.entity';

const makeEvent = (): CreatedEvent<any, any> => ({
  id: uuid(),
  domain: 'test',
  type: 'test',
  payload: { id: 'test' },

  created: new Date(Date.now() + Math.round(1000 * 1000 * Math.random())),
});
describe('EventStore Dynamodb', () => {
  const eventStoreRepo = new EventStoreRepo('test', {
    region: 'us-east-2',
    endpoint: 'http://127.0.0.1:8000',
  });

  beforeAll(async () => {
    await eventStoreRepo.mapper.deleteTable(EventStoreEntity);
  });

  it('should save events', async () => {
    const events = [...new Array(100).keys()].map(makeEvent);
    await eventStoreRepo.storeEvents(events);
  });
  it('should load events', async () => {
    const pages = await eventStoreRepo.getAllEvents(100);
    for await (const events of pages) {
      console.log(events);
    }
  });
});
