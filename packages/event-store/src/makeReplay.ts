import type {
  AggregateEventObserver,
  CreatedEvent,
  EventFlow,
  IEventStoreRepo,
  SuccessEventObserver,
} from '@schemeless/event-store-types';
import { registerEventFlowTypes } from './operators/registerEventFlowTypes';
import { logger } from './util/logger';
import { runObservers, ProcessedEventWithState } from './pipeline/ObserverRunner';
import { processEventLifecycle } from './pipeline/processEventLifecycle';

export const makeReplay =
  (
    eventFlows: EventFlow[],
    successEventObservers: Array<SuccessEventObserver<any> | AggregateEventObserver<any, any>> = [],
    eventStoreRepo: IEventStoreRepo
  ) =>
  async (startFromId?: string) => {
    const eventFlowMap = registerEventFlowTypes({}, eventFlows);
    let pageSize = 200;
    logger.info('replay starting');
    const eventStoreIterator = await eventStoreRepo.getAllEvents(pageSize, startFromId);
    const aggregateStateByAggregateKey = new Map<string, unknown>();

    for await (const events of eventStoreIterator) {
      if (events.length > 0) {
        logger.info(`replaying ${events.length}`);

        for (const rawEvent of events) {
          Object.assign(rawEvent, { created: new Date(rawEvent.created) });
          const currentEvent = rawEvent as CreatedEvent<any>;
          const processedEvent = await processEventLifecycle(currentEvent, eventFlowMap, undefined, {
            aggregateStateByKey: aggregateStateByAggregateKey,
            loadAggregateStateFromRepo: false,
          });

          const processed: ProcessedEventWithState = {
            event: processedEvent.event,
            aggregateState: processedEvent.aggregateState,
          };

          await runObservers([processed], successEventObservers);
        }
      } else {
        logger.info(`replay apply done, waiting for observer finished`);
        break;
      }
    }
  };
