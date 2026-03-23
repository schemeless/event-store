import type { SQLiteDatabase } from 'expo-sqlite';
import type { PersistedEvent } from '@schemeless/event-store-types';
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

    if (s.startsWith('SELECT created, id FROM')) {
      const [id] = params;
      return events.find((event) => event.id === id) ?? null;
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

    if (s.includes('(created >') || s.includes('(created>')) {
      const [createdGt, createdEq, idGt, limit] = params;
      return events
        .filter((event) => event.created > createdGt || (event.created === createdEq && event.id > idGt))
        .sort((a, b) => a.created - b.created || a.id.localeCompare(b.id))
        .slice(0, limit);
    }

    if (s.includes('id >')) {
      const [startId, limit] = params;
      return events
        .filter((event) => event.id > startId)
        .sort((a, b) => a.created - b.created || a.id.localeCompare(b.id))
        .slice(0, limit);
    }

    if (s.includes('ORDER BY created ASC, id ASC LIMIT')) {
      const [limit] = params;
      return [...events].sort((a, b) => a.created - b.created || a.id.localeCompare(b.id)).slice(0, limit);
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

  it('loads a stream in sequence order', async () => {
    await adapter.appendToStream([makeEvent(1, 'user-A'), makeEvent(2, 'user-A')], 0);

    const stream = await adapter.getStreamEvents('test', 'user-A');
    expect(stream.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it('throws a stream concurrency error on mismatched expected version', async () => {
    await adapter.appendToStream([makeEvent(1, 'user-A')], 0);

    await expect(adapter.appendToStream([makeEvent(2, 'user-A')], 0)).rejects.toMatchObject({
      name: 'StreamConcurrencyError',
      expectedVersion: 0,
      actualVersion: 1,
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
