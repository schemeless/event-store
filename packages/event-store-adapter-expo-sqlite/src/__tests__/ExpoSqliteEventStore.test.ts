import type { SQLiteDatabase } from 'expo-sqlite';
import type { PersistedEvent, StreamAppendableEvent } from '@schemeless/event-store-types';
import { ExpoSqliteEventStoreAdapter } from '../ExpoSqliteEventStoreAdapter';

interface MockRow {
  id: string;
  domain: string;
  type: string;
  meta: string | null;
  payload: string;
  identifier: string;
  correlationId: string | null;
  causationId: string | null;
  sequence: number | null;
  created: number;
}

interface MockSnapshotRow {
  domain: string;
  identifier: string;
  state: string;
  sequence: number;
  created: number;
}

function createMockDb() {
  const events: MockRow[] = [];
  const snapshots = new Map<string, MockSnapshotRow>();
  const withRowIds = () => events.map((event, index) => ({ ...event, rowid: index + 1 }));

  const runAsync = jest.fn(async (sql: string, params: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('INSERT INTO') && s.includes('event_store_entity')) {
      const [id, domain, type, payload, meta, identifier, correlationId, causationId, sequence, created] = params;
      events.push({
        id,
        domain,
        type,
        payload,
        meta,
        identifier: identifier ?? '',
        correlationId,
        causationId,
        sequence,
        created,
      });
      return;
    }

    if (s.startsWith('INSERT OR REPLACE INTO') && s.includes('_snapshots')) {
      const [domain, identifier, state, sequence, created] = params;
      snapshots.set(`${domain}::${identifier}`, { domain, identifier, state, sequence, created });
    }
  });

  const getFirstAsync = jest.fn(async (sql: string, params: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (s.includes('COALESCE(MAX(sequence)') && s.includes('event_store_entity')) {
      const [domain, identifier] = params;
      const streamEvents = events.filter((event) => event.domain === domain && event.identifier === (identifier ?? ''));
      return { maxseq: streamEvents.reduce((max, event) => Math.max(max, event.sequence ?? 0), 0) };
    }

    if (s.startsWith('SELECT rowid AS rowid FROM')) {
      const [id] = params;
      const row = withRowIds().find((event) => event.id === id);
      return row ? { rowid: row.rowid } : null;
    }

    if (s.includes('_snapshots') && s.includes('WHERE domain')) {
      const [domain, identifier] = params;
      return snapshots.get(`${domain}::${identifier}`) ?? null;
    }

    return null;
  });

  const getAllAsync = jest.fn(async (sql: string, params: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (s.includes('sequence >')) {
      const [domain, identifier, fromSeq] = params;
      return events
        .filter(
          (event) =>
            event.domain === domain && event.identifier === (identifier ?? '') && (event.sequence ?? 0) > fromSeq
        )
        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    }

    if (s.includes('WHERE rowid > ?')) {
      const [startRowId, limit] = params;
      return withRowIds()
        .filter((event) => event.rowid > startRowId)
        .sort((a, b) => a.rowid - b.rowid)
        .slice(0, limit)
        .map(({ rowid, ...event }) => event);
    }

    if (s.includes('WHERE causationId = ? ORDER BY rowid ASC')) {
      const [causationId] = params;
      return withRowIds()
        .filter((event) => event.causationId === causationId)
        .sort((a, b) => a.rowid - b.rowid)
        .map(({ rowid, ...event }) => event);
    }

    if (s.includes('ORDER BY rowid ASC LIMIT')) {
      const [limit] = params;
      return withRowIds()
        .sort((a, b) => a.rowid - b.rowid)
        .slice(0, limit)
        .map(({ rowid, ...event }) => event);
    }

    return [];
  });

  const execAsync = jest.fn(async (sql: string) => {
    if (sql.includes('DELETE FROM event_store_entity')) {
      events.length = 0;
      snapshots.clear();
    }
  });

  const withExclusiveTransactionAsync = jest.fn(async (task: (txn: any) => Promise<void>) => {
    await task({ runAsync, getFirstAsync, getAllAsync });
  });

  const db = {
    execAsync,
    runAsync,
    getFirstAsync,
    getAllAsync,
    withExclusiveTransactionAsync,
    closeAsync: jest.fn(),
  } as unknown as SQLiteDatabase;

  return { db };
}

