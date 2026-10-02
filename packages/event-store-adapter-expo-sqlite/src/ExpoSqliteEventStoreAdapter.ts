import type { SQLiteDatabase } from 'expo-sqlite';
import { monotonicFactory } from 'ulid';
import {
  AppendableEvent,
  BatchEventStoreAdapter,
  DuplicateEventError,
  ExpectedStreamVersion,
  EventCursorNotFoundError,
  InvalidIdentifierError,
  InvalidStreamBatchError,
  PersistedEvent,
  Snapshot,
  StreamConcurrencyError,
  StreamAppendableEvent,
} from '@schemeless/event-store-types';

export interface ExpoSqliteAdapterOptions {
  tableName?: string;
  snapshotTableName?: string;
}

interface RawEventRow {
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

const VALID_TABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;
const monotonicUlid = monotonicFactory();

function assertValidTableName(name: string): void {
  if (!VALID_TABLE_NAME.test(name)) {
    throw new Error(`Invalid table name: "${name}". Must match ${VALID_TABLE_NAME}`);
  }
}

export class ExpoSqliteEventStoreAdapter implements BatchEventStoreAdapter {
  private readonly db: SQLiteDatabase;
  private readonly tableName: string;
  private readonly snapshotTableName: string;

  constructor(db: SQLiteDatabase, options?: ExpoSqliteAdapterOptions) {
    this.db = db;
    const tableName = options?.tableName ?? 'event_store_entity';
    const snapshotTableName = options?.snapshotTableName ?? `${tableName}_snapshots`;
    assertValidTableName(tableName);
    assertValidTableName(snapshotTableName);
    this.tableName = tableName;
    this.snapshotTableName = snapshotTableName;
  }

