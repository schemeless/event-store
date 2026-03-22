import type {
  CreatedEvent,
  EventFlowMap,
  IEventStoreEntity,
} from '@schemeless/event-store-types';
import { AggregateError } from '@schemeless/event-store-types';
import { getEventFlow } from '../operators/getEventFlow';
import { isAggregateEventFlow } from '../operators/isAggregateEventFlow';
import { upcast } from '../eventLifeCycle/upcast';
import { logEvent } from '../util/logEvent';

export interface AggregateLoader {
  <State>(
    domain: string,
    identifier: string,
    reducer: (state: State, event: IEventStoreEntity) => State,
    initialState: State
  ): Promise<{ state: State; sequence: number }>;
}

export interface ProcessedEventLifecycle<Payload = any> {
  event: CreatedEvent<Payload>;
  aggregateState?: unknown;
  aggregateDomain?: string;
  aggregateIdentifier?: string;
}

export interface ProcessEventLifecycleOptions {
  aggregateStateByKey: Map<string, unknown>;
  loadAggregateStateFromRepo: boolean;
}

const aggregateKey = (domain: string, identifier: string) => `${domain}__${identifier}`;

export async function processEventLifecycle(
  event: CreatedEvent<any>,
  eventFlowMap: EventFlowMap,
  getAggregate: AggregateLoader | undefined,
  options: ProcessEventLifecycleOptions
): Promise<ProcessedEventLifecycle> {
  const flow = getEventFlow(eventFlowMap)(event);
  const upcastedEvent = await upcast(flow, event);

  let aggregateState: unknown = undefined;
  let aggregateDomain: string | undefined;
  let aggregateIdentifier: string | undefined;

  if (isAggregateEventFlow(flow)) {
    aggregateIdentifier = flow.aggregate.getIdentifier?.(upcastedEvent) ?? upcastedEvent.identifier;
    aggregateDomain = flow.domain;

    if (!aggregateIdentifier) {
      throw new AggregateError({ domain: flow.domain, type: flow.type }, 'no_identifier');
    }

    const key = aggregateKey(aggregateDomain, aggregateIdentifier);
    if (options.aggregateStateByKey.has(key)) {
      aggregateState = options.aggregateStateByKey.get(key);
    } else if (options.loadAggregateStateFromRepo) {
      if (!getAggregate) {
        throw new AggregateError({ domain: flow.domain, type: flow.type }, 'no_loader');
      }
      const result = await getAggregate(
        flow.domain,
        aggregateIdentifier,
        flow.aggregate.reducer,
        flow.aggregate.initialState
      );
      aggregateState = result.state;
    } else {
      aggregateState = flow.aggregate.initialState;
    }
  }

  if (flow.validate) {
    if (isAggregateEventFlow(flow)) {
      const error = await flow.validate(upcastedEvent, aggregateState);
      if (error instanceof Error) throw error;
    } else {
      const error = await flow.validate(upcastedEvent);
      if (error instanceof Error) throw error;
    }
  }
  logEvent(upcastedEvent, '☑️', 'verified');

  let finalEvent = upcastedEvent;
  if (flow.preApply) {
    const preApplied = await flow.preApply(upcastedEvent);
    if (preApplied) finalEvent = preApplied;
  }

  if (isAggregateEventFlow(flow)) {
    if (flow.apply) {
      const nextState = await flow.apply(finalEvent, aggregateState);
      if (typeof nextState === 'undefined') {
        throw new AggregateError({ domain: flow.domain, type: flow.type }, 'apply_must_return_state');
      }
      aggregateState = nextState;
    }

    const key = aggregateKey(aggregateDomain!, aggregateIdentifier!);
    options.aggregateStateByKey.set(key, aggregateState);
  } else if (flow.apply) {
    await flow.apply(finalEvent);
  }
  logEvent(finalEvent, '✅️', 'Apply');

  return {
    event: finalEvent,
    aggregateState,
    aggregateDomain,
    aggregateIdentifier,
  };
}
