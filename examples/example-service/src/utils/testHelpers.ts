import { ConnectionOptions } from 'typeorm';
import { config } from '../config';
import { EventFlow, EventStoreService } from '@schemeless/event-store';
import { environment } from '../env';
import { OrderPackage, AccountPackage, allEventFlows } from '../../../core-domains';
import { v4 as uuid } from 'uuid';

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

export const defaultInMenDBOptionProjective: ConnectionOptions = Object.assign({}, defaultInMemDBOption, {
  name: config.serviceName
});
let eventStoreService: EventStoreService;

export const getTestEventStoreService = async () => {
  if (eventStoreService) {
    return eventStoreService;
  } else {
    eventStoreService = new EventStoreService(
      allEventFlows,
      defaultInMenDBOptionEventSourcing,
      environment.redisUrl,
      'test:' + uuid(),
      uuid()
    );
    await eventStoreService.isReady();
    return eventStoreService;
  }
};