  async init(): Promise<void> {
    await this.db.execAsync(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id            TEXT PRIMARY KEY NOT NULL,
        domain        TEXT NOT NULL,
        type          TEXT NOT NULL,
        meta          TEXT,
        payload       TEXT NOT NULL,
        identifier    TEXT NOT NULL DEFAULT '',
        correlationId TEXT,
        causationId   TEXT,
        sequence      INTEGER,
        created       INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS ${this.tableName}_stream_seq_idx
        ON ${this.tableName} (domain, identifier, sequence);

      CREATE INDEX IF NOT EXISTS ${this.tableName}_created_id_idx
        ON ${this.tableName} (created, id);

      CREATE TABLE IF NOT EXISTS ${this.snapshotTableName} (
        domain     TEXT NOT NULL,
        identifier TEXT NOT NULL,
        state      TEXT NOT NULL,
        sequence   INTEGER NOT NULL,
        created    INTEGER NOT NULL,
        PRIMARY KEY (domain, identifier)
      );
    `);
  }

  async close(): Promise<void> {
    await this.db.closeAsync();
  }

  async reset(): Promise<void> {
    await this.db.execAsync(`
      DELETE FROM ${this.tableName};
      DELETE FROM ${this.snapshotTableName};
    `);
  }

  private mapRowToEvent(row: RawEventRow): PersistedEvent {
    return {
      id: row.id,
      domain: row.domain,
      type: row.type,
      meta: row.meta ? JSON.parse(row.meta) : undefined,
      payload: JSON.parse(row.payload),
      identifier: row.identifier === '' ? undefined : row.identifier,
      correlationId: row.correlationId ?? undefined,
      causationId: row.causationId ?? undefined,
      sequence: row.sequence ?? undefined,
      created: new Date(row.created),
    };
  }

  private normalizeOptionalIdentifier(identifier: string | undefined, context: string): string {
    if (identifier == null) {
      return '';
    }
    if (typeof identifier !== 'string' || identifier.trim().length === 0) {
      throw new InvalidIdentifierError(`${context} requires a non-empty identifier`);
    }
    return identifier;
  }

  private assertSingleStream(events: Array<{ domain: string; identifier: string }>): {
    domain: string;
    identifier: string;
  } {
    const first = events[0];
    if (!first) {
      throw new InvalidStreamBatchError('appendToStream requires at least one event');
    }
    for (const event of events) {
      if (event.domain !== first.domain || event.identifier !== first.identifier) {
        throw new InvalidStreamBatchError('appendToStream only accepts events from a single domain/identifier stream');
      }
    }
    return first;
  }

  private ensureEventIds(events: AppendableEvent[]): Array<PersistedEvent & { identifier: string }> {
    return events.map((event) => {
      const identifier = this.normalizeOptionalIdentifier(event.identifier, 'Persisted events');
      return {
        ...event,
        id: event.id ?? monotonicUlid(),
        identifier,
        created: event.created instanceof Date ? event.created : new Date(event.created ?? Date.now()),
      } as PersistedEvent & { identifier: string };
    });
  }

  private streamKey(stream: { domain: string; identifier?: string }): string {
    return JSON.stringify([stream.domain, stream.identifier ?? '']);
  }

  private async readVersion(txn: SQLiteDatabase, domain: string, identifier: string): Promise<number> {
    const row = await txn.getFirstAsync<{ maxseq: number }>(
      `SELECT COALESCE(MAX(sequence), 0) as maxseq FROM ${this.tableName} WHERE domain = ? AND identifier = ?`,
      [domain, identifier]
    );
    return row?.maxseq ?? 0;
  }

  async getStreamVersions(
    streams: readonly Pick<ExpectedStreamVersion, 'domain' | 'identifier'>[]
  ): Promise<ExpectedStreamVersion[]> {
    const input = streams.map((stream) => ({
      domain: stream.domain,
      identifier: this.normalizeOptionalIdentifier(stream.identifier, 'getStreamVersions'),
    }));
    const result: ExpectedStreamVersion[] = [];
    await this.db.withExclusiveTransactionAsync(async (txn) => {
      for (const stream of input)
        result.push({
          domain: stream.domain,
          identifier: stream.identifier || undefined,
          expectedVersion: await this.readVersion(txn, stream.domain, stream.identifier),
        });
    });
    return result;
  }

  private async appendEvents(events: AppendableEvent[], expected?: readonly ExpectedStreamVersion[]): Promise<void> {
    const versions = new Map<string, ExpectedStreamVersion>();
    for (const stream of expected ?? []) {
      this.normalizeOptionalIdentifier(stream.identifier, 'Expected stream');
      if (!Number.isSafeInteger(stream.expectedVersion) || stream.expectedVersion < 0) {
        throw new InvalidStreamBatchError('Expected versions must be non-negative safe integers');
      }
      const key = this.streamKey(stream);
      if (versions.has(key)) throw new InvalidStreamBatchError('Duplicate expected stream version');
      versions.set(key, { ...stream });
    }
    const prepared = this.ensureEventIds(events);
    const streams = new Map<string, { domain: string; identifier: string }>();
    for (const event of prepared) {
      const key = this.streamKey(event);
      if (expected !== undefined && !versions.has(key)) {
        throw new InvalidStreamBatchError('Every written stream needs an expected version');
      }
      streams.set(key, { domain: event.domain, identifier: event.identifier });
    }
    for (const [key, stream] of versions)
      streams.set(key, {
        domain: stream.domain,
        identifier: stream.identifier ?? '',
      });
    if (!streams.size) return;

    await this.db.withExclusiveTransactionAsync(async (txn) => {
      // Acquire SQLite's writer reservation before reading, including for empty streams.
      // A deferred read-first transaction could otherwise fail upgrading a stale snapshot.
      await txn.runAsync(`UPDATE ${this.tableName} SET sequence = sequence WHERE 0`);
      const current = new Map<string, number>();
      for (const [key, stream] of streams) {
        const actual = await this.readVersion(txn, stream.domain, stream.identifier);
        const expectation = versions.get(key);
        if (expectation && actual !== expectation.expectedVersion) {
          throw new StreamConcurrencyError(stream.domain, stream.identifier, expectation.expectedVersion, actual);
        }
        current.set(key, actual);
      }
      // Preserve caller order; stream sequences advance independently.
      for (const event of prepared) {
        const key = this.streamKey(event);
        const sequence = current.get(key)! + 1;
        try {
          await txn.runAsync(
            `INSERT INTO ${this.tableName}
             (id, domain, type, payload, meta, identifier, correlationId, causationId, sequence, created)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              event.id,
              event.domain,
              event.type,
              JSON.stringify(event.payload ?? null),
              event.meta != null ? JSON.stringify(event.meta) : null,
              event.identifier,
              event.correlationId ?? null,
              event.causationId ?? null,
              sequence,
              event.created.getTime(),
            ]
          );
        } catch (error) {
          // Classify by the persisted ID, not by brittle native error-message matching.
          const duplicate = await txn.getFirstAsync(`SELECT id FROM ${this.tableName} WHERE id = ?`, [event.id]);
          if (duplicate) throw new DuplicateEventError(event.id);
          throw error;
        }
        current.set(key, sequence);
      }
    });
  }

  async append(events: AppendableEvent[]): Promise<void> {
    await this.appendEvents(events);
  }

  async appendBatch(events: AppendableEvent[], expectedVersions: readonly ExpectedStreamVersion[]): Promise<void> {
    await this.appendEvents(events, expectedVersions);
  }

  async appendToStream(events: StreamAppendableEvent[], expectedVersion: number): Promise<{ nextVersion: number }> {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      throw new InvalidStreamBatchError('Expected versions must be non-negative safe integers');
    }
    if (!events.length) return { nextVersion: expectedVersion };
    const first = this.assertSingleStream(
      events.map((event) => ({
        domain: event.domain,
        identifier: this.normalizeOptionalIdentifier(event.identifier, 'appendToStream'),
      }))
    );
    await this.appendBatch(events, [{ ...first, expectedVersion }]);
    return { nextVersion: expectedVersion + events.length };
  }

  async getAllEvents(
    pageSize: number = 100,
    startFromId?: string
  ): Promise<AsyncIterableIterator<Array<PersistedEvent>>> {
    const self = this;
    let cursorRowId: number | null = null;
    let hasMore = true;

    if (startFromId) {
      const startRow = (await this.db.getFirstAsync(`SELECT rowid AS rowid FROM ${this.tableName} WHERE id = ?`, [
        startFromId,
      ])) as { rowid: number } | null;

      if (!startRow) {
        throw new EventCursorNotFoundError(startFromId);
      }
      cursorRowId = startRow.rowid;
    }

    return {
      async next() {
        if (!hasMore) {
          return { value: undefined as any, done: true };
        }

        let rows: RawEventRow[];
        if (cursorRowId !== null) {
          rows = (await self.db.getAllAsync(
            `SELECT * FROM ${self.tableName}
             WHERE rowid > ?
             ORDER BY rowid ASC LIMIT ?`,
            [cursorRowId, pageSize]
          )) as RawEventRow[];
        } else {
          rows = (await self.db.getAllAsync(
            `SELECT * FROM ${self.tableName}
             ORDER BY rowid ASC LIMIT ?`,
            [pageSize]
          )) as RawEventRow[];
        }

        if (rows.length === 0) {
          hasMore = false;
          return { value: undefined as any, done: true };
        }

        const lastRow = rows[rows.length - 1];
        const lastCursorRow = (await self.db.getFirstAsync(
          `SELECT rowid AS rowid FROM ${self.tableName} WHERE id = ?`,
          [lastRow.id]
        )) as { rowid: number } | null;
        cursorRowId = lastCursorRow?.rowid ?? cursorRowId;
        if (rows.length < pageSize) {
          hasMore = false;
        }

        return {
          value: rows.map((row) => self.mapRowToEvent(row)),
          done: false,
        };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  async getEventById(id: string): Promise<PersistedEvent | null> {
    const row = (await this.db.getFirstAsync(`SELECT * FROM ${this.tableName} WHERE id = ?`, [
      id,
    ])) as RawEventRow | null;
    if (!row) return null;
    return this.mapRowToEvent(row);
  }

  async findByCausationId(causationId: string): Promise<PersistedEvent[]> {
    const rows = (await this.db.getAllAsync(
      `SELECT * FROM ${this.tableName} WHERE causationId = ? ORDER BY rowid ASC`,
      [causationId]
    )) as RawEventRow[];
    return rows.map((row) => this.mapRowToEvent(row));
  }

  async getStreamEvents(domain: string, identifier: string, fromSequence: number = 0): Promise<PersistedEvent[]> {
    const canonicalIdentifier = this.normalizeOptionalIdentifier(identifier, 'getStreamEvents');
    const rows = (await this.db.getAllAsync(
      `SELECT * FROM ${this.tableName}
       WHERE domain = ? AND identifier = ? AND sequence > ?
       ORDER BY sequence ASC`,
      [domain, canonicalIdentifier, fromSequence]
    )) as RawEventRow[];
    return rows.map((row) => this.mapRowToEvent(row));
  }

  async getSnapshot<State>(domain: string, identifier: string): Promise<Snapshot<State> | null> {
    const canonicalIdentifier = this.normalizeOptionalIdentifier(identifier, 'getSnapshot');
    const row = (await this.db.getFirstAsync(
      `SELECT * FROM ${this.snapshotTableName}
       WHERE domain = ? AND identifier = ?`,
      [domain, canonicalIdentifier]
    )) as { domain: string; identifier: string; state: string; sequence: number; created: number } | null;

    if (!row) {
      return null;
    }

    return {
      domain: row.domain,
      identifier: row.identifier,
      state: JSON.parse(row.state),
      sequence: row.sequence,
      created: new Date(row.created),
    };
  }

  async saveSnapshot<State>(snapshot: Snapshot<State>): Promise<void> {
    const identifier = this.normalizeOptionalIdentifier(snapshot.identifier, 'saveSnapshot');
    await this.db.runAsync(
      `INSERT OR REPLACE INTO ${this.snapshotTableName}
       (domain, identifier, state, sequence, created)
       VALUES (?, ?, ?, ?, ?)`,
      [
        snapshot.domain,
        identifier,
        JSON.stringify(snapshot.state),
        snapshot.sequence,
        (snapshot.created instanceof Date ? snapshot.created : new Date(snapshot.created)).getTime(),
      ]
    );
  }
}
