import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { Worker } from 'worker_threads';
import type { SQLiteDatabase } from 'expo-sqlite';
import { DuplicateEventError, InvalidStreamBatchError, StreamConcurrencyError } from '@schemeless/event-store-types';
import { ExpoSqliteEventStoreAdapter } from '../ExpoSqliteEventStoreAdapter';

// Real SQLite SQL/locking/rollback through the Expo async API shape. Native Expo
// connection creation still needs an iOS/Android device regression.
function openDb(filename: string): any {
  const { DatabaseSync } = require('node:sqlite');
  const native = new DatabaseSync(filename);
  native.exec('PRAGMA busy_timeout = 5000');
  return {
    execAsync: async (sql: string) => native.exec(sql),
    runAsync: async (sql: string, params: any[] = []) => native.prepare(sql).run(...params),
    getFirstAsync: async (sql: string, params: any[] = []) => native.prepare(sql).get(...params) ?? null,
    getAllAsync: async (sql: string, params: any[] = []) => native.prepare(sql).all(...params),
    closeAsync: async () => native.close(),
    withExclusiveTransactionAsync: async (action: (tx: any) => Promise<void>) => {
      const tx = openDb(filename);
      try {
        await tx.execAsync('BEGIN');
        await action(tx);
        await tx.execAsync('COMMIT');
      } catch (error) {
        await tx.execAsync('ROLLBACK');
        throw error;
      } finally {
        await tx.closeAsync();
      }
    },
  };
}
const event = (id: string, identifier = 'a', domain = 'test') => ({
  id,
  domain,
  identifier,
  type: 'created',
  payload: {},
  created: new Date(),
});
const version = (identifier = 'a', expectedVersion = 0, domain = 'test') => ({ domain, identifier, expectedVersion });

