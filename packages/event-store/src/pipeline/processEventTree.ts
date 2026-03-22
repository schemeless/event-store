import type {
  BaseEvent,
  CreatedEvent,
  EventFlowMap,
} from '@schemeless/event-store-types';
import { defaultEventCreator } from '../operators/defaultEventCreator';
import { getEventFlow } from '../operators/getEventFlow';
import {
  AggregateLoader,
  ProcessedEventLifecycle,
  processEventLifecycle,
} from './processEventLifecycle';
export type { AggregateLoader } from './processEventLifecycle';

export interface ProcessEventTreeOptions {
  maxDepth?: number;
}

export type ProcessedEvent<Payload = any> = ProcessedEventLifecycle<Payload>;

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
 * the EventFlow lifecycle hooks (upcast, validate, preApply, apply, createConsequentEvents).
 *
 * Aggregate state is passed through a local map — no global cache needed.
 */
export async function processEventTree(
  rootInput: BaseEvent<any>,
  eventFlowMap: EventFlowMap,
  getAggregate: AggregateLoader | undefined,
  options: ProcessEventTreeOptions = {}
): Promise<ProcessResult> {
  const { maxDepth = 10 } = options;
  const applied: ProcessedEvent[] = [];
  const aggregateStateByKey = new Map<string, unknown>();

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
      const processed = await processEventLifecycle(event, eventFlowMap, getAggregate, {
        aggregateStateByKey,
        loadAggregateStateFromRepo: true,
      });

      // 7. Record applied event
      applied.push(processed);

      // 8. Generate consequent events and push onto stack (reverse order for correct DFS)
      const flow = getEventFlow(eventFlowMap)(processed.event);
      if (flow.createConsequentEvents) {
        const consequents = await flow.createConsequentEvents(processed.event);
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
              causalEvent: processed.event,
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
