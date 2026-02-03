import 'reflect-metadata';

import { EventStoreRepo } from './EventStore.repo';
import { CreatedEvent } from '@schemeless/event-store-types';
import { DataSourceOptions } from 'typeorm';

const defaultInMemDBOption = {
  type: 'sqlite',
  database: ':memory:',
  dropSchema: true,
  synchronize: true,
  logger: 'advanced-console',
  logging: ['error', 'warn'],
} as DataSourceOptions;

const makeEvent = (num: number): CreatedEvent<any, any> => {
  const d = new Date(Date.now() + num * 1000);
  return {
    id: `event-${num.toString().padStart(6, '0')}`,
    domain: 'test',
    type: 'test',
    payload: { id: num },

    created: d,
  };
};
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
  it('should make replay after works', async () => {
    const eventStoreRepo = new EventStoreRepo(defaultInMemDBOption);
    const eventsToStore = [...new Array(500).keys()].map(makeEvent);
    await eventStoreRepo.init();
    await eventStoreRepo.storeEvents(eventsToStore);
    let pages = await eventStoreRepo.getAllEvents(100);
    let allEvents: CreatedEvent<any, any>[] = [];
    for await (const events of pages) {
      allEvents = allEvents.concat(events);
    }
    const stopped = allEvents[199];
    pages = await eventStoreRepo.getAllEvents(100, stopped.id);
    allEvents = [];
    for await (const events of pages) {
      allEvents = allEvents.concat(events);
    }
    expect(allEvents.length).toBe(300);
  });
});
