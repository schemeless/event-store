import { monotonicFactory } from 'ulid';
import {
  EventCursorNotFoundError,
  InvalidIdentifierError,
  InvalidStreamBatchError,
  StreamConcurrencyError,
} from '@schemeless/event-store-types';
import type { AppendableEvent, PersistedEvent, Snapshot, StreamAppendableEvent } from '@schemeless/event-store-types';
import type { AggregateRuntimeAdapter } from '@schemeless/event-store-aggregate';
import type { EventStoreCoreRepo } from '@schemeless/event-store-core';

const monotonicUlid = monotonicFactory();

export class MemoryEventStore implements AggregateRuntimeAdapter, EventStoreCoreRepo {
  private events: PersistedEvent[] = [];
  private snapshots = new Map<string, Snapshot<any>>();
  private writeChain: Promise<void> = Promise.resolve();

  private async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.writeChain;
    let release!: () => void;
    this.writeChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async init(): Promise<void> {}
  async reset(): Promise<void> {
    this.events = [];
    this.snapshots.clear();
  }

  private normalizeOptionalIdentifier(identifier: string | undefined, context: string): string {
    if (identifier == null) {
      return '';
    }
    if (identifier.trim().length === 0) {
      throw new InvalidIdentifierError(`${context} requires a non-empty identifier`);
    }
    return identifier;
  }

  private assertStreamIdentifier(identifier: string, context: string): string {
    return this.normalizeOptionalIdentifier(identifier, context);
  }

  private assertSingleStream(events: Array<{ domain: string; identifier: string }>): {
    domain: string;
    identifier: string;
  } {
    const first = events[0];
    if (!first) {
      throw new InvalidStreamBatchError('appendToStream requires at least one event');
    }
    for (const event of events) {
      if (event.domain !== first.domain || event.identifier !== first.identifier) {
        throw new InvalidStreamBatchError('appendToStream only accepts events from a single domain/identifier stream');
      }
    }
    return first;
  }

  async append(events: AppendableEvent[]): Promise<void> {
    await this.withWriteLock(async () => {
      for (const event of events) {
        const id = event.id ?? monotonicUlid();
        const identifier = this.normalizeOptionalIdentifier(event.identifier, 'Persisted events');
        const current = await this.getCurrentVersion(event.domain, identifier);
        this.events.push({
          ...event,
          id,
          identifier: identifier || undefined,
          sequence: event.sequence ?? current + 1,
          created: event.created ?? new Date(),
        });
      }
    });
  }

  async getAllEvents(pageSize = 200, startFromId?: string) {
    let startIndex = 0;
    if (startFromId) {
      const index = this.events.findIndex((event) => event.id === startFromId);
      if (index < 0) {
        throw new EventCursorNotFoundError(startFromId);
      }
      startIndex = index + 1;
    }
    return async function* () {
      for (let i = startIndex; i < this.events.length; i += pageSize) {
        yield this.events.slice(i, i + pageSize);
      }
      yield [];
    }.call(this);
  }

  async getStreamEvents(domain: string, identifier: string, fromSequence = 0): Promise<PersistedEvent[]> {
    const canonicalIdentifier = this.assertStreamIdentifier(identifier, 'getStreamEvents');
    return this.events
      .filter(
        (event) =>
          event.domain === domain && event.identifier === canonicalIdentifier && (event.sequence ?? 0) > fromSequence
      )
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.id.localeCompare(b.id));
  }

  async appendToStream(events: StreamAppendableEvent[], expectedVersion: number): Promise<{ nextVersion: number }> {
    return this.withWriteLock(async () => {
      if (!events.length) {
        return { nextVersion: expectedVersion };
      }
      const { domain, identifier } = this.assertSingleStream(
        events.map((event) => ({
          domain: event.domain,
          identifier: this.assertStreamIdentifier(event.identifier, 'appendToStream'),
        }))
      );
      const current = await this.getCurrentVersion(domain, identifier);
      if (current !== expectedVersion) {
        throw new StreamConcurrencyError(domain, identifier, expectedVersion, current);
      }

      let next = current;
      for (const event of events) {
        const id = event.id ?? monotonicUlid();
        next += 1;
        this.events.push({
          ...event,
          id,
          identifier,
          sequence: next,
          created: event.created ?? new Date(),
        });
      }
      return { nextVersion: next };
    });
  }

  async getSnapshot<State>(domain: string, identifier: string): Promise<Snapshot<State> | null> {
    const canonicalIdentifier = this.assertStreamIdentifier(identifier, 'getSnapshot');
    return this.snapshots.get(`${domain}::${canonicalIdentifier}`) ?? null;
  }

  async saveSnapshot<State>(snapshot: Snapshot<State>): Promise<void> {
    const identifier = this.assertStreamIdentifier(snapshot.identifier, 'saveSnapshot');
    this.snapshots.set(`${snapshot.domain}::${identifier}`, { ...snapshot, identifier });
  }

  async getCurrentVersion(domain: string, identifier: string): Promise<number> {
    return Math.max(
      0,
      ...this.events.filter((e) => e.domain === domain && e.identifier === identifier).map((e) => e.sequence ?? 0)
    );
  }
}
