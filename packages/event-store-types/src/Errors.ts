export class EventStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventStoreError';
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
