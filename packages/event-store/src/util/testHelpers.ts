import type { EventFlow, SuccessEventObserver } from '@schemeless/event-store-types';
import { EventStoreRepo } from '@schemeless/event-store-adapter-typeorm';
// import { EventStoreRepo } from '@schemeless/event-store-adapter-dynamodb';
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
    // const eventStoreRepo = new EventStoreRepo('test', {
    //   region: 'us-east-2',
    //   endpoint: 'http://127.0.0.1:8000',
    // });
    eventStore = await makeEventStore(eventStoreRepo)(allEventFlows, successEventObservers);
    return eventStore;
  }
};

/**
 * Shuts down the cached test event store instance.
 * Should be called in afterAll() of test files.
 */
export const shutdownEventStore = async (): Promise<void> => {
  if (eventStore) {
    await eventStore.shutdown(2000);
    eventStore = null as any;
  }
};
