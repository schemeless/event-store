import { EventStoreService } from '@schemeless/event-store';
import { config } from '../../config';
import { environment } from '../../env';
import { allEventFlows } from '../../../../core-domains';

const connectionOptions = Object.assign({}, config.dbConnections.eventStore, {
  url: environment.EventSourceDbURL
}) as any;

let eventStoreService: EventStoreService;

export const getEventStoreService = async (): Promise<EventStoreService> => {
  if (eventStoreService) {
    return eventStoreService;
  } else {
    eventStoreService = new EventStoreService(
      allEventFlows,
      connectionOptions,
      environment.redisUrl,
      environment.eventStore.waitQueuePrefix,
      environment.eventStore.applyQueuePrefix
    );
    await eventStoreService.isReady();
    return eventStoreService;
  }
};
