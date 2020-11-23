import type { EventFlow, SuccessEventObserver } from '@schemeless/event-store-types';
import { EventStoreRepo } from '@schemeless/event-store-adapter-typeorm';
import { ConnectionOptions } from 'typeorm';
import { makeEventStore } from '../makeEventStore';
import { EventStore } from '../EventStore.types';

const defaultInMemDBOption = {
  type: 'sqlite',
  database: ':memory:',
  dropSchema: true,
  synchronize: true,
  logger: 'advanced-console',
  logging: 'all',
} as ConnectionOptions;

const defaultInMenDBOptionEventSourcing: ConnectionOptions = Object.assign({}, defaultInMemDBOption, {
  name: 'EventSourcing',
});

let eventStore: EventStore;

export const getTestEventStore = async (
  allEventFlows: EventFlow[],
  successEventObservers: SuccessEventObserver<any>[]
) => {
  if (eventStore) {
    return eventStore;
  } else {
    const eventStoreRepo = new EventStoreRepo(defaultInMenDBOptionEventSourcing);
    eventStore = await makeEventStore(eventStoreRepo)(allEventFlows, successEventObservers);
    eventStore.output$.subscribe(console.log);
    return eventStore;
  }
};