describe('SQLite atomic batches (real engine)', () => {
  let directory: string;
  let filename: string;
  let adapter: ExpoSqliteEventStoreAdapter;
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'event-store-sqlite-'));
    filename = join(directory, 'events.db');
    adapter = new ExpoSqliteEventStoreAdapter(openDb(filename) as SQLiteDatabase);
    await adapter.init();
  });
  afterEach(async () => {
    await adapter.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('preserves input order and separate contiguous sequences, including delimiter-containing streams', async () => {
    await adapter.appendBatch([event('a1'), event('b1', 'b'), event('a2')], [version(), version('b')]);
    const events: any[] = [];
    for await (const page of await adapter.getAllEvents(1)) events.push(...page);
    expect(events.map((e) => e.id)).toEqual(['a1', 'b1', 'a2']);
    expect(events.map((e) => e.sequence)).toEqual([1, 1, 2]);
    await adapter.appendBatch(
      [event('c', 'c', 'a::b'), event('d', 'b::c', 'a')],
      [version('c', 0, 'a::b'), version('b::c', 0, 'a')]
    );
    expect(await adapter.getStreamVersions([version('c', 0, 'a::b'), version('b::c', 0, 'a')])).toEqual([
      version('c', 1, 'a::b'),
      version('b::c', 1, 'a'),
    ]);
  });

  it('checks written and read-only dependencies before inserting anything', async () => {
    await adapter.appendToStream([event('dependency', 'b')], 0);
    await expect(adapter.appendBatch([event('new')], [version(), version('b')])).rejects.toBeInstanceOf(
      StreamConcurrencyError
    );
    expect(await adapter.getStreamEvents('test', 'a')).toEqual([]);
    await expect(adapter.appendBatch([], [version('b')])).rejects.toBeInstanceOf(StreamConcurrencyError);
    await adapter.appendBatch([], [version('b', 1)]);
  });

  it('rolls back earlier inserts on a typed duplicate ID error', async () => {
    await adapter.append([event('existing', 'b')]);
    await expect(adapter.appendBatch([event('new'), event('existing')], [version()])).rejects.toBeInstanceOf(
      DuplicateEventError
    );
    expect(await adapter.getStreamEvents('test', 'a')).toEqual([]);
  });

  it('rolls back on a non-unique insertion failure', async () => {
    await expect(
      adapter.appendBatch([event('new'), { ...event('invalid', 'b'), type: null as any }], [version(), version('b')])
    ).rejects.toThrow();
    expect(await adapter.getEventById('new')).toBeNull();
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid expected version %s',
    async (expectedVersion) => {
      await expect(adapter.appendBatch([event('new')], [version('a', expectedVersion)])).rejects.toBeInstanceOf(
        InvalidStreamBatchError
      );
      await expect(adapter.appendToStream([], expectedVersion)).rejects.toBeInstanceOf(InvalidStreamBatchError);
    }
  );

  it('rejects missing/duplicate expectations and invalid identifiers; supports domain-only streams', async () => {
    await expect(adapter.appendBatch([event('new')], [])).rejects.toBeInstanceOf(InvalidStreamBatchError);
    await expect(adapter.appendBatch([], [version(), version()])).rejects.toBeInstanceOf(InvalidStreamBatchError);
    await expect(adapter.appendBatch([], [version(' ')])).rejects.toMatchObject({ name: 'InvalidIdentifierError' });
    await adapter.appendBatch(
      [{ ...event('global'), identifier: undefined }],
      [{ domain: 'test', expectedVersion: 0 }]
    );
    expect(await adapter.getStreamVersions([{ domain: 'test' }, version('missing')])).toEqual([
      { domain: 'test', identifier: undefined, expectedVersion: 1 },
      version('missing'),
    ]);
  });

  it.each([false, true])(
    'serializes independent writers with reversed stream order (existing=%s)',
    async (existing) => {
      if (existing) await adapter.appendBatch([event('seed-a'), event('seed-b', 'b')], [version(), version('b')]);
      const sourcePath = resolve(__dirname, '../ExpoSqliteEventStoreAdapter.ts');
      const source = require('typescript').transpileModule(readFileSync(sourcePath, 'utf8'), {
        compilerOptions: {
          module: require('typescript').ModuleKind.CommonJS,
          target: require('typescript').ScriptTarget.ES2020,
        },
      }).outputText;
      const bridge = require('typescript').transpileModule(
        readFileSync(__filename, 'utf8')
          .split('function openDb')[1]
          .split('const event =')[0]
          .replace(/^/, 'function openDb'),
        {
          compilerOptions: { target: require('typescript').ScriptTarget.ES2020 },
        }
      ).outputText;
      const workers = [false, true].map(
        (reverse) =>
          new Worker(
            `
      const { workerData, parentPort } = require('worker_threads');
      const sourceRequire = require('module').createRequire(workerData.sourcePath);
      const module = { exports: {} };
      new Function('require', 'exports', 'module', workerData.source)(sourceRequire, module.exports, module);
      ${bridge}
      const adapter = new module.exports.ExpoSqliteEventStoreAdapter(openDb(workerData.filename));
      parentPort.once('message', async () => {
        const streams = workerData.reverse ? ['b', 'a'] : ['a', 'b'];
        try {
          await adapter.appendBatch(streams.map(identifier => ({ id: identifier + workerData.reverse, domain: 'test', identifier, type: 'created', payload: {}, created: new Date() })),
            streams.map(identifier => ({ domain: 'test', identifier, expectedVersion: workerData.existing ? 1 : 0 })));
          parentPort.postMessage('committed');
        } catch (error) { parentPort.postMessage(error.name); }
        finally { await adapter.close(); }
      });
      parentPort.postMessage('ready');
    `,
            { eval: true, workerData: { source, sourcePath, filename, reverse, existing } }
          )
      );
      try {
        await Promise.all(
          workers.map(
            (worker) =>
              new Promise<void>((resolve, reject) => {
                worker.once('message', () => resolve());
                worker.once('error', reject);
              })
          )
        );
        const results = await Promise.all(
          workers.map(
            (worker) =>
              new Promise<string>((resolve, reject) => {
                worker.once('message', resolve);
                worker.once('error', reject);
                worker.postMessage('go');
              })
          )
        );
        expect(results.sort()).toEqual(['StreamConcurrencyError', 'committed'].sort());
        expect((await adapter.getStreamVersions([version(), version('b')])).map((v) => v.expectedVersion)).toEqual(
          existing ? [2, 2] : [1, 1]
        );
      } finally {
        await Promise.all(workers.map((worker) => worker.terminate()));
      }
    },
    15000
  );
});
