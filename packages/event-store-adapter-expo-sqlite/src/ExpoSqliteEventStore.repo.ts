import type { SQLiteDatabase } from 'expo-sqlite';
import {
  ConcurrencyError,
  CreatedEvent,
  IEventStoreEntity,
  IEventStoreRepo,
  IEventStoreRepoCapabilities,
  ISnapshotEntity,
  StoreEventsOptions,
} from '@schemeless/event-store-types';

export interface ExpoSqliteAdapterOptions {
  /** Event table name, defaults to 'event_store_entity' */
  tableName?: string;
  /** Snapshot table name, defaults to 'event_store_entity_snapshots' */
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

// --- [P2 FIX] Table name validation to prevent SQL injection ---
const VALID_TABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;

function assertValidTableName(name: string): void {
  if (!VALID_TABLE_NAME.test(name)) {
    throw new Error(`Invalid table name: "${name}". Must match ${VALID_TABLE_NAME}`);
  }
}

export class ExpoSqliteEventStoreRepo<PAYLOAD = any, META = any> implements IEventStoreRepo<PAYLOAD, META> {
  private readonly db: SQLiteDatabase;
  private readonly tableName: string;
  private readonly snapshotTableName: string;

  capabilities: IEventStoreRepoCapabilities = {
    aggregate: true,
  };

  constructor(db: SQLiteDatabase, options?: ExpoSqliteAdapterOptions) {
    this.db = db;
    const tableName = options?.tableName ?? 'event_store_entity';
    const snapshotTableName = options?.snapshotTableName ?? `${tableName}_snapshots`;
    // Validate both names at construction time so failures are early and explicit
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

      CREATE INDEX IF NOT EXISTS ${this.tableName}_causation_id_idx
        ON ${this.tableName} (causationId);

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

  private mapRowToEntity(row: RawEventRow): IEventStoreEntity<PAYLOAD, META> {
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

  createEventEntity(event: CreatedEvent<any>): IEventStoreEntity<PAYLOAD, META> {
    return {
      id: event.id,
      domain: event.domain,
      type: event.type,
      payload: event.payload as unknown as PAYLOAD,
      meta: event.meta as unknown as META,
      identifier: event.identifier,
      correlationId: event.correlationId,
      causationId: event.causationId,
      created: event.created instanceof Date ? event.created : new Date(event.created),
      sequence: undefined,
    };
  }

  async storeEvents(events: CreatedEvent<any>[], options?: StoreEventsOptions): Promise<void> {
    if (!events.length) return;

    await this.db.withExclusiveTransactionAsync(async (txn) => {
      const streamGroups = new Map<string, CreatedEvent<any>[]>();
      for (const event of events) {
        const key = `${event.domain}::${event.identifier ?? ''}`;
        if (!streamGroups.has(key)) streamGroups.set(key, []);
        streamGroups.get(key)!.push(event);
      }

      for (const [streamKey, streamEvents] of streamGroups.entries()) {
        const [domain, ...rest] = streamKey.split('::');
        const identifier = rest.join('::') || '';

        const row = (await txn.getFirstAsync(
          `SELECT COALESCE(MAX(sequence), 0) as maxseq
           FROM ${this.tableName}
           WHERE domain = ? AND identifier = ?`,
          [domain, identifier]
        )) as { maxseq: number } | null;
        const currentSequence = row?.maxseq ?? 0;

        if (options?.expectedSequence !== undefined && currentSequence !== options.expectedSequence) {
          throw new ConcurrencyError(streamKey, options.expectedSequence, currentSequence);
        }

        let nextSequence = currentSequence + 1;
        for (const event of streamEvents) {
          const created = event.created instanceof Date ? event.created : new Date(event.created);

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
              event.identifier ?? '',
              event.correlationId ?? null,
              event.causationId ?? null,
              nextSequence++,
              created.getTime(),
            ]
          );
        }
      }
    });
  }

