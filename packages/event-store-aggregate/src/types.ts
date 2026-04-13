import type {
  AppendableEvent,
  PersistedEvent,
  Snapshot,
  StreamAppendableEvent,
  StreamEventStoreAdapter,
} from '@schemeless/event-store-types';
export { InvalidIdentifierError, StreamConcurrencyError } from '@schemeless/event-store-types';
export type { PersistedEvent, Snapshot } from '@schemeless/event-store-types';

export type DomainEvent = PersistedEvent;
export type DecidedEvent = AppendableEvent;

export interface AggregateContext {
  identifier: string;
  sequence: number;
}

export interface PhaseContext extends AggregateContext {}

export interface AggregateDefinition<Command, Event extends DecidedEvent, State> {
  name: string;
  domain: string;
  getIdentifier(command: Command): string;
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

export interface HandleResult<Event extends DecidedEvent, State> extends HydratedAggregate<State> {
  events: Event[];
}

export interface SnapshotFailureInfo<State = unknown> {
  aggregateName: string;
  domain: string;
  identifier: string;
  command: unknown;
  snapshot: Snapshot<State>;
}

export interface AggregateRuntimeOptions {
  onSnapshotError?(error: unknown, info: SnapshotFailureInfo): void;
}

export interface AggregateRuntime {
  handle<C, E extends DecidedEvent, S>(
    aggregate: AggregateDefinition<C, E, S>,
    command: C
  ): Promise<HandleResult<E, S>>;
  hydrate<E extends DecidedEvent, S>(
    aggregate: AggregateDefinition<any, E, S>,
    identifier: string
  ): Promise<HydratedAggregate<S>>;
}

export type AggregateRuntimeAdapter = Pick<
  StreamEventStoreAdapter,
  'getStreamEvents' | 'appendToStream' | 'getSnapshot' | 'saveSnapshot'
>;

export type CanonicalStreamEvent<Payload = any> = StreamAppendableEvent<Payload>;
