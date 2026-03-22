import { EventProcessor } from './pipeline/EventProcessor';
import { makeRevert } from './revert/makeRevert';
import { makeReplay } from './makeReplay';
import { isAggregateEventFlow } from './operators/isAggregateEventFlow';
import { Subject } from 'rxjs';
import type { EventStore, EventStoreOptions, EventOutput, AggregateResult } from './EventStore.types';
import type {
  AggregateEventObserver,
  EventFlow,
  EventFlowMap,
  IEventStoreRepo,
  SuccessEventObserver,
  IEventStoreEntity,
} from '@schemeless/event-store-types';
import { AggregateError } from '@schemeless/event-store-types';

export const makeEventStore =
  (eventStoreRepo: IEventStoreRepo, options: EventStoreOptions = {}) =>
  async (
    eventFlows: EventFlow[],
    successEventObservers: Array<SuccessEventObserver<any> | AggregateEventObserver<any, any>> = []
  ): Promise<EventStore> => {
    const {
      mainQueueConcurrent = 1,
      sideEffectQueueConcurrent = 1,
    } = options;

    await eventStoreRepo.init();

    // Capability checks
    const declaredAggregateCapability = eventStoreRepo.capabilities?.aggregate;
    const capabilities: EventStore['capabilities'] = {
      aggregate: declaredAggregateCapability ?? !!eventStoreRepo.getStreamEvents,
    };

    const hasAggregateEventFlow = eventFlows.some(isAggregateEventFlow);
    if (hasAggregateEventFlow && !capabilities.aggregate) {
      const flow = eventFlows.find(isAggregateEventFlow);
      throw new AggregateError({ domain: flow?.domain as string, type: flow?.type as string }, 'capability_missing');
    }

    // Build getAggregate
    const getAggregate: EventStore['getAggregate'] = async <State>(
      domain: string,
      identifier: string,
      reducer: (state: State, event: IEventStoreEntity) => State,
      initialState: State
    ): Promise<AggregateResult<State>> => {
      const getStreamEvents = eventStoreRepo.getStreamEvents?.bind(eventStoreRepo);
      if (!capabilities.aggregate || !getStreamEvents) {
        throw new AggregateError({ domain, type: '*' }, 'capability_missing');
      }

      let state = initialState;
      let sequence = 0;

      if (eventStoreRepo.getSnapshot) {
        const snapshot = await eventStoreRepo.getSnapshot<State>(domain, identifier);
        if (snapshot) {
          state = snapshot.state;
          sequence = snapshot.sequence;
        }
      }

      const events = await getStreamEvents(domain, identifier, sequence);
      for (const event of events) {
        state = reducer(state, event);
        sequence = event.sequence || 0;
      }

      return { state, sequence };
    };

    // Build EventFlowMap for revert
    const eventFlowMap: EventFlowMap = {};
    for (const flow of eventFlows) {
      eventFlowMap[`${flow.domain}__${flow.type}`] = flow;
    }

    // Create processor
    const processor = new EventProcessor(
      eventStoreRepo,
      eventFlows,
      successEventObservers,
      capabilities.aggregate ? getAggregate : undefined,
      {
        mainConcurrency: mainQueueConcurrent,
        sideEffectConcurrency: sideEffectQueueConcurrent,
      }
    );

    // Deprecated output$ compatibility via Subject
    const outputSubject = new Subject<EventOutput>();
    const unsubOutput = processor.onProcessed((output) => outputSubject.next(output));

    // Revert
    const { canRevert, previewRevert, revert } = makeRevert({
      repo: eventStoreRepo,
      eventFlowMap,
      storeEvents: (events) => eventStoreRepo.storeEvents(events),
    });

    // Submit (new V4+ API)
    const submit: EventStore['submit'] = (flow, input) => processor.submit(flow, input);

    // Receive (deprecated, V3 compat)
    const receiveHandler = (flow: EventFlow) => (input: any) => processor.submit(flow, input);

    const store: EventStore = {
      // New API
      submit,
      on: (event, handler) => {
        if (event !== 'processed') throw new Error(`Unknown event: ${event}`);
        return processor.onProcessed(handler);
      },

      // Deprecated but maintained for V4 compat
      get mainQueue(): any {
        return null as any; // removed in v5
      },
      get sideEffectQueue(): any {
        return null as any; // removed in v5
      },
      receive: receiveHandler as any,
      output$: outputSubject.asObservable(),

      // Unchanged
      replay: makeReplay(eventFlows, successEventObservers, eventStoreRepo),
      eventStoreRepo,
      capabilities,
      getAggregate,
      canRevert,
      previewRevert,
      revert,

      shutdown: async (timeout = 5000) => {
        await processor.shutdown(timeout);
        unsubOutput();
        outputSubject.complete();
      },
    };

    return store;
  };
