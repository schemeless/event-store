import type { PersistedEvent, StreamEventStoreAdapter } from '@schemeless/event-store-types';
export type { PersistedEvent, Snapshot } from '@schemeless/event-store-types';

export class StreamConcurrencyError extends Error {
  constructor(
    public readonly domain: string,
    public readonly identifier: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number
  ) {
    super(
      `Concurrency conflict on stream "${domain}/${identifier}": expected version ${expectedVersion}, but found ${actualVersion}`
    );
    this.name = 'StreamConcurrencyError';
  }
}

export type DomainEvent = PersistedEvent;

export interface AggregateContext {
  identifier: string;
  sequence: number;
}

export interface PhaseContext extends AggregateContext {}

export interface AggregateDefinition<Command, Event extends DomainEvent, State> {
  name: string;
  domain: string;
  getIdentifier(input: Command | Event): string;
  initialState: State;
  evolve(state: State, event: Event): State;
  precondition?(command: Command, state: State, ctx: AggregateContext): Promise<void> | void;
  decide(command: Command, state: State, ctx: AggregateContext): Promise<Event[]> | Event[];
  validateEvent?(event: Event, state: State, ctx: PhaseContext): Promise<void> | void;
}

export interface HydratedAggregate<State> {
  identifier: string;
  state: State;
  sequence: number;
}

export interface HandleResult<Event extends DomainEvent, State> extends HydratedAggregate<State> {
  events: Event[];
}

export interface AggregateRuntime {
  handle<C, E extends DomainEvent, S>(aggregate: AggregateDefinition<C, E, S>, command: C): Promise<HandleResult<E, S>>;
  hydrate<E extends DomainEvent, S>(
    aggregate: AggregateDefinition<any, E, S>,
    identifier: string
  ): Promise<HydratedAggregate<S>>;
}

export type AggregateRuntimeAdapter = Pick<
  StreamEventStoreAdapter,
  'getStreamEvents' | 'appendToStream' | 'getSnapshot' | 'saveSnapshot'
>;
