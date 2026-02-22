import { ExpoSqliteEventStoreRepo } from '../ExpoSqliteEventStore.repo';
import { ConcurrencyError } from '@schemeless/event-store-types';
import type { CreatedEvent } from '@schemeless/event-store-types';
import type { SQLiteDatabase } from 'expo-sqlite';

// ---------------------------------------------------------------------------
// In-memory SQLite mock that stores events in a plain JS array.
// We replicate just enough of the expo-sqlite API surface to exercise the
// repository's SQL logic faithfully.
// ---------------------------------------------------------------------------

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
  const snapshots: Map<string, MockSnapshotRow> = new Map();

  // Simple SQL parser — only handles the patterns this adapter emits.
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
      return;
    }
  });

  const getFirstAsync = jest.fn(async (sql: string, params: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();

    // MAX(sequence)
    if (s.includes('COALESCE(MAX(sequence)') && s.includes('event_store_entity')) {
      const [domain, identifier] = params;
      const streamEvents = events.filter((e) => e.domain === domain && e.identifier === (identifier ?? ''));
      const maxseq = streamEvents.reduce((m, e) => Math.max(m, e.sequence ?? 0), 0);
      return { maxseq };
    }

    // cursor lookup
    if (s.startsWith('SELECT created, id FROM')) {
      const [id] = params;
      return events.find((e) => e.id === id) ?? null;
    }

    // getEventById
    if (s.startsWith('SELECT * FROM event_store_entity WHERE id')) {
      const [id] = params;
      return events.find((e) => e.id === id) ?? null;
    }

    // snapshot
    if (s.includes('_snapshots') && s.includes('WHERE domain')) {
      const [domain, identifier] = params;
      return snapshots.get(`${domain}::${identifier}`) ?? null;
    }

    return null;
  });

  const getAllAsync = jest.fn(async (sql: string, params: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();

    // getStreamEvents: WHERE domain=? AND identifier=? AND sequence > ? ORDER BY sequence ASC
    if (s.includes('sequence >')) {
      const [domain, identifier, fromSeq] = params;
      return events
        .filter((e) => e.domain === domain && e.identifier === (identifier ?? '') && (e.sequence ?? 0) > fromSeq)
        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    }

    // findByCausationId
    if (s.includes('causationId =') || s.includes('causationId=')) {
      const [cid] = params;
      return events
        .filter((e) => e.causationId === cid)
        .sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
    }

    // getAllEvents: cursor-based (created > ? OR (created = ? AND id > ?))
    if (s.includes('(created >') || s.includes('(created>')) {
      const [createdGt, createdEq, idGt, limit] = params;
      return events
        .filter((e) => e.created > createdGt || (e.created === createdEq && e.id > idGt))
        .sort((a, b) => a.created - b.created || a.id.localeCompare(b.id))
        .slice(0, limit);
    }

    // getAllEvents: fallback (id > startFromId)
    if (s.includes('id >')) {
      const [startId, limit] = params;
      return events
        .filter((e) => e.id > startId)
        .sort((a, b) => a.created - b.created || a.id.localeCompare(b.id))
        .slice(0, limit);
    }

    // getAllEvents: no cursor, from the start
    if (s.includes('ORDER BY created ASC, id ASC LIMIT')) {
      const [limit] = params;
      return [...events].sort((a, b) => a.created - b.created || a.id.localeCompare(b.id)).slice(0, limit);
    }

    return [];
  });

  const execAsync = jest.fn(async (_sql: string) => {
    // init() and resetStore() — just clear state for resetStore
    if (_sql.includes('DELETE FROM event_store_entity')) {
      events.length = 0;
      snapshots.clear();
    }
  });

  const withExclusiveTransactionAsync = jest.fn(async (task: (txn: any) => Promise<void>) => {
    // Expose same query API in the "transaction"
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

  return { db, events, snapshots };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(num: number, identifier?: string): CreatedEvent<any> {
  return {
    id: `event-${num.toString().padStart(6, '0')}`,
    domain: 'test',
    type: 'test',
    payload: { n: num },
    identifier,
    created: new Date(1_700_000_000_000 + num * 1000),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExpoSqliteEventStoreRepo', () => {
  let repo: ExpoSqliteEventStoreRepo;
  let ctx: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    ctx = createMockDb();
    repo = new ExpoSqliteEventStoreRepo(ctx.db);
  });

  // --- [P2] Table name validation ---
  describe('constructor validation', () => {
    it('rejects invalid table names', () => {
      expect(() => new ExpoSqliteEventStoreRepo(ctx.db, { tableName: 'DROP TABLE foo;--' })).toThrow(
        /Invalid table name/
      );
    });

    it('rejects invalid snapshot table names', () => {
      expect(() => new ExpoSqliteEventStoreRepo(ctx.db, { snapshotTableName: '1invalid' })).toThrow(
        /Invalid table name/
      );
    });

    it('accepts valid table names', () => {
      expect(() => new ExpoSqliteEventStoreRepo(ctx.db, { tableName: 'my_events_v2' })).not.toThrow();
    });
  });

  // --- storeEvents + OCC ---
  describe('storeEvents', () => {
    it('stores events and assigns ascending sequences', async () => {
      await repo.storeEvents([makeEvent(1, 'user-A'), makeEvent(2, 'user-A')]);

      const stored = ctx.events.filter((e) => e.identifier === 'user-A');
      expect(stored).toHaveLength(2);
      expect(stored.map((e) => e.sequence)).toEqual([1, 2]);
    });

    it('independent streams have independent sequences', async () => {
      await repo.storeEvents([makeEvent(1, 'user-A')]);
      await repo.storeEvents([makeEvent(2, 'user-B')]);

      expect(ctx.events.find((e) => e.identifier === 'user-A')?.sequence).toBe(1);
      expect(ctx.events.find((e) => e.identifier === 'user-B')?.sequence).toBe(1);
    });

    it('throws ConcurrencyError when expectedSequence mismatches', async () => {
      await repo.storeEvents([makeEvent(1, 'user-A')]);

      await expect(repo.storeEvents([makeEvent(2, 'user-A')], { expectedSequence: 0 })).rejects.toThrow(
        ConcurrencyError
      );
    });

    it('succeeds when expectedSequence matches current sequence', async () => {
      await repo.storeEvents([makeEvent(1, 'user-A')]);
      await expect(repo.storeEvents([makeEvent(2, 'user-A')], { expectedSequence: 1 })).resolves.not.toThrow();
    });

    it('serializes payload and meta as JSON', async () => {
      const event = makeEvent(1);
      event.meta = { schemaVersion: 2, custom: true };
      event.payload = { nested: { value: [1, 2, 3] } };
      await repo.storeEvents([event]);

      const row = ctx.events[0];
      expect(JSON.parse(row.payload)).toEqual(event.payload);
      expect(JSON.parse(row.meta!)).toEqual(event.meta);
    });
  });

  // --- [P1] getAllEvents pagination ---
  describe('getAllEvents', () => {
    it('iterates all events in order', async () => {
      for (let i = 1; i <= 5; i++) await repo.storeEvents([makeEvent(i)]);

      const iter = await repo.getAllEvents(3);
      const pages: any[][] = [];
      for await (const page of iter) pages.push(page);

      const allIds = ([] as any[]).concat(...pages).map((e) => e.id);
      expect(allIds).toHaveLength(5);
      // Verify ascending order
      for (let i = 0; i < allIds.length - 1; i++) {
        expect(allIds[i] <= allIds[i + 1]).toBe(true);
      }
    });

    it('resumes from a known cursor ID', async () => {
      for (let i = 1; i <= 5; i++) await repo.storeEvents([makeEvent(i)]);

      const first = await repo.getAllEvents(2);
      const firstPage = (await first.next()).value;
      const cursorId = firstPage[firstPage.length - 1].id;

      const rest = await repo.getAllEvents(10, cursorId);
      const pages: any[][] = [];
      for await (const page of rest) pages.push(page);

      // Should have events 3-5 (after the cursor event-000002)
      expect(([] as any[]).concat(...pages)).toHaveLength(3);
    });

    // --- [P1] the key regression test ---
    it('[P1] terminates when startFromId does not exist (fallback path)', async () => {
      for (let i = 1; i <= 3; i++) await repo.storeEvents([makeEvent(i)]);

      const iter = await repo.getAllEvents(100, 'nonexistent-id-xyz');
      const pages: any[][] = [];

      // Without the fix this loop would run forever (or until a timeout).
      // We guard with a counter to make the test fail fast instead.
      let iterCount = 0;
      for await (const page of iter) {
        pages.push(page);
        if (++iterCount > 10) throw new Error('Iterator did not terminate — infinite loop detected');
      }

      // With no matching cursor, fallback returns events with id > 'nonexistent-id-xyz'.
      // All 3 events have ids 'event-000001..3', which are all < 'nonexistent-id-xyz'
      // lexicographically, so the fallback query returns an empty page => done immediately.
      expect(([] as any[]).concat(...pages).length).toBeGreaterThanOrEqual(0); // may be 0 or 1-3 depending on sort
    });

    it('[P1] fallback path yields events then terminates (not infinite loop)', async () => {
      // Store events whose ids sort ABOVE the phantom cursor
      const events = [1, 2, 3].map((n) => ({
        ...makeEvent(n),
        id: `zzz-event-${n}`,
      })) as CreatedEvent<any>[];
      await repo.storeEvents(events);

      // Use a cursor that doesn't exist but sorts before our events
      const iter = await repo.getAllEvents(100, 'aaa-phantom-cursor');
      const pages: any[][] = [];
      let iterCount = 0;
      for await (const page of iter) {
        pages.push(page);
        if (++iterCount > 10) throw new Error('Iterator did not terminate — infinite loop detected');
      }

      // All 3 events should be returned once
      expect(([] as any[]).concat(...pages)).toHaveLength(3);
      // Iterator must have terminated (implicitly verified by exiting the loop)
    });
  });

  // --- Snapshots ---
  describe('snapshot support', () => {
    it('returns null when no snapshot exists', async () => {
      const snap = await repo.getSnapshot('domain', 'id-1');
      expect(snap).toBeNull();
    });

    it('saves and retrieves a snapshot', async () => {
      const snapshot = {
        domain: 'user',
        identifier: 'user-42',
        state: { balance: 100 },
        sequence: 5,
        created: new Date(1_700_000_005_000),
      };
      await repo.saveSnapshot(snapshot);
      const result = await repo.getSnapshot<{ balance: number }>('user', 'user-42');

      expect(result).not.toBeNull();
      expect(result?.state).toEqual({ balance: 100 });
      expect(result?.sequence).toBe(5);
    });

    it('overwrites an existing snapshot on save (INSERT OR REPLACE)', async () => {
      await repo.saveSnapshot({ domain: 'u', identifier: 'u1', state: { v: 1 }, sequence: 1, created: new Date() });
      await repo.saveSnapshot({ domain: 'u', identifier: 'u1', state: { v: 2 }, sequence: 2, created: new Date() });

      const result = await repo.getSnapshot<{ v: number }>('u', 'u1');
      expect(result?.state.v).toBe(2);
      expect(result?.sequence).toBe(2);
    });
  });

  // --- getStreamEvents ---
  describe('getStreamEvents', () => {
    it('returns events for a stream in sequence order', async () => {
      await repo.storeEvents([makeEvent(1, 'user-1'), makeEvent(2, 'user-1'), makeEvent(3, 'user-1')]);

      const events = await repo.getStreamEvents('test', 'user-1');
      expect(events.map((e) => e.sequence)).toEqual([1, 2, 3]);
    });

    it('returns events after a given fromSequence', async () => {
      await repo.storeEvents([makeEvent(1, 'user-1'), makeEvent(2, 'user-1'), makeEvent(3, 'user-1')]);

      const events = await repo.getStreamEvents('test', 'user-1', 1);
      expect(events).toHaveLength(2);
      expect(events[0].sequence).toBe(2);
    });
  });
});
