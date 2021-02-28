import { EventStoreRepo } from './EventStore.dynamodb.repo';
import { CreatedEvent } from '@schemeless/event-store-types';
import { EventStoreEntity } from './EventStore.dynamodb.entity';

const makeEvent = (id: string | number): CreatedEvent<any, any> => ({
  id: id + '',
  domain: 'test',
  type: 'test',
  payload: { id: 'test' },

  created: new Date(Date.now() + Math.round(1000 * 1000 * +id)),
});
describe('EventStore Dynamodb', () => {
  it('should make 50 events works', async () => {
    const eventStoreRepo = new EventStoreRepo('test', {
      region: 'us-east-2',
      endpoint: 'http://192.168.1.11:8000',
    });
    try {
      await eventStoreRepo.mapper.deleteTable(EventStoreEntity);
    } catch {}
    const eventsToStore = [...new Array(50).keys()].map(makeEvent);
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
    const eventStoreRepo = new EventStoreRepo('test', {
      region: 'us-east-2',
      endpoint: 'http://192.168.1.11:8000',
    });
    try {
      await eventStoreRepo.mapper.deleteTable(EventStoreEntity);
    } catch {}
    const eventsToStore = [...new Array(5000).keys()].map(makeEvent);
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
});
