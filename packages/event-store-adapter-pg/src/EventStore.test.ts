import { Client } from 'pg';
import type { PersistedEvent } from '@schemeless/event-store-types';
import { PgEventStoreAdapter } from './PgEventStoreAdapter';

const connectionOptions = {
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'event_store_test',
};

const makeEvent = (num: number, identifier?: string): PersistedEvent<any> => ({
  id: `event-${identifier ?? 'global'}-${num.toString().padStart(6, '0')}`,
  domain: 'test',
  type: 'Tested',
  payload: { id: num },
  identifier,
  created: new Date(Date.now() + num * 1000),
});

describe('PgEventStoreAdapter', () => {
  let adapter: PgEventStoreAdapter;

  beforeAll(async () => {
    adapter = new PgEventStoreAdapter(connectionOptions);
    await adapter.init();
  });

  afterAll(async () => {
    await adapter.close();
  });

  beforeEach(async () => {
    await adapter.reset?.();
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

  it('rejects invalid table names', () => {
    expect(() => new PgEventStoreAdapter({ ...connectionOptions, tableName: 'DROP TABLE foo; --' })).toThrow(
      /Invalid table name/
    );
  });

  it('creates distinct stream indexes for long custom table names', async () => {
    const prefix = 'event_store_table_with_really_long_name_prefix_for_collision_';
    const tableNameA = `${prefix}a`;
    const tableNameB = `${prefix}b`;

    const adapterA = new PgEventStoreAdapter({ ...connectionOptions, tableName: tableNameA });
    const adapterB = new PgEventStoreAdapter({ ...connectionOptions, tableName: tableNameB });
    const client = new Client(connectionOptions);

    try {
      await adapterA.init();
      await adapterB.init();

      await client.connect();
      const res = await client.query(
        `SELECT tablename, indexname
         FROM pg_indexes
         WHERE tablename IN ($1, $2)
           AND indexdef LIKE '%(domain, identifier, sequence)%'
         ORDER BY tablename ASC`,
        [tableNameA, tableNameB]
      );

      expect(res.rows.length).toBe(2);
      expect(new Set(res.rows.map((row) => row.indexname)).size).toBe(2);
    } finally {
      await client.end();
      await adapterA.close();
      await adapterB.close();
      const cleanup = new Client(connectionOptions);
      await cleanup.connect();
      try {
        await cleanup.query(`DROP TABLE IF EXISTS ${tableNameA}`);
        await cleanup.query(`DROP TABLE IF EXISTS ${tableNameA}_snapshots`);
        await cleanup.query(`DROP TABLE IF EXISTS ${tableNameB}`);
        await cleanup.query(`DROP TABLE IF EXISTS ${tableNameB}_snapshots`);
      } finally {
        await cleanup.end();
      }
    }
  });
});
