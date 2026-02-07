import 'reflect-metadata';

import { EventStoreRepo } from './EventStore.repo';
import { ConcurrencyError, CreatedEvent, BaseEventInput } from '@schemeless/event-store-types';
import { ConnectionOptions } from 'typeorm';

export const defaultInMemDBOption = {
  type: 'sqlite',
  database: ':memory:',
  dropSchema: true,
  synchronize: true,
  logger: 'advanced-console',
  logging: ['error', 'warn'],
} as ConnectionOptions;

const makeEvent = (num: number): CreatedEvent<any, any> => {
  const d = new Date(Date.now() + num * 1000);
  return {
    id: `event-${num.toString().padStart(6, '0')}`,
    domain: 'test',
    type: 'test',
    payload: { id: num },

    created: d,
  };
};

const makeEventWithIdentifier = (num: number, identifier: string): CreatedEvent<any, any> => {
  const d = new Date(Date.now() + num * 1000);
  return {
    id: `event-${identifier}-${num}`,
    domain: 'test',
    type: 'test',
    payload: { id: num },
    identifier,
    created: d,
  };
};

describe('EventStore Typeorm', () => {
  it('should make 500 events works', async () => {
    const eventStoreRepo = new EventStoreRepo({ ...defaultInMemDBOption, name: 'test-1' });
    const eventsToStore = [...new Array(500).keys()].map(makeEvent);
    await eventStoreRepo.init();
    await eventStoreRepo.storeEvents(eventsToStore);
    const pages = await eventStoreRepo.getAllEvents(100);
    let allEvents: CreatedEvent<any, any>[] = [];
    for await (const events of pages) {
      allEvents = allEvents.concat(events);
    }
    expect(allEvents.length).toBe(500);
    const rightOrder = allEvents.every((currentEvent, index) => {
      const nextEvent = allEvents[index + 1];
      if (!nextEvent) return true;
      // console.log(nextEvent);
      return nextEvent.created >= currentEvent.created;
    });
    expect(rightOrder).toBe(true);
  });
  it('should make replay after works', async () => {
    const eventStoreRepo = new EventStoreRepo({ ...defaultInMemDBOption, name: 'test-2' });
    const eventsToStore = [...new Array(500).keys()].map(makeEvent);
    await eventStoreRepo.init();
    await eventStoreRepo.storeEvents(eventsToStore);
    let pages = await eventStoreRepo.getAllEvents(100);
    let allEvents: CreatedEvent<any, any>[] = [];
    for await (const events of pages) {
      allEvents = allEvents.concat(events);
    }
    const stopped = allEvents[199];
    pages = await eventStoreRepo.getAllEvents(100, stopped.id);
    allEvents = [];
    for await (const events of pages) {
      allEvents = allEvents.concat(events);
    }
    expect(allEvents.length).toBe(300);
  });

  describe('OCC - Optimistic Concurrency Control', () => {
    it('should assign sequence numbers to events', async () => {
      const repo = new EventStoreRepo({ ...defaultInMemDBOption, name: 'test-occ-1' });
      await repo.init();

      const events = [
        makeEventWithIdentifier(1, 'user-123'),
        makeEventWithIdentifier(2, 'user-123'),
      ];
      await repo.storeEvents(events);

      const seq = await repo.getStreamSequence('test', 'user-123');
      expect(seq).toBe(2);
    });

    it('should throw ConcurrencyError on sequence mismatch', async () => {
      const repo = new EventStoreRepo({ ...defaultInMemDBOption, name: 'test-occ-2' });
      await repo.init();

      await repo.storeEvents([makeEventWithIdentifier(1, 'user-123')]);

      await expect(
        repo.storeEvents([makeEventWithIdentifier(2, 'user-123')], { expectedSequence: 0 })
      ).rejects.toThrow(ConcurrencyError);
    });

    it('should succeed when expectedSequence matches', async () => {
      const repo = new EventStoreRepo({ ...defaultInMemDBOption, name: 'test-occ-3' });
      await repo.init();

      await repo.storeEvents([makeEventWithIdentifier(1, 'user-123')]);

      // Current sequence is 1
      await expect(
        repo.storeEvents([makeEventWithIdentifier(2, 'user-123')], { expectedSequence: 1 })
      ).resolves.not.toThrow();

      const seq = await repo.getStreamSequence('test', 'user-123');
      expect(seq).toBe(2);
    });

    it('should handle independent streams correctly', async () => {
      const repo = new EventStoreRepo({ ...defaultInMemDBOption, name: 'test-occ-4' });
      await repo.init();

      await repo.storeEvents([makeEventWithIdentifier(1, 'user-A')]);
      await repo.storeEvents([makeEventWithIdentifier(1, 'user-B')]);

      const seqA = await repo.getStreamSequence('test', 'user-A');
      const seqB = await repo.getStreamSequence('test', 'user-B');

      expect(seqA).toBe(1);
      expect(seqB).toBe(1);

      // Update A, B should be unaffected
      await repo.storeEvents([makeEventWithIdentifier(2, 'user-A')], { expectedSequence: 1 });

      expect(await repo.getStreamSequence('test', 'user-A')).toBe(2);
      expect(await repo.getStreamSequence('test', 'user-B')).toBe(1);
    });
  });
});