  // --- [P1 FIX] getAllEvents now uses a flat, single-iterator approach. ---
  // The old code returned a temporary "inline" iterator object for the fallback
  // path that never set `done: true` after the first batch. This rewrite
  // eliminates that separate code path: cursor state is set up eagerly before
  // the iterator is returned, and the single iterator loop handles all cases.
  async getAllEvents(
    pageSize: number = 100,
    startFromId?: string
  ): Promise<AsyncIterableIterator<Array<IEventStoreEntity<PAYLOAD, META>>>> {
    const self = this;
    let cursorCreated: number | null = null;
    let cursorId: string | null = null;
    let hasMore = true;

    if (startFromId) {
      const startRow = (await this.db.getFirstAsync(`SELECT created, id FROM ${this.tableName} WHERE id = ?`, [
        startFromId,
      ])) as { created: number; id: string } | null;

      if (startRow) {
        // Cursor found: standard path, start after this row
        cursorCreated = startRow.created;
        cursorId = startRow.id;
      } else {
        // Cursor ID not found — fall back to lexicographic id > startFromId,
        // matching TypeORM/Prisma MoreThan(id) semantics (same as PG adapter).
        // We set a sentinel so the iterator loop below uses this fallback SQL
        // for only the first batch, then promotes to normal cursor pagination.
        cursorCreated = null;
        cursorId = startFromId; // used as a lexicographic lower-bound in fallback
      }
    }

    const useFallback = startFromId != null && cursorCreated === null;

    return {
      async next() {
        if (!hasMore) return { value: undefined as any, done: true };

        let rows: RawEventRow[];

        if (useFallback && cursorCreated === null) {
          // Fallback: id > startFromId (lexicographic), runs only when cursor not found
          rows = (await self.db.getAllAsync(
            `SELECT * FROM ${self.tableName}
             WHERE id > ?
             ORDER BY created ASC, id ASC LIMIT ?`,
            [cursorId!, pageSize]
          )) as RawEventRow[];
        } else if (cursorCreated !== null && cursorId !== null) {
          // Standard cursor-based pagination
          rows = (await self.db.getAllAsync(
            `SELECT * FROM ${self.tableName}
             WHERE (created > ?) OR (created = ? AND id > ?)
             ORDER BY created ASC, id ASC LIMIT ?`,
            [cursorCreated, cursorCreated, cursorId, pageSize]
          )) as RawEventRow[];
        } else {
          // No cursor at all: fetch from the very beginning
          rows = (await self.db.getAllAsync(
            `SELECT * FROM ${self.tableName}
             ORDER BY created ASC, id ASC LIMIT ?`,
            [pageSize]
          )) as RawEventRow[];
        }

        if (rows.length === 0) {
          hasMore = false;
          return { value: undefined as any, done: true };
        }

        // Advance cursor to the last row, so subsequent next() calls continue from here
        const lastRow = rows[rows.length - 1];
        cursorCreated = lastRow.created;
        cursorId = lastRow.id;

        if (rows.length < pageSize) {
          hasMore = false;
        }

        return {
          value: rows.map((r) => self.mapRowToEntity(r)),
          done: false,
        };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  async getStreamEvents(
    domain: string,
    identifier: string,
    fromSequence: number = 0
  ): Promise<IEventStoreEntity<PAYLOAD, META>[]> {
    const rows = (await this.db.getAllAsync(
      `SELECT * FROM ${this.tableName}
       WHERE domain = ? AND identifier = ? AND sequence > ?
       ORDER BY sequence ASC`,
      [domain, identifier || '', fromSequence]
    )) as RawEventRow[];
    return rows.map((row) => this.mapRowToEntity(row));
  }

  async getStreamSequence(domain: string, identifier: string): Promise<number> {
    const row = (await this.db.getFirstAsync(
      `SELECT COALESCE(MAX(sequence), 0) as maxseq FROM ${this.tableName}
       WHERE domain = ? AND identifier = ?`,
      [domain, identifier || '']
    )) as { maxseq: number } | null;
    return row?.maxseq ?? 0;
  }

  async getEventById(id: string): Promise<IEventStoreEntity<PAYLOAD, META> | null> {
    const row = (await this.db.getFirstAsync(`SELECT * FROM ${this.tableName} WHERE id = ?`, [
      id,
    ])) as RawEventRow | null;
    return row ? this.mapRowToEntity(row) : null;
  }

  async findByCausationId(causationId: string): Promise<IEventStoreEntity<PAYLOAD, META>[]> {
    const rows = (await this.db.getAllAsync(
      `SELECT * FROM ${this.tableName}
       WHERE causationId = ?
       ORDER BY created ASC, id ASC`,
      [causationId]
    )) as RawEventRow[];
    return rows.map((row) => this.mapRowToEntity(row));
  }

  async getSnapshot<STATE>(domain: string, identifier: string): Promise<ISnapshotEntity<STATE> | null> {
    const row = (await this.db.getFirstAsync(
      `SELECT * FROM ${this.snapshotTableName}
       WHERE domain = ? AND identifier = ?`,
      [domain, identifier]
    )) as {
      domain: string;
      identifier: string;
      state: string;
      sequence: number;
      created: number;
    } | null;

    if (!row) return null;

    return {
      domain: row.domain,
      identifier: row.identifier,
      state: JSON.parse(row.state),
      sequence: row.sequence,
      created: new Date(row.created),
    };
  }

  async saveSnapshot<STATE>(snapshot: ISnapshotEntity<STATE>): Promise<void> {
    await this.db.runAsync(
      `INSERT OR REPLACE INTO ${this.snapshotTableName}
       (domain, identifier, state, sequence, created)
       VALUES (?, ?, ?, ?, ?)`,
      [
        snapshot.domain,
        snapshot.identifier,
        JSON.stringify(snapshot.state),
        snapshot.sequence,
        (snapshot.created instanceof Date ? snapshot.created : new Date(snapshot.created)).getTime(),
      ]
    );
  }

  async resetStore(): Promise<void> {
    await this.db.execAsync(`
      DELETE FROM ${this.tableName};
      DELETE FROM ${this.snapshotTableName};
    `);
  }
}
