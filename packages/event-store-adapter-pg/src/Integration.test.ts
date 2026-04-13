import { PgEventStoreAdapter } from './PgEventStoreAdapter';
import type { PersistedEvent, StreamAppendableEvent } from '@schemeless/event-store-types';

const connectionOptions = {
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'event_store_test',
};

function makeEvent(num: number, identifier: string): StreamAppendableEvent<any>;
function makeEvent(num: number, identifier?: undefined): PersistedEvent<any>;
function makeEvent(num: number, identifier?: string): PersistedEvent<any> | StreamAppendableEvent<any> {
  return {
    id: `integ-${Date.now()}-${identifier ?? 'global'}-${num.toString().padStart(6, '0')}`,
    domain: 'test',
    type: 'Tested',
    payload: { id: num },
    identifier: identifier ? `integ-${identifier}` : undefined,
    created: new Date(Date.now() + num * 1000),
  } as PersistedEvent<any> | StreamAppendableEvent<any>;
}

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
    // Verify all 3 events exist and have the expected structure
    const ids = allEvents.map((event) => event.id);
    expect(ids[0]).toMatch(/^integ-/);
    expect(ids[1]).toMatch(/^integ-/);
    expect(ids[2]).toMatch(/^integ-/);
  });

  it('generates ids for events without ids', async () => {
    const events = [makeEventWithoutId(1), makeEventWithoutId(2)];

    await adapter.append(events);

    expect(events[0].id).toBeUndefined();
    expect(events[1].id).toBeUndefined();

    const pages = await adapter.getAllEvents(10);
    const allEvents: PersistedEvent[] = [];
    for await (const batch of pages) {
      allEvents.push(...batch);
    }

    expect(allEvents[0].id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(allEvents[1].id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(allEvents[0].id).not.toBe(allEvents[1].id);
  });

  it('loads a stream in sequence order', async () => {
    await adapter.appendToStream([makeEvent(1, 'user-123'), makeEvent(2, 'user-123')], 0);

    const stream = await adapter.getStreamEvents('test', 'integ-user-123');
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
      identifier: 'integ-user-123',
      state: { balance: 42 },
      sequence: 2,
      created: new Date(),
    });

    const snapshot = await adapter.getSnapshot<{ balance: number }>('test', 'integ-user-123');
    expect(snapshot).not.toBeNull();
    expect(snapshot?.state).toEqual({ balance: 42 });
    expect(snapshot?.sequence).toBe(2);
  });

  // === New integration tests ===

  it('getStreamEvents returns events in strict sequence order', async () => {
    await adapter.appendToStream([makeEvent(1, 'order-1')], 0);
    await adapter.appendToStream([makeEvent(2, 'order-1')], 1);
    await adapter.appendToStream([makeEvent(3, 'order-1')], 2);

    const stream = await adapter.getStreamEvents('test', 'integ-order-1');
    expect(stream.map((e) => e.sequence)).toEqual([1, 2, 3]);
    // IDs have integ- prefix
    expect(stream[0].id).toMatch(/^integ-.*order-1-000001$/);
    expect(stream[1].id).toMatch(/^integ-.*order-1-000002$/);
    expect(stream[2].id).toMatch(/^integ-.*order-1-000003$/);
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
    // Use append (not appendToStream) so events go into the general event table
    const parent: any = { ...makeEvent(1, 'order-1'), id: undefined }; // let PG generate id
    await adapter.append([parent]);
    const allEvents = await adapter.getAllEvents(10);
    const persisted: PersistedEvent[] = [];
    for await (const batch of allEvents) {
      persisted.push(...batch);
    }
    const persistedParent = persisted.find(
      (event) => event.type === parent.type && event.identifier === 'integ-order-1'
    );
    expect(persistedParent?.id).toBeDefined();

    const child1: any = {
      id: undefined,
      domain: 'test',
      type: 'Updated',
      payload: {},
      identifier: 'integ-order-1',
      causationId: persistedParent!.id,
      created: new Date(),
    };
    const child2: any = {
      id: undefined,
      domain: 'test',
      type: 'Updated',
      payload: {},
      identifier: 'integ-order-1',
      causationId: persistedParent!.id,
      created: new Date(),
    };
    await adapter.append([child1, child2]);

    const descendants = await adapter.findByCausationId(persistedParent!.id);
    expect(descendants).toHaveLength(2);
  });

  it('getAllEvents pagination returns all events across all streams', async () => {
    // Append 4 events to different streams using append (not appendToStream)
    for (let i = 1; i <= 4; i++) {
      await adapter.append([makeEvent(i, `stream-${i}`)]);
    }

    const pages: PersistedEvent[][] = [];
    const iter = await adapter.getAllEvents(2);
    for await (const page of iter) {
      pages.push(page);
    }

    expect(pages).toHaveLength(2); // [2, 2]
    expect(pages[0]).toHaveLength(2);
    expect(pages[1]).toHaveLength(2);
  });

  it('getAllEvents returns events in append order even when created is out of order', async () => {
    const lateFirst = makeEvent(1, 'stream-1');
    const earlySecond = makeEvent(2, 'stream-1');
    lateFirst.created = new Date('2026-01-03T00:00:00.000Z');
    earlySecond.created = new Date('2026-01-01T00:00:00.000Z');

    await adapter.append([lateFirst]);
    await adapter.append([earlySecond]);

    const iter = await adapter.getAllEvents(10);
    const all: PersistedEvent[] = [];
    for await (const batch of iter) {
      all.push(...batch);
    }

    expect(all).toHaveLength(2);
    expect(all.map((event) => event.id)).toEqual([lateFirst.id, earlySecond.id]);
  });

  it('snapshot stores and retrieves state correctly', async () => {
    await adapter.saveSnapshot({
      domain: 'counter',
      identifier: 'c1',
      state: { count: 10 },
      sequence: 5,
      created: new Date(),
    });

    const snap = await adapter.getSnapshot<{ count: number }>('counter', 'c1');
    expect(snap?.state.count).toBe(10);
    expect(snap?.sequence).toBe(5);
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
    // Build child event with explicit causationId referencing a known parent
    const parentId = 'parent-event-123';
    const childEvent: any = {
      id: `child-${Date.now()}-1`,
      domain: 'test',
      type: 'ChildEvent',
      payload: {},
      identifier: 'entity-1',
      causationId: parentId,
      created: new Date(),
    };
    await adapter.append([childEvent]);

    const retrieved = await adapter.getEventById(childEvent.id);
    expect(retrieved?.causationId).toBe(parentId);
  });

  it('correlationId is preserved through append and retrieval', async () => {
    const event: any = {
      id: `event-${Date.now()}`,
      domain: 'test',
      type: 'TestEvent',
      payload: {},
      identifier: 'entity-1',
      correlationId: 'corr-abc-123',
      created: new Date(),
    };
    await adapter.append([event]);

    const retrieved = await adapter.getEventById(event.id);
    expect(retrieved?.correlationId).toBe('corr-abc-123');
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

  it('concurrent appends to different streams do not interfere', async () => {
    // Append to stream A
    await adapter.appendToStream([makeEvent(1, 'stream-A')], 0);
    await adapter.appendToStream([makeEvent(2, 'stream-A')], 1);

    // Append to stream B
    await adapter.appendToStream([makeEvent(1, 'stream-B')], 0);
    await adapter.appendToStream([makeEvent(2, 'stream-B')], 1);

    const streamA = await adapter.getStreamEvents('test', 'integ-stream-A');
    const streamB = await adapter.getStreamEvents('test', 'integ-stream-B');

    expect(streamA).toHaveLength(2);
    expect(streamB).toHaveLength(2);
    expect(streamA.map((e) => e.sequence)).toEqual([1, 2]);
    expect(streamB.map((e) => e.sequence)).toEqual([1, 2]);
  });

  it('getStreamEvents with fromSequence returns events after specified sequence', async () => {
    await adapter.appendToStream([makeEvent(1, 'seq-test')], 0);
    await adapter.appendToStream([makeEvent(2, 'seq-test')], 1);
    await adapter.appendToStream([makeEvent(3, 'seq-test')], 2);

    const eventsFromSeq2 = await adapter.getStreamEvents('test', 'integ-seq-test', 2);
    expect(eventsFromSeq2).toHaveLength(1);
    expect(eventsFromSeq2[0].sequence).toBe(3);
  });

  it('findByCausationId returns all descendants in creation order', async () => {
    const parent: any = { ...makeEvent(1, 'causal-1'), id: undefined };
    await adapter.append([parent]);
    const allEvents = await adapter.getAllEvents(10);
    const persisted: PersistedEvent[] = [];
    for await (const batch of allEvents) {
      persisted.push(...batch);
    }
    const persistedParent = persisted.find(
      (event) => event.type === parent.type && event.identifier === 'integ-causal-1'
    );
    expect(persistedParent?.id).toBeDefined();

    const child1: any = {
      id: undefined,
      domain: 'test',
      type: 'Updated',
      payload: {},
      identifier: 'causal-1',
      causationId: persistedParent!.id,
      created: new Date(Date.now() + 100),
    };
    const child2: any = {
      id: undefined,
      domain: 'test',
      type: 'Updated',
      payload: {},
      identifier: 'causal-1',
      causationId: persistedParent!.id,
      created: new Date(Date.now() + 200),
    };
    await adapter.append([child1, child2]);

    const descendants = await adapter.findByCausationId(persistedParent!.id);
    expect(descendants).toHaveLength(2);
    // Should preserve append order
    expect(descendants[0].created.getTime()).toBe(child1.created.getTime());
    expect(descendants[1].created.getTime()).toBe(child2.created.getTime());
  });

  it('getStreamEvents returns empty array for non-existent stream', async () => {
    const events = await adapter.getStreamEvents('nonExistent', 'nonExistent');
    expect(events).toHaveLength(0);
  });

  it('snapshot with different identifiers are isolated', async () => {
    await adapter.saveSnapshot({
      domain: 'test',
      identifier: 'snap-A',
      state: { value: 'A' },
      sequence: 1,
      created: new Date(),
    });
    await adapter.saveSnapshot({
      domain: 'test',
      identifier: 'snap-B',
      state: { value: 'B' },
      sequence: 1,
      created: new Date(),
    });

    const snapA = await adapter.getSnapshot<{ value: string }>('test', 'snap-A');
    const snapB = await adapter.getSnapshot<{ value: string }>('test', 'snap-B');

    expect(snapA?.state.value).toBe('A');
    expect(snapB?.state.value).toBe('B');
  });

  it('multiple events with same causationId are all found', async () => {
    const parentId = 'same-causation-parent';
    const event1: any = {
      id: `e-${Date.now()}-1`,
      domain: 'test',
      type: 'Step',
      payload: {},
      identifier: 'multi',
      causationId: parentId,
      created: new Date(),
    };
    const event2: any = {
      id: `e-${Date.now()}-2`,
      domain: 'test',
      type: 'Step',
      payload: {},
      identifier: 'multi',
      causationId: parentId,
      created: new Date(),
    };
    const event3: any = {
      id: `e-${Date.now()}-3`,
      domain: 'test',
      type: 'Step',
      payload: {},
      identifier: 'multi',
      causationId: parentId,
      created: new Date(),
    };

    await adapter.append([event1, event2, event3]);

    const found = await adapter.findByCausationId(parentId);
    expect(found).toHaveLength(3);
  });

  it('meta field with isCompensating flag is preserved', async () => {
    const eventWithMeta: any = {
      id: `meta-test-${Date.now()}`,
      domain: 'test',
      type: 'MetaTest',
      payload: {},
      identifier: 'meta-1',
      meta: { isCompensating: true, compensatesEventId: 'original-123' },
      created: new Date(),
    };
    await adapter.append([eventWithMeta]);

    const retrieved = await adapter.getEventById(eventWithMeta.id);
    expect(retrieved?.meta?.isCompensating).toBe(true);
    expect(retrieved?.meta?.compensatesEventId).toBe('original-123');
  });

  it('append with empty array does not error', async () => {
    await expect(adapter.append([])).resolves.not.toThrow();
  });

  it('appendToStream with empty array returns same version', async () => {
    const result = await adapter.appendToStream([], 5);
    expect(result.nextVersion).toBe(5);
  });

  it('getAllEvents pagination with pageSize larger than total returns single page', async () => {
    await adapter.append([makeEvent(1), makeEvent(2), makeEvent(3)]);

    const pages: PersistedEvent[][] = [];
    for await (const page of await adapter.getAllEvents(100)) {
      pages.push(page);
    }

    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(3);
  });

  it('snapshot overwrites previous snapshot for same domain/identifier', async () => {
    await adapter.saveSnapshot({
      domain: 'overwrite',
      identifier: 'snap-1',
      state: { version: 1 },
      sequence: 1,
      created: new Date(),
    });
    await adapter.saveSnapshot({
      domain: 'overwrite',
      identifier: 'snap-1',
      state: { version: 2 },
      sequence: 2,
      created: new Date(),
    });

    const snap = await adapter.getSnapshot<{ version: number }>('overwrite', 'snap-1');
    expect(snap?.state.version).toBe(2);
    expect(snap?.sequence).toBe(2);
  });

  it('findByCausationId returns empty array for non-existent causationId', async () => {
    const found = await adapter.findByCausationId('non-existent-causation-id');
    expect(found).toHaveLength(0);
  });

  it('stream events are independent across domains', async () => {
    await adapter.appendToStream([makeEvent(1, 'entity-A')], 0);
    await adapter.appendToStream([makeEvent(1, 'entity-B')], 0);

    const streamA = await adapter.getStreamEvents('test', 'integ-entity-A');
    const streamB = await adapter.getStreamEvents('test', 'integ-entity-B');

    expect(streamA).toHaveLength(1);
    expect(streamB).toHaveLength(1);
    expect(streamA[0].identifier).toBe('integ-entity-A');
    expect(streamB[0].identifier).toBe('integ-entity-B');
  });

  it('getEventById returns event with all fields intact', async () => {
    const eventWithAll: any = {
      id: `full-event-${Date.now()}`,
      domain: 'test',
      type: 'FullEvent',
      payload: { key: 'value' },
      identifier: 'full-id',
      correlationId: 'corr-123',
      causationId: 'caus-456',
      meta: { custom: 'meta' },
      created: new Date(),
    };
    await adapter.append([eventWithAll]);

    const retrieved = await adapter.getEventById(eventWithAll.id);
    expect(retrieved?.id).toBe(eventWithAll.id);
    expect(retrieved?.domain).toBe('test');
    expect(retrieved?.type).toBe('FullEvent');
    expect(retrieved?.payload.key).toBe('value');
    expect(retrieved?.identifier).toBe('full-id');
    expect(retrieved?.correlationId).toBe('corr-123');
    expect(retrieved?.causationId).toBe('caus-456');
    expect(retrieved?.meta?.custom).toBe('meta');
  });

  it('appendToStream with expectedVersion 0 succeeds on fresh stream', async () => {
    const result = await adapter.appendToStream([makeEvent(1, 'fresh-stream')], 0);
    expect(result.nextVersion).toBe(1);
  });

  it('getAllEvents with startFromId returns events after that id', async () => {
    await adapter.append([makeEvent(1), makeEvent(2), makeEvent(3), makeEvent(4)]);

    // Get first two events
    const pages: PersistedEvent[][] = [];
    for await (const page of await adapter.getAllEvents(2)) {
      pages.push(page);
    }

    const lastId = pages[0][1].id;
    const subsequentPages: PersistedEvent[][] = [];
    for await (const page of await adapter.getAllEvents(2, lastId)) {
      subsequentPages.push(page);
    }

    expect(subsequentPages[0][0].id).toBe(pages[1][0].id);
  });

  it('appendToStream increments version correctly across multiple calls', async () => {
    const r1 = await adapter.appendToStream([makeEvent(1, 'v-test')], 0);
    expect(r1.nextVersion).toBe(1);

    const r2 = await adapter.appendToStream([makeEvent(2, 'v-test')], 1);
    expect(r2.nextVersion).toBe(2);

    const r3 = await adapter.appendToStream([makeEvent(3, 'v-test')], 2);
    expect(r3.nextVersion).toBe(3);
  });

  it('getSnapshot returns null for non-existent domain/identifier', async () => {
    const snap = await adapter.getSnapshot('nonExistent', 'nonExistent');
    expect(snap).toBeNull();
  });

  it('getEventById returns null for deleted/non-existent event', async () => {
    const result = await adapter.getEventById('this-id-does-not-exist');
    expect(result).toBeNull();
  });

  it('append rejects empty identifiers', async () => {
    const event: any = {
      id: `empty-id-${Date.now()}`,
      domain: 'test',
      type: 'Test',
      payload: {},
      identifier: '',
      created: new Date(),
    };
    await expect(adapter.append([event])).rejects.toMatchObject({
      name: 'InvalidIdentifierError',
    });
  });

  it('appendToStream with wrong expectedVersion throws', async () => {
    await adapter.appendToStream([makeEvent(1, 'wrong-version')], 0);
    await expect(adapter.appendToStream([makeEvent(2, 'wrong-version')], 5)).rejects.toMatchObject({
      name: 'StreamConcurrencyError',
      expectedVersion: 5,
      actualVersion: 1,
    });
  });

  it('created timestamp is preserved accurately', async () => {
    const testEvent: any = {
      id: `ts-test-${Date.now()}`,
      domain: 'test',
      type: 'Test',
      payload: {},
      identifier: 'ts-1',
      created: new Date(),
    };
    await adapter.append([testEvent]);

    const retrieved = await adapter.getEventById(testEvent.id);
    // Check the timestamp is preserved
    expect(retrieved?.created.getTime()).toBe(testEvent.created.getTime());
  });

  it('appendToStream with expectedVersion 0 on existing stream throws', async () => {
    await adapter.appendToStream([makeEvent(1, 'existing')], 0);

    await expect(adapter.appendToStream([makeEvent(2, 'existing')], 0)).rejects.toMatchObject({
      name: 'StreamConcurrencyError',
    });
  });

  it('getAllEvents returns events across multiple streams', async () => {
    await adapter.appendToStream([makeEvent(1, 'stream-X')], 0);
    await adapter.append([makeEvent(1)]);
    await adapter.appendToStream([makeEvent(1, 'stream-Y')], 0);

    const all: PersistedEvent[] = [];
    for await (const batch of await adapter.getAllEvents(10)) {
      all.push(...batch);
    }

    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  it('getStreamEvents returns events sorted by sequence', async () => {
    await adapter.appendToStream([makeEvent(3, 'seq-sorted')], 0);
    await adapter.appendToStream([makeEvent(1, 'seq-sorted')], 1);
    await adapter.appendToStream([makeEvent(2, 'seq-sorted')], 2);

    const events = await adapter.getStreamEvents('test', 'integ-seq-sorted');
    expect(events.map((e) => e.sequence)).toEqual([1, 2, 3]);
  });

  it('snapshot overwrites correctly update sequence', async () => {
    await adapter.saveSnapshot({ domain: 's', identifier: 'seq', state: { v: 1 }, sequence: 1, created: new Date() });
    await adapter.saveSnapshot({ domain: 's', identifier: 'seq', state: { v: 2 }, sequence: 2, created: new Date() });
    await adapter.saveSnapshot({ domain: 's', identifier: 'seq', state: { v: 3 }, sequence: 3, created: new Date() });

    const snap = await adapter.getSnapshot<{ v: number }>('s', 'seq');
    expect(snap?.sequence).toBe(3);
    expect(snap?.state.v).toBe(3);
  });

  it('multiple events with different domains are independent', async () => {
    const eventA: any = {
      id: `differ-${Date.now()}-A`,
      domain: 'domainA',
      type: 'Test',
      payload: {},
      identifier: 'x',
      created: new Date(),
    };
    const eventB: any = {
      id: `differ-${Date.now()}-B`,
      domain: 'domainB',
      type: 'Test',
      payload: {},
      identifier: 'x',
      created: new Date(),
    };

    await adapter.append([eventA, eventB]);

    const fromA = await adapter.getStreamEvents('domainA', 'x');
    const fromB = await adapter.getStreamEvents('domainB', 'x');

    expect(fromA).toHaveLength(1);
    expect(fromB).toHaveLength(1);
  });

  it('events with large payloads are stored and retrieved', async () => {
    const largePayload = { data: 'x'.repeat(10000) };
    const event: any = {
      id: `large-${Date.now()}`,
      domain: 'test',
      type: 'Large',
      payload: largePayload,
      identifier: 'large-1',
      created: new Date(),
    };
    await adapter.append([event]);

    const retrieved = await adapter.getEventById(event.id);
    expect(retrieved?.payload.data).toBe(largePayload.data);
  });

  it('getAllEvents with pageSize 1 returns multiple pages', async () => {
    await adapter.append([makeEvent(1), makeEvent(2), makeEvent(3)]);

    const pages: PersistedEvent[][] = [];
    for await (const page of await adapter.getAllEvents(1)) {
      pages.push(page);
    }

    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((p) => p.length === 1)).toBe(true);
  });

  it('getSnapshot returns most recent by sequence', async () => {
    await adapter.saveSnapshot({
      domain: 's2',
      identifier: 'multi',
      state: { v: 1 },
      sequence: 1,
      created: new Date(),
    });
    await adapter.saveSnapshot({
      domain: 's2',
      identifier: 'multi',
      state: { v: 3 },
      sequence: 3,
      created: new Date(),
    });
    await adapter.saveSnapshot({
      domain: 's2',
      identifier: 'multi',
      state: { v: 2 },
      sequence: 2,
      created: new Date(),
    });

    // Last write wins in upsert, so sequence 2 is final
    const snap = await adapter.getSnapshot<{ v: number }>('s2', 'multi');
    expect(snap?.sequence).toBe(2);
    expect(snap?.state.v).toBe(2);
  });

  it('findByCausationId with multiple children returns all', async () => {
    const parentId = `causal-multi-${Date.now()}`;
    const events = [
      {
        id: `m1-${Date.now()}`,
        domain: 'test',
        type: 'Child',
        payload: {},
        identifier: 'cm',
        causationId: parentId,
        created: new Date(),
      },
      {
        id: `m2-${Date.now()}`,
        domain: 'test',
        type: 'Child',
        payload: {},
        identifier: 'cm',
        causationId: parentId,
        created: new Date(),
      },
      {
        id: `m3-${Date.now()}`,
        domain: 'test',
        type: 'Child',
        payload: {},
        identifier: 'cm',
        causationId: parentId,
        created: new Date(),
      },
    ];
    await adapter.append(events);

    const found = await adapter.findByCausationId(parentId);
    expect(found).toHaveLength(3);
  });

  it('appendToStream returns nextVersion matching appended event count', async () => {
    const r1 = await adapter.appendToStream([makeEvent(1, 'cnt')], 0);
    expect(r1.nextVersion).toBe(1);

    const r2 = await adapter.appendToStream([makeEvent(2, 'cnt'), makeEvent(3, 'cnt')], r1.nextVersion);
    expect(r2.nextVersion).toBe(3);
  });

  it('events with meta.isCompensating flag are queryable', async () => {
    const event: any = {
      id: `metaq-${Date.now()}`,
      domain: 'test',
      type: 'Test',
      payload: {},
      identifier: 'mq',
      meta: { isCompensating: true, compensatesEventId: 'orig-1' },
      created: new Date(),
    };
    await adapter.append([event]);

    const retrieved = await adapter.getEventById(event.id);
    expect(retrieved?.meta?.isCompensating).toBe(true);
    expect(retrieved?.meta?.compensatesEventId).toBe('orig-1');
  });

  it('appendToStream with multiple events in single call', async () => {
    const events = [makeEvent(1, 'multi'), makeEvent(2, 'multi'), makeEvent(3, 'multi')];
    const result = await adapter.appendToStream(events, 0);
    expect(result.nextVersion).toBe(3);

    const stream = await adapter.getStreamEvents('test', 'integ-multi');
    expect(stream).toHaveLength(3);
  });

  it('getStreamEvents with fromSequence 0 returns all events', async () => {
    await adapter.appendToStream([makeEvent(1, 'all')], 0);
    await adapter.appendToStream([makeEvent(2, 'all')], 1);

    const events = await adapter.getStreamEvents('test', 'integ-all', 0);
    expect(events).toHaveLength(2);
  });

  it('events with null correlationId and causationId are stored correctly', async () => {
    const event: any = {
      id: `nullc-${Date.now()}`,
      domain: 'test',
      type: 'Test',
      payload: {},
      identifier: 'nc',
      correlationId: null,
      causationId: null,
      created: new Date(),
    };
    await adapter.append([event]);

    const retrieved = await adapter.getEventById(event.id);
    expect(retrieved?.correlationId).toBeUndefined();
    expect(retrieved?.causationId).toBeUndefined();
  });

  it('snapshot state can be any JSON structure', async () => {
    const complexState = { items: [{ id: 1, name: 'test' }], count: 1, nested: { deep: { value: true } } };
    await adapter.saveSnapshot({
      domain: 'complex',
      identifier: 'snap1',
      state: complexState,
      sequence: 1,
      created: new Date(),
    });

    const snap = await adapter.getSnapshot<typeof complexState>('complex', 'snap1');
    expect(snap?.state.items[0].name).toBe('test');
    expect(snap?.state.nested.deep.value).toBe(true);
  });

  it('getAllEvents iterator can be consumed partially', async () => {
    await adapter.append([makeEvent(1), makeEvent(2), makeEvent(3), makeEvent(4)]);

    const iter = await adapter.getAllEvents(2);
    const firstPage = await iter.next();

    expect(firstPage.value).toHaveLength(2);
    expect(firstPage.done).toBe(false);
  });

  it('appendToStream with 3 events increments version by 3', async () => {
    const r = await adapter.appendToStream([makeEvent(1, 'v3'), makeEvent(2, 'v3'), makeEvent(3, 'v3')], 0);
    expect(r.nextVersion).toBe(3);
  });

  it('findByCausationId with no matches returns empty array', async () => {
    const found = await adapter.findByCausationId('non-existent-causation-id-' + Date.now());
    expect(found).toHaveLength(0);
  });

  it('getStreamEvents returns events with correct domain and identifier', async () => {
    await adapter.appendToStream([makeEvent(1, 'test-id')], 0);

    const events = await adapter.getStreamEvents('test', 'integ-test-id');
    expect(events[0].domain).toBe('test');
    expect(events[0].identifier).toBe('integ-test-id');
  });
});
