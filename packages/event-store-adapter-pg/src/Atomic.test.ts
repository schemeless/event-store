/// <reference lib="es2020.promise" />
import { Client } from 'pg';
import { PgEventStoreAdapter, PgTransactionAdapter } from './PgEventStoreAdapter';
import { makeEventStoreCore } from '../../event-store-core/src/makeEventStoreCore';
import {
  AppendableEvent,
  ExpectedStreamVersion,
  StreamConcurrencyError,
  DuplicateEventError,
  supportsAppendBatch,
  supportsIncrementalLog,
} from '@schemeless/event-store-types';

const options = {
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'event_store_test',
  tableName: 'atomic_events',
  statement_timeout: 3000,
};
const event = (id: string, identifier = id, domain = 'test'): AppendableEvent => ({
  id,
  identifier,
  domain,
  type: 'Added',
  payload: { id },
  created: new Date(),
});
const version = (identifier: string, expectedVersion = 0, domain = 'test'): ExpectedStreamVersion => ({
  domain,
  identifier,
  expectedVersion,
});
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('PostgreSQL atomic batches (independent pools)', () => {
  let a: PgEventStoreAdapter;
  let b: PgEventStoreAdapter;
  let sql: Client;
  beforeAll(async () => {
    a = new PgEventStoreAdapter(options);
    b = new PgEventStoreAdapter(options);
    await a.init();
    await b.init();
    sql = new Client(options);
    await sql.connect();
    await sql.query('CREATE TABLE IF NOT EXISTS atomic_receipts (id text PRIMARY KEY, result jsonb NOT NULL)');
  });
  beforeEach(async () => {
    await a.reset();
    await sql.query('TRUNCATE atomic_receipts');
  });
  afterAll(async () => {
    await sql.end();
    await a.close();
    await b.close();
  });
  const ids = async () => (await sql.query('SELECT id FROM atomic_events ORDER BY position')).rows.map((r) => r.id);

  it('detects optional capabilities and preserves interleaved input order and sequences', async () => {
    expect(supportsAppendBatch(a)).toBe(true);
    expect(supportsIncrementalLog(a)).toBe(true);
    await a.appendBatch([event('a1', 'a'), event('b1', 'b'), event('a2', 'a')], [version('b'), version('a')]);
    expect(await ids()).toEqual(['a1', 'b1', 'a2']);
    expect((await a.getStreamEvents('test', 'a')).map((e) => e.sequence)).toEqual([1, 2]);
    expect((await b.getStreamEvents('test', 'b')).map((e) => e.sequence)).toEqual([1]);
  });

  it('rolls back every stream when any expected version conflicts', async () => {
    await a.appendBatch([event('a1', 'a')], [version('a')]);
    await expect(
      b.appendBatch([event('b1', 'b'), event('a2', 'a')], [version('a'), version('b')])
    ).rejects.toBeInstanceOf(StreamConcurrencyError);
    expect(await ids()).toEqual(['a1']);
  });

  it.each([0, 1])('serializes concurrent stream writes at version %i', async (v) => {
    if (v) await a.appendToStream([event('initial', 'a') as any], 0);
    const results = await Promise.allSettled([
      a.appendBatch([event('left', 'a')], [version('a', v)]),
      b.appendBatch([event('right', 'a')], [version('a', v)]),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(failure.reason).toBeInstanceOf(StreamConcurrencyError);
    expect(failure.reason.actualVersion).toBe(v + 1);
    expect(await ids()).toHaveLength(v + 1);
  });

  it('locks reverse stream orders consistently without hanging', async () => {
    const results = await Promise.allSettled([
      a.appendBatch([event('a1', 'a'), event('b1', 'b')], [version('a'), version('b')]),
      b.appendBatch([event('b2', 'b'), event('a2', 'a')], [version('b'), version('a')]),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(
      StreamConcurrencyError
    );
    expect(await ids()).toHaveLength(2);
  });

  it('rolls back a mid-batch insertion failure', async () => {
    await expect(
      a.appendBatch([event('valid', 'a'), { ...event('invalid', 'b'), payload: null }], [version('a'), version('b')])
    ).rejects.toMatchObject({ code: '23502' });
    expect(await ids()).toEqual([]);
  });

  it('types duplicate IDs and rolls back earlier inserts', async () => {
    await a.append([event('existing', 'a')]);
    await expect(
      a.appendBatch([event('new', 'b'), event('existing', 'c')], [version('b'), version('c')])
    ).rejects.toBeInstanceOf(DuplicateEventError);
    expect(await ids()).toEqual(['existing']);
  });

  it('rolls back events and receipts on receipt insertion failure', async () => {
    await expect(
      a.withTransaction(async (tx) => {
        await tx.appendBatch([event('e', 'a')], [version('a')]);
        await tx.execute('INSERT INTO atomic_receipts VALUES ($1, $2)', ['cmd', null]);
      })
    ).rejects.toMatchObject({ code: '23502' });
    expect(await ids()).toEqual([]);
    expect((await sql.query('SELECT * FROM atomic_receipts')).rows).toEqual([]);
  });

  it('publishes events and consumer receipt together on the same connection', async () => {
    const held = gate();
    const release = gate();
    let returned: PgTransactionAdapter;
    const transaction = a.withTransaction(async (tx) => {
      returned = tx;
      const before = await tx.execute('SELECT pg_backend_pid() AS pid');
      await tx.appendBatch([event('e', 'a')], [version('a')]);
      await tx.saveSnapshot({ domain: 'test', identifier: 'a', state: {}, sequence: 1, created: new Date() });
      await tx.execute('INSERT INTO atomic_receipts VALUES ($1, $2)', ['cmd', { event: 'e' }]);
      const after = await tx.execute('SELECT pg_backend_pid() AS pid');
      expect(before.rows[0].pid).toBe(after.rows[0].pid);
      held.resolve();
      await release.promise;
      return 'done';
    });
    try {
      await held.promise;
      expect(await b.getEventById('e')).toBeNull();
      expect((await sql.query('SELECT * FROM atomic_receipts')).rows).toEqual([]);
    } finally {
      release.resolve();
    }
    expect(await transaction).toBe('done');
    expect(await ids()).toEqual(['e']);
    expect((await sql.query('SELECT * FROM atomic_receipts')).rows).toHaveLength(1);
    await expect(returned!.append([])).rejects.toMatchObject({ name: 'TransactionScopeError' });
    await expect(returned!.getEventById('e')).rejects.toMatchObject({ name: 'TransactionScopeError' });
    await expect(returned!.execute('SELECT 1')).rejects.toMatchObject({ name: 'TransactionScopeError' });
  });

  it('rolls back callback exceptions and invalidates escaped iterators', async () => {
    let tx!: PgTransactionAdapter;
    let iterator: AsyncIterableIterator<any>;
    await expect(
      a.withTransaction(async (scope) => {
        tx = scope;
        await tx.appendBatch([event('e', 'a')], [version('a')]);
        iterator = await tx.getAllEvents();
        throw new Error('callback failed');
      })
    ).rejects.toThrow('callback failed');
    expect(await ids()).toEqual([]);
    await expect(iterator!.next()).rejects.toMatchObject({ name: 'TransactionScopeError' });
    await expect(tx.getStreamVersions([])).rejects.toMatchObject({ name: 'TransactionScopeError' });
  });

  it('scoped lifecycle and nested transactions are rejected without closing the root pool', async () => {
    await a.withTransaction(async (tx) => {
      const internal = tx as PgEventStoreAdapter;
      await expect(internal.close()).rejects.toMatchObject({ name: 'TransactionScopeError' });
      await expect(internal.init()).rejects.toMatchObject({ name: 'TransactionScopeError' });
      await expect(internal.reset()).rejects.toMatchObject({ name: 'TransactionScopeError' });
      await expect(internal.withTransaction(async () => {})).rejects.toMatchObject({ name: 'TransactionScopeError' });
    });
    await expect(a.append([event('ok')])).resolves.toBeUndefined();
  });

  it('rolls back even when a consumer catches an append conflict', async () => {
    await expect(
      a.withTransaction(async (tx) => {
        await tx.execute('INSERT INTO atomic_receipts VALUES ($1, $2)', ['cmd', {}]);
        try {
          await tx.appendBatch([event('e', 'a')], [version('a', 1)]);
        } catch {}
      })
    ).rejects.toMatchObject({ name: 'TransactionScopeError' });
    expect((await sql.query('SELECT * FROM atomic_receipts')).rows).toEqual([]);
  });

  it('rejects multiple append calls before committing partial results', async () => {
    await expect(
      a.withTransaction(async (tx) => {
        await tx.append([event('a')]);
        await tx.append([event('b')]);
      })
    ).rejects.toMatchObject({ name: 'TransactionScopeError' });
    expect(await ids()).toEqual([]);
  });

  it('rejects unawaited SQL and rolls back its writes', async () => {
    let pending: Promise<any>;
    await expect(
      a.withTransaction(async (tx) => {
        pending = tx.execute('INSERT INTO atomic_receipts VALUES ($1, $2)', ['cmd', {}]);
      })
    ).rejects.toMatchObject({ name: 'TransactionScopeError' });
    await pending!;
    expect((await sql.query('SELECT * FROM atomic_receipts')).rows).toEqual([]);
  });

  it('a concurrent command claim executes once and replays the committed receipt', async () => {
    const run = (adapter: PgEventStoreAdapter) =>
      adapter.withTransaction(async (tx) => {
        const claim = await tx.execute(
          'INSERT INTO atomic_receipts (id, result) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id',
          ['cmd', {}]
        );
        if (!claim.rowCount)
          return (await tx.execute('SELECT result FROM atomic_receipts WHERE id=$1', ['cmd'])).rows[0].result;
        await tx.appendBatch([event('once', 'a')], [version('a')]);
        await tx.execute('UPDATE atomic_receipts SET result=$2 WHERE id=$1', ['cmd', { event: 'once' }]);
        return { event: 'once' };
      });
    expect(await Promise.all([run(a), run(b)])).toEqual([{ event: 'once' }, { event: 'once' }]);
    expect(await ids()).toEqual(['once']);
  });

  it('a consumer scope revision rejects a decision after an unlisted stream changes', async () => {
    const decision = await a.getStreamVersions([{ domain: 'test', identifier: 'scope-revision' }]);
    await b.appendBatch(
      [event('new-stream'), event('revision', 'scope-revision')],
      [version('new-stream'), version('scope-revision')]
    );
    await expect(
      a.appendBatch([event('stale'), event('stale-revision', 'scope-revision')], [...decision, version('stale')])
    ).rejects.toBeInstanceOf(StreamConcurrencyError);
    expect(await ids()).toEqual(['new-stream', 'revision']);
  });

  it('rejects transaction controls and SQL outside a scope', async () => {
    await expect(a.execute('SELECT 1')).rejects.toMatchObject({ name: 'TransactionScopeError' });
    await expect(a.withTransaction((tx) => tx.execute('COMMIT'))).rejects.toMatchObject({
      name: 'TransactionScopeError',
    });
    await expect(a.withTransaction((tx) => tx.execute('SELECT 1; COMMIT'))).rejects.toMatchObject({
      name: 'TransactionScopeError',
    });
  });

  it('allows unrelated streams to commit while a lower position is uncommitted; vector pagination misses nothing', async () => {
    const held = gate();
    const release = gate();
    const low = a.withTransaction(async (tx) => {
      await tx.appendBatch([event('low1', 'low'), event('low2', 'low')], [version('low')]);
      held.resolve();
      await release.promise;
    });
    let page;
    try {
      await held.promise;
      await b.appendBatch([event('high', 'high')], [version('high')]);
      page = await b.getLogPage([], 1);
      expect(page.events.map((e) => e.id)).toEqual(['high']);
      expect((await b.getLogPage(page.cursor, 1)).events).toEqual([]);
    } finally {
      release.resolve();
    }
    await low;
    const second = await b.getLogPage(page.cursor, 1);
    const third = await b.getLogPage(second.cursor, 1);
    expect([...page.events, ...second.events, ...third.events].map((e) => e.id)).toEqual(['high', 'low1', 'low2']);
    expect((await b.getLogPage(third.cursor)).events).toEqual([]);
    // The old single-ID resume contract is explicitly NOT commit ordered.
    const old = await b.getAllEvents(10, 'high');
    expect((await old.next()).done).toBe(true);
  });

  it('rejects a changed read-only dependency without inserting any writes', async () => {
    const baseline = await a.getStreamVersions([
      { domain: 'test', identifier: 'dependency' },
      { domain: 'test', identifier: 'write' },
    ]);
    await b.appendBatch([event('dep', 'dependency')], [version('dependency')]);
    await expect(a.appendBatch([event('e', 'write')], baseline)).rejects.toBeInstanceOf(StreamConcurrencyError);
    expect(await ids()).toEqual(['dep']);
  });

  it('holds a checked read-only dependency lock through receipt commit', async () => {
    const held = gate();
    const release = gate();
    const started = gate();
    const first = a.withTransaction(async (tx) => {
      await tx.appendBatch([event('e', 'write')], [version('write'), version('dependency')]);
      held.resolve();
      await release.promise;
      await tx.execute('INSERT INTO atomic_receipts VALUES ($1, $2)', ['cmd', {}]);
    });
    await held.promise;
    let finished = false;
    let waitingPid: number;
    const second = b.withTransaction(async (tx) => {
      waitingPid = (await tx.execute('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      started.resolve();
      await tx.appendBatch([event('dep', 'dependency')], [version('dependency')]);
      finished = true;
    });
    try {
      await started.promise;
      let blockers: number[] = [];
      for (let attempt = 0; attempt < 100 && !blockers.length; attempt++) {
        blockers = (await sql.query('SELECT pg_blocking_pids($1) AS blockers', [waitingPid!])).rows[0].blockers;
        if (!blockers.length) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blockers.length).toBeGreaterThan(0);
      expect(finished).toBe(false);
    } finally {
      release.resolve();
    }
    await Promise.all([first, second]);
    expect(await ids()).toEqual(['e', 'dep']);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid expected version %s', async (v) => {
    await expect(a.appendBatch([event('e')], [version('e', v)])).rejects.toMatchObject({
      name: 'InvalidStreamBatchError',
    });
    expect(await ids()).toEqual([]);
  });
  it('validates missing/duplicate versions, blank identifiers and empty batches with dependencies', async () => {
    await expect(a.appendBatch([event('e')], [])).rejects.toMatchObject({ name: 'InvalidStreamBatchError' });
    await expect(a.appendBatch([event('e')], [version('e'), version('e')])).rejects.toMatchObject({
      name: 'InvalidStreamBatchError',
    });
    await expect(a.appendBatch([], [version(' ')])).rejects.toMatchObject({ name: 'InvalidIdentifierError' });
    await expect(a.appendBatch([], [version('e', 1)])).rejects.toBeInstanceOf(StreamConcurrencyError);
    await expect(a.appendBatch([], [version('e')])).resolves.toBeUndefined();
    await expect(a.getLogPage([], 0)).rejects.toMatchObject({ name: 'InvalidStreamBatchError' });
    await expect(a.getLogPage([version('e'), version('e')])).rejects.toMatchObject({ name: 'InvalidStreamBatchError' });
  });

  it('does not confuse stream keys containing separators', async () => {
    await a.appendBatch(
      [event('x', 'c', 'a::b'), event('y', 'b::c', 'a')],
      [version('c', 0, 'a::b'), version('b::c', 0, 'a')]
    );
    expect((await a.getStreamEvents('a::b', 'c'))[0].sequence).toBe(1);
    expect((await a.getStreamEvents('a', 'b::c'))[0].sequence).toBe(1);
  });

  it('supports legacy domain-only streams and offline core export/import', async () => {
    const global = { ...event('global'), identifier: undefined };
    await a.appendBatch(
      [global, event('b1', 'b'), event('b2', 'b')],
      [{ domain: 'test', expectedVersion: 0 }, version('b')]
    );
    const core = makeEventStoreCore(a);
    const exported = [];
    for await (const page of core.export({ pageSize: 1 })) exported.push(...page);
    await core.import(exported, { replace: true });
    expect(await ids()).toEqual(['global', 'b1', 'b2']);
    expect((await a.getLogPage()).events.map((e) => e.sequence)).toEqual([1, 1, 2]);
  });

  it('preserves bigint position precision in the legacy paginated cursor', async () => {
    await sql.query("SELECT setval('atomic_events_position_seq', 9007199254740992, true)");
    await a.append([event('p1', 'p'), event('p2', 'p'), event('p3', 'p')]);
    const all = [];
    for await (const page of await a.getAllEvents(1)) all.push(...page);
    expect(all.map((e) => e.id)).toEqual(['p1', 'p2', 'p3']);
    const resumed = [];
    for await (const page of await a.getAllEvents(1, 'p1')) resumed.push(...page);
    expect(resumed.map((e) => e.id)).toEqual(['p2', 'p3']);
  });

  it('qualified and unqualified table names use the same stream lock', async () => {
    const qualified = new PgEventStoreAdapter({ ...options, tableName: 'public.atomic_events' });
    try {
      const results = await Promise.allSettled([
        a.appendBatch([event('plain', 'a')], [version('a')]),
        qualified.appendBatch([event('qualified', 'a')], [version('a')]),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(
        StreamConcurrencyError
      );
      expect(await ids()).toHaveLength(1);
    } finally {
      await qualified.close();
    }
  });

  it('refuses legacy unsequenced rows rather than silently skipping them', async () => {
    await sql.query(
      `INSERT INTO atomic_events (id,domain,type,payload,sequence,created) VALUES ('legacy','old','Old','{}',NULL,now())`
    );
    await expect(a.getLogPage()).rejects.toMatchObject({ name: 'InvalidStreamBatchError' });
  });
});