function makeEvent(num: number, identifier?: string): PersistedEvent<any> {
  return {
    id: `event-${identifier ?? 'global'}-${num.toString().padStart(6, '0')}`,
    domain: 'test',
    type: 'Tested',
    payload: { n: num },
    identifier,
    created: new Date(1_700_000_000_000 + num * 1000),
  };
}

function makeStreamEvent(num: number, identifier: string): StreamAppendableEvent<any> {
  return makeEvent(num, identifier) as StreamAppendableEvent<any>;
}

function makeEventWithoutId(num: number, identifier?: string): PersistedEvent<any> {
  return {
    domain: 'test',
    type: 'Tested',
    payload: { n: num },
    identifier,
    created: new Date(1_700_000_000_000 + num * 1000),
  } as PersistedEvent<any>;
}

describe('ExpoSqliteEventStoreAdapter', () => {
  let adapter: ExpoSqliteEventStoreAdapter;
  let ctx: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    ctx = createMockDb();
    adapter = new ExpoSqliteEventStoreAdapter(ctx.db);
  });

  it('rejects invalid table names', () => {
    expect(() => new ExpoSqliteEventStoreAdapter(ctx.db, { tableName: 'DROP TABLE foo;--' })).toThrow(
      /Invalid table name/
    );
  });

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
    await adapter.appendToStream([makeStreamEvent(1, 'user-A'), makeStreamEvent(2, 'user-A')], 0);

    const stream = await adapter.getStreamEvents('test', 'user-A');
    expect(stream.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it('throws a stream concurrency error on mismatched expected version', async () => {
    await adapter.appendToStream([makeStreamEvent(1, 'user-A')], 0);

    await expect(adapter.appendToStream([makeStreamEvent(2, 'user-A')], 0)).rejects.toMatchObject({
      name: 'StreamConcurrencyError',
      expectedVersion: 0,
      actualVersion: 1,
    });
  });

  it('rejects appendToStream batches that span multiple streams', async () => {
    await expect(
      adapter.appendToStream([makeStreamEvent(1, 'user-A'), makeStreamEvent(2, 'user-B')], 0)
    ).rejects.toMatchObject({
      name: 'InvalidStreamBatchError',
    });
  });

  it('uses append order instead of created time when scanning', async () => {
    const lateFirst = makeEvent(10, 'user-B');
    const earlySecond = makeEvent(11, 'user-B');
    lateFirst.created = new Date('2026-01-03T00:00:00.000Z');
    earlySecond.created = new Date('2026-01-01T00:00:00.000Z');
    await adapter.append([lateFirst, earlySecond]);

    const pages = await adapter.getAllEvents(10);
    const allEvents: PersistedEvent[] = [];
    for await (const batch of pages) {
      allEvents.push(...batch);
    }

    expect(allEvents.map((event) => event.id)).toEqual(['event-user-B-000010', 'event-user-B-000011']);
  });

  it('throws when startFromId does not exist', async () => {
    await adapter.append([makeEvent(1), makeEvent(2)]);

    await expect(adapter.getAllEvents(10, 'missing-id')).rejects.toMatchObject({
      name: 'EventCursorNotFoundError',
    });
  });

  it('stores and loads snapshots', async () => {
    await adapter.saveSnapshot({
      domain: 'test',
      identifier: 'user-A',
      state: { total: 4 },
      sequence: 2,
      created: new Date(),
    });

    const snapshot = await adapter.getSnapshot<{ total: number }>('test', 'user-A');
    expect(snapshot?.state).toEqual({ total: 4 });
    expect(snapshot?.sequence).toBe(2);
  });

  it('resets events and snapshots', async () => {
    await adapter.append([makeEvent(1)]);
    await adapter.saveSnapshot({
      domain: 'test',
      identifier: 'user-A',
      state: { total: 1 },
      sequence: 1,
      created: new Date(),
    });

    await adapter.reset?.();

    const pages = await adapter.getAllEvents(10);
    const allEvents: PersistedEvent[] = [];
    for await (const batch of pages) {
      allEvents.push(...batch);
    }
    expect(allEvents).toHaveLength(0);
    expect(await adapter.getSnapshot('test', 'user-A')).toBeNull();
  });
});
