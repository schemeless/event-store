import { StreamConcurrencyError } from '@schemeless/event-store-types';
import type { PersistedEvent, Snapshot } from '@schemeless/event-store-types';
import type { AggregateRuntimeAdapter } from '@schemeless/event-store-aggregate';
import type { EventStoreCoreRepo } from '@schemeless/event-store-core';

const compareEvents = (a: PersistedEvent, b: PersistedEvent) =>
  (a.sequence ?? 0) - (b.sequence ?? 0) || a.created.getTime() - b.created.getTime() || a.id.localeCompare(b.id);

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

  async append(events: PersistedEvent[]): Promise<void> {
    await this.withWriteLock(async () => {
      for (const event of events) {
        const current = await this.getCurrentVersion(event.domain, event.identifier ?? '');
        this.events.push({ ...event, sequence: event.sequence ?? current + 1, created: event.created ?? new Date() });
      }
    });
  }

  async getAllEvents(pageSize = 200, startFromId?: string) {
    const sorted = [...this.events].sort(compareEvents);
    let startIndex = 0;
    if (startFromId) {
      const index = sorted.findIndex((event) => event.id === startFromId);
      startIndex = index >= 0 ? index + 1 : 0;
    }
    return (async function* () {
      for (let i = startIndex; i < sorted.length; i += pageSize) {
        yield sorted.slice(i, i + pageSize);
      }
      yield [];
    })();
  }

  async getStreamEvents(domain: string, identifier: string, fromSequence = 0): Promise<PersistedEvent[]> {
    return this.events
      .filter(
        (event) => event.domain === domain && event.identifier === identifier && (event.sequence ?? 0) > fromSequence
      )
      .sort(compareEvents);
  }

  async appendToStream(events: PersistedEvent[], expectedVersion: number): Promise<{ nextVersion: number }> {
    return this.withWriteLock(async () => {
      if (!events.length) {
        return { nextVersion: expectedVersion };
      }
      const { domain, identifier } = events[0];
      const current = await this.getCurrentVersion(domain, identifier ?? '');
      if (current !== expectedVersion) {
        throw new StreamConcurrencyError(domain, identifier ?? '', expectedVersion, current);
      }

      let next = current;
      for (const event of events) {
        next += 1;
        this.events.push({ ...event, sequence: next, created: event.created ?? new Date() });
      }
      return { nextVersion: next };
    });
  }

  async getSnapshot<State>(domain: string, identifier: string): Promise<Snapshot<State> | null> {
    return this.snapshots.get(`${domain}::${identifier}`) ?? null;
  }

  async saveSnapshot<State>(snapshot: Snapshot<State>): Promise<void> {
    this.snapshots.set(`${snapshot.domain}::${snapshot.identifier}`, snapshot);
  }

  async getCurrentVersion(domain: string, identifier: string): Promise<number> {
    return Math.max(
      0,
      ...this.events.filter((e) => e.domain === domain && e.identifier === identifier).map((e) => e.sequence ?? 0)
    );
  }
}
