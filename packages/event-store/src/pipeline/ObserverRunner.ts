import type {
  AggregateEventObserver,
  CreatedEvent,
  SuccessEventObserver,
} from '@schemeless/event-store-types';
import { logEvent } from '../util/logEvent';
import { logger } from '../util/logger';

type Observer = SuccessEventObserver<any> | AggregateEventObserver<any, any>;

interface ObserverMap {
  [domainType: string]: Observer[];
}

function buildObserverMap(observers: Observer[]): ObserverMap {
  const map: ObserverMap = {};
  for (const observer of observers) {
    for (const filter of observer.filters) {
      const key = `${filter.domain}__${filter.type}`;
      if (!map[key]) map[key] = [];
      map[key].push(observer);
    }
  }
  return map;
}

export interface ProcessedEventWithState {
  event: CreatedEvent<any>;
  aggregateState?: unknown;
}

/**
 * Run observers for a batch of processed events.
 * Observers are applied in priority order.
 * Fire-and-forget observers are not awaited.
 */
export async function runObservers(
  events: ProcessedEventWithState[],
  observers: Observer[]
): Promise<void> {
  if (observers.length === 0) return;

  const observerMap = buildObserverMap(observers);

  for (const { event, aggregateState } of events) {
    const key = `${event.domain}__${event.type}`;
    const matching = observerMap[key];
    if (!matching || matching.length === 0) {
      logEvent(event, '👀', 'No observers');
      continue;
    }

    // Sort by priority (ascending)
    const sorted = [...matching].sort((a, b) => a.priority - b.priority);

    for (const observer of sorted) {
      const isAggregate = (observer as AggregateEventObserver<any, any>).aggregate === true;

      const applyFn = async () => {
        if (isAggregate) {
          if (aggregateState === undefined) {
            throw new Error(
              `Aggregate observer for ${event.domain}/${event.type} expected aggregate state but none was available`
            );
          }
          await (observer as AggregateEventObserver<any, any>).apply?.(event, aggregateState);
        } else {
          await (observer as SuccessEventObserver<any>).apply?.(event);
        }
      };

      if (observer.fireAndForget) {
        applyFn().catch((err) => {
          logger.error(`Fire-and-forget observer failed: ${err}`);
        });
      } else {
        await applyFn();
      }
    }

    logEvent(event, '👀', 'Applied observers');
  }
}
