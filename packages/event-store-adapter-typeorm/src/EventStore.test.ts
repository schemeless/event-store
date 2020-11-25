import { EventStoreRepo } from './EventStore.repo';
import { CreatedEvent } from '@schemeless/event-store-types';
import { v4 as uuid } from 'uuid';
import { ConnectionOptions } from 'typeorm';

const defaultInMemDBOption = {
  type: 'sqlite',
  database: ':memory:',
  dropSchema: true,
  synchronize: true,
  logger: 'advanced-console',
  logging: ['error', 'warn'],
} as ConnectionOptions;

const makeEvent = (): CreatedEvent<any, any> => ({
  id: uuid(),
  domain: 'test',
  type: 'test',
  payload: { id: 'test' },

  created: new Date(Date.now() + Math.round(1000 * 1000 * Math.random())),
});
describe('EventStore Typeorm', () => {
  it('should make 500 events works', async () => {
    const eventStoreRepo = new EventStoreRepo(defaultInMemDBOption);
    const eventsToStore = [...new Array(500).keys()].map(makeEvent);
    await eventStoreRepo.init();
    await eventStoreRepo.storeEvents(eventsToStore);
    const pages = await eventStoreRepo.getAllEvents(100);
    let allEvents: CreatedEvent<any, any>[] = [];
    for await (const events of pages) {
      allEvents = allEvents.concat(events);
    }
    expect(allEvents.length).toBe(500);
    const rightOrder = allEvents.every((currentEvent, index) => {
      const nextEvent = allEvents[index + 1];
      if (!nextEvent) return true;
      console.log(nextEvent);
      return nextEvent.created >= currentEvent.created;
    });
    expect(rightOrder).toBe(true);
  });
});
