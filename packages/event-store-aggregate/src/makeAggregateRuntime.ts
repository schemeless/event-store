import type { AggregateDefinition, AggregateRuntime, AggregateRuntimeAdapter } from './types';

export const makeAggregateRuntime = (adapter: AggregateRuntimeAdapter): AggregateRuntime => {
  const hydrate: AggregateRuntime['hydrate'] = async (aggregate, identifier) => {
    let state = aggregate.initialState as any;
    let sequence = 0;

    const snapshot = await adapter.getSnapshot?.(aggregate.domain, identifier);
    if (snapshot) {
      state = snapshot.state;
      sequence = snapshot.sequence;
    }

    const events = await adapter.getStreamEvents(aggregate.domain, identifier, sequence);
    for (const event of events) {
      state = aggregate.evolve(state, event as any);
      sequence = event.sequence ?? sequence;
    }

    return { identifier, state, sequence };
  };

  const handle: AggregateRuntime['handle'] = async (aggregate, command) => {
    const identifier = aggregate.getIdentifier(command);
    const hydrated = await hydrate(aggregate, identifier);
    const ctx = { identifier, sequence: hydrated.sequence };

    await aggregate.precondition?.(command, hydrated.state, ctx);
    const events = await aggregate.decide(command, hydrated.state, ctx);
    const canonicalEvents = events.map((event) => ({
      ...event,
      identifier,
      domain: aggregate.domain,
    }));

    let nextState = hydrated.state;
    for (const event of canonicalEvents) {
      await aggregate.validateEvent?.(event, nextState, ctx);
      nextState = aggregate.evolve(nextState, event as any);
    }

    const appendResult = await adapter.appendToStream(canonicalEvents, hydrated.sequence);
    const nextVersion = appendResult.nextVersion;

    try {
      await adapter.saveSnapshot?.({
        domain: aggregate.domain,
        identifier,
        state: nextState,
        sequence: nextVersion,
        created: new Date(),
      });
    } catch {
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
