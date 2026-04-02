import { PgEventStoreAdapter } from './PgEventStoreAdapter';
import type { PersistedEvent } from '@schemeless/event-store-types';

const connectionOptions = {
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'event_store_test',
};

const makeEvent = (num: number, identifier?: string): PersistedEvent<any> =>
  ({
    id: `event-${identifier ?? 'global'}-${num.toString().padStart(6, '0')}`,
    domain: 'test',
    type: 'Tested',
    payload: { id: num },
    identifier,
    created: new Date(Date.now() + num * 1000),
  } as PersistedEvent<any>);

const makeEventWithoutId = (num: number, identifier?: string): PersistedEvent<any> =>
  ({
    domain: 'test',
    type: 'Tested',
    payload: { id: num },
    identifier,
    created: new Date(Date.now() + num * 1000),
  } as PersistedEvent<any>);

describe('PgEventStoreAdapter Integration', () => {
  let adapter: PgEventStoreAdapter;

  beforeAll(async () => {
    adapter = new PgEventStoreAdapter(connectionOptions);
    await adapter.init();
  });

  afterAll(async () => {
    await adapter.close();
  });

  beforeEach(async () => {
    await adapter.reset();
  });

  // === Replicate and extend existing tests ===

  it('appends and scans events', async () => {
    await adapter.append([makeEvent(1), makeEvent(2), makeEvent(3)]);

    const pages = await adapter.getAllEvents(2);
    const allEvents: PersistedEvent[] = [];
    for await (const batch of pages) {
      allEvents.push(...batch);
    }

    expect(allEvents).toHaveLength(3);
    expect(allEvents.map((event) => event.id)).toEqual([
      'event-global-000001',
      'event-global-000002',
      'event-global-000003',
    ]);
  });

  it('generates ids for events without ids', async () => {
    const events = [makeEventWithoutId(1), makeEventWithoutId(2)];

    await adapter.append(events);

    expect(events[0].id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(events[1].id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    const pages = await adapter.getAllEvents(10);
    const allEvents: PersistedEvent[] = [];
    for await (const batch of pages) {
      allEvents.push(...batch);
    }

    expect(allEvents.map((event) => event.id)).toEqual(events.map((event) => event.id));
  });

  it('loads a stream in sequence order', async () => {
    await adapter.appendToStream([makeEvent(1, 'user-123'), makeEvent(2, 'user-123')], 0);

    const stream = await adapter.getStreamEvents('test', 'user-123');
    expect(stream).toHaveLength(2);
    expect(stream.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it('enforces optimistic concurrency for appendToStream', async () => {
    await adapter.appendToStream([makeEvent(1, 'user-123')], 0);

    await expect(adapter.appendToStream([makeEvent(2, 'user-123')], 0)).rejects.toMatchObject({
      name: 'StreamConcurrencyError',
      expectedVersion: 0,
      actualVersion: 1,
    });
  });

  it('returns the next version after appendToStream', async () => {
    const result = await adapter.appendToStream([makeEvent(1, 'user-123'), makeEvent(2, 'user-123')], 0);
    expect(result.nextVersion).toBe(2);
  });

  it('stores and loads snapshots', async () => {
    await adapter.saveSnapshot({
      domain: 'test',
      identifier: 'user-123',
      state: { balance: 42 },
      sequence: 2,
      created: new Date(),
    });

    const snapshot = await adapter.getSnapshot<{ balance: number }>('test', 'user-123');
    expect(snapshot).not.toBeNull();
    expect(snapshot?.state).toEqual({ balance: 42 });
    expect(snapshot?.sequence).toBe(2);
  });

  // === New integration tests ===

  it('getStreamEvents returns events in strict sequence order', async () => {
    await adapter.appendToStream([makeEvent(1, 'order-1')], 0);
    await adapter.appendToStream([makeEvent(2, 'order-1')], 1);
    await adapter.appendToStream([makeEvent(3, 'order-1')], 2);

    const stream = await adapter.getStreamEvents('test', 'order-1');
    expect(stream.map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(stream.map((e) => e.id)).toEqual(['event-order-1-000001', 'event-order-1-000002', 'event-order-1-000003']);
  });

  it('appendToStream returns correct nextVersion sequentially', async () => {
    const r1 = await adapter.appendToStream([makeEvent(1, 'user-1')], 0);
    expect(r1.nextVersion).toBe(1);

    const r2 = await adapter.appendToStream([makeEvent(2, 'user-1')], r1.nextVersion);
    expect(r2.nextVersion).toBe(2);

    const r3 = await adapter.appendToStream([makeEvent(3, 'user-1')], r2.nextVersion);
    expect(r3.nextVersion).toBe(3);
  });

  it('findByCausationId returns all descendant events in order', async () => {
    const parent = makeEvent(1, 'order-1');
    await adapter.appendToStream([parent], 0);

    const child1 = { ...makeEvent(2, 'order-1'), causationId: parent.id };
    const child2 = { ...makeEvent(3, 'order-1'), causationId: parent.id };
    await adapter.appendToStream([child1], 1);
    await adapter.appendToStream([child2], 2);

    const descendants = await adapter.findByCausationId(parent.id!);
    expect(descendants).toHaveLength(2);
    expect(descendants[0].id).toBe(child1.id);
    expect(descendants[1].id).toBe(child2.id);
  });

  it('getAllEvents pagination with pageSize=2', async () => {
    for (let i = 1; i <= 5; i++) {
      await adapter.appendToStream([makeEvent(i, `user-${i}`)], i - 1);
    }

    const eventsIterator = await adapter.getAllEvents(2);
    const pages: PersistedEvent[][] = [];
    for await (const page of eventsIterator) {
      pages.push(page);
    }

    expect(pages).toHaveLength(3); // [2, 2, 1]
    expect(pages[0]).toHaveLength(2);
    expect(pages[1]).toHaveLength(2);
    expect(pages[2]).toHaveLength(1);
    expect(pages[2][0].id).toBe('event-user-5-000005');
  });

  it('getAllEvents with startFromId resumes from correct position', async () => {
    for (let i = 1; i <= 4; i++) {
      await adapter.appendToStream([makeEvent(i, 'stream-1')], i - 1);
    }

    const firstIterator = await adapter.getAllEvents(2);
    const firstTwoPages: PersistedEvent[][] = [];
    for await (const page of firstIterator) {
      firstTwoPages.push(page);
    }
    expect(firstTwoPages[0]).toHaveLength(2);
    expect(firstTwoPages[1]).toHaveLength(2);

    // Resume from last id of second page
    const resumeId = firstTwoPages[1][1].id;
    const resumeIterator = await adapter.getAllEvents(2, resumeId);
    const resumePages: PersistedEvent[][] = [];
    for await (const page of resumeIterator) {
      resumePages.push(page);
    }

    expect(resumePages).toHaveLength(1);
    expect(resumePages[0]).toHaveLength(1);
    expect(resumePages[0][0].id).toBe('event-stream-1-000004');
  });

  it('snapshot is used for hydration on second handle', async () => {
    await adapter.saveSnapshot({
      domain: 'counter',
      identifier: 'c1',
      state: { count: 10 },
      sequence: 5,
      created: new Date(),
    });

    // Add a trailing event after the snapshot
    await adapter.appendToStream(
      [
        {
          id: 'e-trailing',
          domain: 'counter',
          type: 'Incremented',
          payload: { amount: 2 },
          identifier: 'c1',
          created: new Date(),
        },
      ],
      5
    );

    const hydrated = await adapter.getStreamEvents('counter', 'c1', 5);
    expect(hydrated).toHaveLength(1);
    expect(hydrated[0].sequence).toBe(6);
  });

  it('concurrent appendToStream with same expectedVersion throws', async () => {
    // First append succeeds
    await adapter.appendToStream([makeEvent(1, 'same-stream')], 0);

    // Second append with same expectedVersion throws
    await expect(adapter.appendToStream([makeEvent(2, 'same-stream')], 0)).rejects.toMatchObject({
      name: 'StreamConcurrencyError',
      expectedVersion: 0,
      actualVersion: 1,
    });

    // Third append with correct expectedVersion succeeds
    const r3 = await adapter.appendToStream([makeEvent(3, 'same-stream')], 1);
    expect(r3.nextVersion).toBe(2);
  });

  it('getEventById returns null for non-existent event', async () => {
    const result = await adapter.getEventById('non-existent-id');
    expect(result).toBeNull();
  });

  it('causationId is preserved through append and retrieval', async () => {
    const parent = makeEvent(1, 'flow-1');
    const child = { ...makeEvent(2, 'flow-1'), causationId: parent.id };

    await adapter.append([parent]);
    await adapter.appendToStream([child], 1);

    const retrieved = await adapter.getEventById(child.id!);
    expect(retrieved?.causationId).toBe(parent.id);
  });

  it('correlationId is preserved through append and retrieval', async () => {
    const event = { ...makeEvent(1, 'corr-1'), correlationId: 'corr-parent-123' };

    await adapter.appendToStream([event], 0);

    const retrieved = await adapter.getEventById(event.id!);
    expect(retrieved?.correlationId).toBe('corr-parent-123');
  });

  it('reset truncates all tables', async () => {
    await adapter.append([makeEvent(1), makeEvent(2)]);
    await adapter.saveSnapshot({
      domain: 'test',
      identifier: 'snap-1',
      state: { data: 'test' },
      sequence: 1,
      created: new Date(),
    });

    await adapter.reset();

    const pages = await adapter.getAllEvents(100);
    const allEvents: PersistedEvent[] = [];
    for await (const batch of pages) {
      allEvents.push(...batch);
    }
    expect(allEvents).toHaveLength(0);

    const snap = await adapter.getSnapshot('test', 'snap-1');
    expect(snap).toBeNull();
  });
});
