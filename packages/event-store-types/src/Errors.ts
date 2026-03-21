export class ConcurrencyError extends Error {
  constructor(
    public readonly streamKey: string,
    public readonly expectedSequence: number,
    public readonly actualSequence: number
  ) {
    super(
      `Concurrency conflict on stream "${streamKey}": expected sequence ${expectedSequence}, but found ${actualSequence}`
    );
    this.name = 'ConcurrencyError';
  }
}

export class EventStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventStoreError';
  }
}

export class ValidationError extends EventStoreError {
  constructor(
    public readonly flow: { domain: string; type: string },
    public readonly eventId: string,
    public readonly cause: Error
  ) {
    super(`Validation failed for ${flow.domain}/${flow.type} (event ${eventId}): ${cause.message}`);
    this.name = 'ValidationError';
  }
}

export class FlowNotFoundError extends EventStoreError {
  constructor(public readonly domain: string, public readonly type: string) {
    super(
      `No EventFlow registered for "${domain}/${type}". ` +
        `Make sure the EventFlow is included in the eventFlows array passed to makeEventStore.`
    );
    this.name = 'FlowNotFoundError';
  }
}

export class AggregateError extends EventStoreError {
  constructor(
    public readonly flow: { domain: string; type: string },
    public readonly reason: 'no_loader' | 'no_identifier' | 'apply_must_return_state' | 'capability_missing'
  ) {
    const messages: Record<string, string> = {
      no_loader: 'requires getAggregate() support to load state',
      no_identifier: 'requires an identifier (set event.identifier or aggregate.getIdentifier)',
      apply_must_return_state: 'apply() must return the new state object',
      capability_missing: 'requires adapter with getStreamEvents() support',
    };
    super(`AggregateEventFlow ${flow.domain}/${flow.type}: ${messages[reason]}`);
    this.name = 'AggregateError';
  }
}

export class ShutdownTimeoutError extends EventStoreError {
  constructor(public readonly timeoutMs: number) {
    super(`EventStore shutdown timed out after ${timeoutMs}ms`);
    this.name = 'ShutdownTimeoutError';
  }
}

export class RevertError extends EventStoreError {
  constructor(
    public readonly eventId: string,
    public readonly reason: 'not_found' | 'not_root' | 'missing_compensate' | 'repo_not_supported',
    public readonly details?: string
  ) {
    const messages: Record<string, string> = {
      not_found: `Event not found: ${eventId}`,
      not_root: `Event ${eventId} is not a root event. Revert the root event instead.`,
      missing_compensate: `Some events in the tree lack a 'compensate' hook`,
      repo_not_supported: 'Repository must implement getEventById and findByCausationId',
    };
    super(messages[reason] + (details ? `. ${details}` : ''));
    this.name = 'RevertError';
  }
}
