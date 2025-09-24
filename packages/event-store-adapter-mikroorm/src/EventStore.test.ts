import 'reflect-metadata';

import type { CreatedEvent } from '@schemeless/event-store-types';
import { MikroORM } from '@mikro-orm/core';
import { SqliteDriver } from '@mikro-orm/sqlite';
import { EventStoreRepo } from './EventStore.repo';

type TestOptions = Parameters<typeof MikroORM.init>[0];

const makeSqliteOptions = (): TestOptions => ({
  driver: SqliteDriver,
  dbName: ':memory:',
  entities: [],
});

const makeEvent = (num: number, overrides: Partial<CreatedEvent<any>> = {}): CreatedEvent<any> => {
  const created = new Date(Date.now() + num * 1000);
  return {
    id: `event-${num.toString().padStart(6, '0')}`,
    domain: 'test',
    type: 'test',
    payload: { id: num },
    meta: { attempt: num },
    created,
    ...overrides,
  } as CreatedEvent<any>;
};

const closeRepo = async (repo: EventStoreRepo) => {
  const orm = (repo as unknown as { orm?: MikroORM }).orm;
  if (orm) {
    await orm.close(true);
  }
};

describe('EventStoreRepo (MikroORM)', () => {
  it('initialises the schema and returns an empty iterator', async () => {
    const repo = new EventStoreRepo(makeSqliteOptions());

    try {
      await expect(repo.init()).resolves.not.toThrow();

      const iterator = await repo.getAllEvents(50);
      const first = await iterator.next();
      expect(first.done).toBe(true);
      expect(first.value).toBeUndefined();
    } finally {
      await closeRepo(repo);
    }
  });

  it('persists and retrieves events in order', async () => {
    const repo = new EventStoreRepo(makeSqliteOptions());
    const events = Array.from({ length: 50 }, (_, index) => makeEvent(index));

    try {
      await repo.storeEvents(events);

      const iterator = await repo.getAllEvents(10);
      const retrieved: CreatedEvent<any>[] = [];

      for await (const batch of iterator) {
        retrieved.push(...batch);
      }

      expect(retrieved).toHaveLength(events.length);
      expect(retrieved.map((event) => event.id)).toEqual(events.map((event) => event.id));
      expect(retrieved.every((event, index) => event.created.getTime() === events[index].created.getTime())).toBe(true);
      expect(
        retrieved.every((event, index) => (event.meta as any)?.attempt === (events[index].meta as any)?.attempt)
      ).toBe(true);
      expect(retrieved.every((event, index) => event.payload.id === events[index].payload.id)).toBe(true);
    } finally {
      await closeRepo(repo);
    }
  });

  it('supports pagination and startFromId offsets', async () => {
    const repo = new EventStoreRepo(makeSqliteOptions());
    const events = Array.from({ length: 30 }, (_, index) => makeEvent(index));

    try {
      await repo.storeEvents(events);

      const startFrom = events[9];
      const iterator = await repo.getAllEvents(5, startFrom.id);
      const resumed: CreatedEvent<any>[] = [];

      for await (const batch of iterator) {
        resumed.push(...batch);
      }

      expect(resumed).toHaveLength(events.length - 10);
      expect(resumed[0].id).toBe(events[10].id);
      expect(resumed[resumed.length - 1].id).toBe(events[events.length - 1].id);
    } finally {
      await closeRepo(repo);
    }
  });

  it('wraps writes in a transaction and rolls back on failure', async () => {
    const repo = new EventStoreRepo(makeSqliteOptions());

    try {
      const initial = makeEvent(0);
      await repo.storeEvents([initial]);

      const duplicateId = 'duplicate-id';
      const failingBatch = [makeEvent(1, { id: duplicateId }), makeEvent(2, { id: duplicateId })];

      await expect(repo.storeEvents(failingBatch)).rejects.toBeInstanceOf(Error);

      const iterator = await repo.getAllEvents(10);
      const stored: CreatedEvent<any>[] = [];
      for await (const batch of iterator) {
        stored.push(...batch);
      }

      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe(initial.id);
    } finally {
      await closeRepo(repo);
    }
  });

  it('drops and recreates the schema when resetStore is called', async () => {
    const repo = new EventStoreRepo(makeSqliteOptions());

    try {
      await repo.storeEvents([makeEvent(0), makeEvent(1)]);

      await repo.resetStore();

      const iterator = await repo.getAllEvents(10);
      const first = await iterator.next();

      expect(first.done).toBe(true);
      expect(first.value).toBeUndefined();
    } finally {
      await closeRepo(repo);
    }
  });
});
