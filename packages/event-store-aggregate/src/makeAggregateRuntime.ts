import { InvalidIdentifierError } from '@schemeless/event-store-types';
import type {
  AggregateDefinition,
  AggregateRuntime,
  AggregateRuntimeAdapter,
  AggregateRuntimeOptions,
  CanonicalStreamEvent,
  DecidedEvent,
} from './types';

function assertAggregateIdentifier(identifier: string, aggregateName: string): string {
  if (typeof identifier !== 'string' || identifier.trim().length === 0) {
    throw new InvalidIdentifierError(`Aggregate "${aggregateName}" returned an empty identifier`);
  }
  return identifier;
}

export const makeAggregateRuntime = (
  adapter: AggregateRuntimeAdapter,
  options: AggregateRuntimeOptions = {}
): AggregateRuntime => {
  const hydrate: AggregateRuntime['hydrate'] = async (aggregate, identifier) => {
    const canonicalIdentifier = assertAggregateIdentifier(identifier, aggregate.name);
    let state = aggregate.initialState as any;
    let sequence = 0;

    const snapshot = await adapter.getSnapshot?.(aggregate.domain, canonicalIdentifier);
    if (snapshot) {
      state = snapshot.state;
      sequence = snapshot.sequence;
    }

    const events = await adapter.getStreamEvents(aggregate.domain, canonicalIdentifier, sequence);
    for (const event of events) {
      state = aggregate.evolve(state, event as any);
      sequence = event.sequence ?? sequence;
    }

    return { identifier: canonicalIdentifier, state, sequence };
  };

  const handle: AggregateRuntime['handle'] = async <C, E extends DecidedEvent, S>(
    aggregate: AggregateDefinition<C, E, S>,
    command: C
  ) => {
    const identifier = assertAggregateIdentifier(aggregate.getIdentifier(command), aggregate.name);
    const hydrated = await hydrate(aggregate, identifier);
    const ctx = { identifier, sequence: hydrated.sequence };

    await aggregate.precondition?.(command, hydrated.state, ctx);
    const events = await aggregate.decide(command, hydrated.state, ctx);
    const canonicalEvents = events.map((event) => ({
      ...event,
      identifier,
      domain: aggregate.domain,
    })) as E[];

    let nextState = hydrated.state;
    for (const event of canonicalEvents) {
      await aggregate.validateEvent?.(event, nextState, ctx);
      nextState = aggregate.evolve(nextState, event as any);
    }

    const appendResult = await adapter.appendToStream(canonicalEvents as CanonicalStreamEvent[], hydrated.sequence);
    const nextVersion = appendResult.nextVersion;
    const snapshot = {
      domain: aggregate.domain,
      identifier,
      state: nextState,
      sequence: nextVersion,
      created: new Date(),
    };

    try {
      await adapter.saveSnapshot?.(snapshot);
    } catch (error) {
      if (options.onSnapshotError) {
        options.onSnapshotError(error, {
          aggregateName: aggregate.name,
          domain: aggregate.domain,
          identifier,
          command,
          snapshot,
        });
      } else {
        console.error(
          `[AggregateRuntime] Failed to save snapshot for "${aggregate.domain}/${identifier}" after append success:`,
          error
        );
      }
      // Snapshotting is an optimization; append success must still win.
    }

    return {
      identifier,
      sequence: nextVersion,
      state: nextState,
      events: canonicalEvents,
    };
  };

  return { hydrate, handle };
};
