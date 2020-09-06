import { ConnectionOptions } from 'typeorm';
import { makeEventStore } from '../makeEventStore';
import { EventFlow, EventStore, SuccessEventObserver } from '../EventStore.types';

const defaultInMemDBOption = {
  type: 'sqlite',
  database: ':memory:',
  dropSchema: true,
  synchronize: true,
  logger: 'advanced-console',
  logging: 'all'
} as ConnectionOptions;

const defaultInMenDBOptionEventSourcing: ConnectionOptions = Object.assign({}, defaultInMemDBOption, {
  name: 'EventSourcing'
});

let eventStore: EventStore;

export const getTestEventStore = async (
  allEventFlows: EventFlow[],
  successEventObservers: SuccessEventObserver<any>[]
) => {
  if (eventStore) {
    return eventStore;
  } else {
    eventStore = await makeEventStore(defaultInMenDBOptionEventSourcing)(allEventFlows, successEventObservers);
    eventStore.output$.subscribe(console.log);
    return eventStore;
  }
};
