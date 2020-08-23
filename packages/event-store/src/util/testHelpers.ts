import { ConnectionOptions } from 'typeorm';
import { makeEventStore } from '../makeEventStore';
import { EventFlow, EventStore } from '../EventStore.types';

const defaultInMemDBOption = {
  type: 'sqlite',
  database: ':memory:',
  dropSchema: true,
  synchronize: true,
  logger: 'advanced-console',
  logging: ['error', 'warn']
} as ConnectionOptions;

const defaultInMenDBOptionEventSourcing: ConnectionOptions = Object.assign({}, defaultInMemDBOption, {
  name: 'EventSourcing'
});

let eventStore: EventStore;

export const getTestEventStore = async (allEventFlows: EventFlow[]) => {
  if (eventStore) {
    return eventStore;
  } else {
    eventStore = await makeEventStore(defaultInMenDBOptionEventSourcing)(allEventFlows);
    eventStore.output$.subscribe();
    return eventStore;
  }
};
