import type {
  BaseEvent,
  CreatedEvent,
  EventFlowMap,
  IEventStoreEntity,
} from '@schemeless/event-store-types';
import { AggregateError } from '@schemeless/event-store-types';
import { defaultEventCreator } from '../operators/defaultEventCreator';
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

export interface ProcessEventTreeOptions {
  maxDepth?: number;
}

export interface ProcessedEvent<Payload = any> {
  event: CreatedEvent<Payload>;
  /** Aggregate state after apply, if this was an aggregate event. undefined for simple events. */
  aggregateState?: unknown;
  /** Aggregate domain, for cache keying */
  aggregateDomain?: string;
  /** Aggregate identifier, for cache keying */
  aggregateIdentifier?: string;
}

export interface ProcessResult {
  events: ProcessedEvent[];
}

export class EventTreeProcessError extends Error {
  constructor(public originalError: unknown, public appliedEvents: ProcessedEvent[]) {
    super(originalError instanceof Error ? originalError.message : String(originalError));
    this.name = 'EventTreeProcessError';
  }
}

/**
 * Process an event and all its consequent events depth-first.
 * 
 * This is a pure async function with no side effects beyond calling
 * the EventFlow lifecycle hooks (validate, preApply, apply, createConsequentEvents).
 * 
 * Aggregate state is passed through the `applied` array — no global cache needed.
 */
export async function processEventTree(
  rootInput: BaseEvent<any>,
  eventFlowMap: EventFlowMap,
  getAggregate: AggregateLoader | undefined,
  options: ProcessEventTreeOptions = {}
): Promise<ProcessResult> {
  const { maxDepth = 10 } = options;
  const applied: ProcessedEvent[] = [];

  // Explicit stack for depth-first traversal
  const stack: Array<{
    input: BaseEvent<any>;
    causalEvent?: CreatedEvent<any>;
    depth: number;
  }> = [{ input: rootInput, depth: 0 }];

  try {
    while (stack.length > 0) {
      const { input, causalEvent, depth } = stack.pop()!;

      if (depth > maxDepth) {
        throw new Error(
          `Event tree exceeded max depth ${maxDepth}. Root: ${rootInput.domain}/${rootInput.type}. ` +
          `This usually indicates a circular consequent event chain.`
        );
      }

      // 1. Create event (assign ID, timestamps, causation/correlation chain)
      const event = defaultEventCreator(input, causalEvent);
      const flow = getEventFlow(eventFlowMap)(event);

      // 2. Upcast (schema migration)
      const upcastedEvent = await upcast(flow, event);

      // 3. Load aggregate state if needed
      let aggregateState: unknown = undefined;
      let aggregateDomain: string | undefined;
      let aggregateIdentifier: string | undefined;

      if (isAggregateEventFlow(flow)) {
        aggregateIdentifier = flow.aggregate.getIdentifier?.(upcastedEvent) ?? upcastedEvent.identifier;
        aggregateDomain = flow.domain;

        if (!aggregateIdentifier) {
          throw new AggregateError(
            { domain: flow.domain, type: flow.type },
            'no_identifier'
          );
        }

        // Look for the most recent state in already-applied events (local context)
        aggregateState = findLatestAggregateState(applied, flow.domain, aggregateIdentifier);

        if (aggregateState === undefined) {
          // Load from repository
          if (!getAggregate) {
            throw new AggregateError(
              { domain: flow.domain, type: flow.type },
              'no_loader'
            );
          }
          const result = await getAggregate(
            flow.domain,
            aggregateIdentifier,
            flow.aggregate.reducer,
            flow.aggregate.initialState
          );
          aggregateState = result.state;
        }
      }

      // 4. Validate
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

      // 5. PreApply
      let finalEvent = upcastedEvent;
      if (flow.preApply) {
        const preApplied = await flow.preApply(upcastedEvent);
        if (preApplied) finalEvent = preApplied;
      }

      // 6. Apply
      if (isAggregateEventFlow(flow)) {
        if (flow.apply) {
          const nextState = await flow.apply(finalEvent, aggregateState);
          if (typeof nextState === 'undefined') {
            throw new AggregateError(
              { domain: flow.domain, type: flow.type },
              'apply_must_return_state'
            );
          }
          aggregateState = nextState;
        }
      } else {
        if (flow.apply) {
          await flow.apply(finalEvent);
        }
      }
      logEvent(finalEvent, '✅️', 'Apply');

      // 7. Record applied event
      applied.push({
        event: finalEvent,
        aggregateState,
        aggregateDomain,
        aggregateIdentifier,
      });

      // 8. Generate consequent events and push onto stack (reverse order for correct DFS)
      if (flow.createConsequentEvents) {
        const consequents = await flow.createConsequentEvents(finalEvent);
        if (consequents && consequents.length > 0) {
          // Inject schemaVersion into consequent events
          for (let i = consequents.length - 1; i >= 0; i--) {
            const ce = consequents[i];
            const ceFlow = getEventFlow(eventFlowMap)(ce as any);
            ce.meta = {
              ...(ce.meta || {}),
              schemaVersion: ceFlow?.schemaVersion || 1,
            };
            stack.push({
              input: ce,
              causalEvent: finalEvent,
              depth: depth + 1,
            });
          }
        }
      }
    }
  } catch (err) {
    throw new EventTreeProcessError(err, applied);
  }

  return { events: applied };
}

/**
 * Find the most recent aggregate state for a given domain+identifier
 * from the already-processed events in this tree.
 */
function findLatestAggregateState(
  applied: ProcessedEvent[],
  domain: string,
  identifier: string
): unknown | undefined {
  for (let i = applied.length - 1; i >= 0; i--) {
    const p = applied[i];
    if (
      p.aggregateDomain === domain &&
      p.aggregateIdentifier === identifier &&
      p.aggregateState !== undefined
    ) {
      return p.aggregateState;
    }
  }
  return undefined;
}
