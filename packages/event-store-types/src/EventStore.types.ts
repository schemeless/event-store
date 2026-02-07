/**
 * Base metadata for all events.
 * Framework automatically populates schemaVersion.
 * User code can extend this interface for custom metadata.
 */
export interface EventMeta {
  /** Schema version of the event payload */
  schemaVersion?: number;
  /** Flag indicating this is a compensating event */
  isCompensating?: boolean;
  /** ID of the event being compensated */
  compensatesEventId?: string;
  /** Allow arbitrary extensions */
  [key: string]: any;
}

export interface BaseEventInput<Payload, META extends EventMeta = EventMeta> {
  payload: Payload;
  meta?: META;

  identifier?: string;
  correlationId?: string;
  /**
   * @deprecated Will be removed in v3.0.
   * causationId is now managed exclusively by the framework.
   * Do not set this field manually.
   */
  causationId?: string;

  created?: Date;
}

export interface BaseEvent<Payload, META extends EventMeta = EventMeta> extends BaseEventInput<Payload, META> {
  id?: string;
  domain: string;
  type: string;
  payload: Payload;

  identifier?: string;
  correlationId?: string;
  causationId?: string;

  created?: Date;
}

export interface CreatedEvent<Payload, META extends EventMeta = EventMeta> extends BaseEvent<Payload, META> {
  id: string;
  readonly created: Date;
}

export interface StoredEvent<Payload, META extends EventMeta = EventMeta> extends CreatedEvent<Payload, META> { }

export type Event<Payload, META extends EventMeta = EventMeta> = StoredEvent<Payload, META>;

export interface EventFlow<PartialPayload = any, Payload extends PartialPayload = PartialPayload> {
  readonly domain: string;
  readonly type: string;
  readonly description?: string;

  readonly meta?: {
    readonly sideEffectFailedRetryAllowed?: number;
  };

  readonly eventType?: CreatedEvent<Payload>;
  readonly payloadType?: PartialPayload | Payload;

  readonly samplePayload?: PartialPayload | Payload;

  /**
   * Current schema version for this event type.
   * Stored in event.meta.schemaVersion when event is created.
   * @default 1
   */
  readonly schemaVersion?: number;

  /**
   * Upgrades event payload from older versions to the current schemaVersion.
   * Called automatically during event processing and replay.
   *
   * @param event - The event with potentially outdated payload
   * @param fromVersion - The version stored in event.meta.schemaVersion (defaults to 1)
   * @returns Updated event with migrated payload, or void to use the original
   */
  readonly upcast?: (
    event: CreatedEvent<any>,
    fromVersion: number
  ) => CreatedEvent<Payload> | Promise<CreatedEvent<Payload>> | void;

  /**
   * Extract the shard key for event routing.
   * Events with the same shard key will be processed sequentially in the same partition.
   * Events with different shard keys can be processed in parallel.
   * 
   * @param event - The event to extract the shard key from
   * @returns The shard key string, or undefined to use fallback (identifier)
   * @example
   * getShardKey: (event) => event.payload.userId
   */
  readonly getShardKey?: (event: BaseEvent<Payload>) => string | undefined;

  readonly receive: (eventStore: {
    receive: (
      eventFlow: EventFlow<PartialPayload, Payload>
    ) => (eventInput: BaseEventInput<PartialPayload>) => Promise<[CreatedEvent<Payload>, ...Array<CreatedEvent<any>>]>;
  }) => (
    eventInputArgs: BaseEventInput<PartialPayload>
  ) => Promise<[CreatedEvent<Payload>, ...Array<CreatedEvent<any>>]>;

  readonly validate?: (event: CreatedEvent<Payload>) => Promise<Error | void> | Error | void;

  readonly preApply?: (
    event: CreatedEvent<PartialPayload>
  ) => Promise<CreatedEvent<Payload> | void> | CreatedEvent<Payload> | void;

  readonly apply?: (event: CreatedEvent<Payload>) => Promise<void> | void;

  readonly sideEffect?: (event: CreatedEvent<Payload>) => Promise<void | BaseEvent<any>[]> | void | BaseEvent<any>[];

  readonly cancelApply?: (event: CreatedEvent<Payload>) => Promise<void> | void;

  readonly createConsequentEvents?: (
    causalEvent: CreatedEvent<Payload>
  ) => Promise<BaseEvent<any>[]> | BaseEvent<any>[];

  /**
   * Generates compensating event(s) to reverse this event's effects.
   * Called by the framework during revert operations.
   *
   * If this hook is not defined, the event cannot be reverted.
   * If any event in a causal chain lacks this hook, the entire chain
   * cannot be reverted.
   *
   * @param originalEvent - The event being reverted
   * @returns Compensating event(s) to persist
   */
  readonly compensate?: (originalEvent: CreatedEvent<Payload>) => BaseEvent<any> | BaseEvent<any>[];
}

export type EventTaskAndError = { task: CreatedEvent<any>; error: Error };

export interface EventFlowMap {
  [key: string]: EventFlow;
}

interface EventObserverStaticFilter {
  domain: string;
  type: string;
}

type EventObserverFilter = EventObserverStaticFilter;

export interface SuccessEventObserver<Payload = any> {
  filters: EventObserverFilter[];
  priority: number;

  /**
   * If true, the observer will be executed asynchronously without blocking.
   * The main flow will not wait for this observer to complete.
   * @default false
   */
  fireAndForget?: boolean;

  readonly apply?: (event: CreatedEvent<Payload>) => Promise<void> | void;
}

export enum SideEffectsState {
  done = 'SideEffects:done',
  retry = 'SideEffects:retry',
  fail = 'SideEffects:fail',
}

export enum EventOutputState {
  success = 'Event:success',
  invalid = 'Event:invalid',
  canceled = 'Event:canceled',
  reverted = 'Event:reverted',
  revertFailed = 'Event:revertFailed',
}

export enum EventObserverState {
  success = 'Observer:success',
}
