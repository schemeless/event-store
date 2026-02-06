export interface BaseEventInput<Payload, META = undefined> {
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

export interface BaseEvent<Payload, META = undefined> extends BaseEventInput<Payload, META> {
  id?: string;
  domain: string;
  type: string;
  payload: Payload;

  identifier?: string;
  correlationId?: string;
  causationId?: string;

  created?: Date;
}

export interface CreatedEvent<Payload, META = undefined> extends BaseEvent<Payload, META> {
  id: string;
  readonly created: Date;
}

export interface StoredEvent<Payload, META = undefined> extends CreatedEvent<Payload, META> { }

export type Event<Payload, META = undefined> = StoredEvent<Payload, META>;

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
