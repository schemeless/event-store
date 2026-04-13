export class EventStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventStoreError';
  }
}

export class AdapterCapabilityError extends EventStoreError {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterCapabilityError';
  }
}

export class StreamConcurrencyError extends EventStoreError {
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

export class SnapshotError extends EventStoreError {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export class InvalidIdentifierError extends EventStoreError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidIdentifierError';
  }
}

export class InvalidStreamBatchError extends EventStoreError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidStreamBatchError';
  }
}

export class EventCursorNotFoundError extends EventStoreError {
  constructor(cursorId: string) {
    super(`Event cursor not found: "${cursorId}"`);
    this.name = 'EventCursorNotFoundError';
  }
}
