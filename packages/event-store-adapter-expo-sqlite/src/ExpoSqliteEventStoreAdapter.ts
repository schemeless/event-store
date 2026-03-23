import type { SQLiteDatabase } from 'expo-sqlite';
import {
  PersistedEvent,
  Snapshot,
  StreamConcurrencyError,
  StreamEventStoreAdapter,
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

function assertValidTableName(name: string): void {
  if (!VALID_TABLE_NAME.test(name)) {
    throw new Error(`Invalid table name: "${name}". Must match ${VALID_TABLE_NAME}`);
  }
}

export class ExpoSqliteEventStoreAdapter implements StreamEventStoreAdapter {
  readonly capabilities = {
    streamQuery: true as const,
    optimisticConcurrency: true as const,
    snapshot: true as const,
  };

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

  private groupEventsByStream(events: PersistedEvent[]): Map<string, PersistedEvent[]> {
    const grouped = new Map<string, PersistedEvent[]>();
    for (const event of events) {
      const key = `${event.domain}::${event.identifier ?? ''}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(event);
    }
    return grouped;
  }

  private async appendGroupedEvents(
    events: PersistedEvent[],
    options?: { expectedVersion?: number }
  ): Promise<Map<string, number>> {
    if (!events.length) {
      return new Map();
    }

    const versions = new Map<string, number>();
    await this.db.withExclusiveTransactionAsync(async (txn) => {
      for (const [streamKey, streamEvents] of this.groupEventsByStream(events).entries()) {
        const [domain, ...rest] = streamKey.split('::');
        const identifier = rest.join('::');

        const row = (await txn.getFirstAsync(
          `SELECT COALESCE(MAX(sequence), 0) as maxseq
           FROM ${this.tableName}
           WHERE domain = ? AND identifier = ?`,
          [domain, identifier]
        )) as { maxseq: number } | null;
        const currentVersion = row?.maxseq ?? 0;

        if (options?.expectedVersion !== undefined && currentVersion !== options.expectedVersion) {
          throw new StreamConcurrencyError(domain, identifier, options.expectedVersion, currentVersion);
        }

        let nextSequence = currentVersion + 1;
        for (const event of streamEvents) {
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
              (event.created instanceof Date ? event.created : new Date(event.created)).getTime(),
            ]
          );
        }

        versions.set(streamKey, currentVersion + streamEvents.length);
      }
    });

    return versions;
  }

  async append(events: PersistedEvent[]): Promise<void> {
    await this.appendGroupedEvents(events);
  }

  async appendToStream(events: PersistedEvent[], expectedVersion: number): Promise<{ nextVersion: number }> {
    if (!events.length) {
      return { nextVersion: expectedVersion };
    }

    const versions = await this.appendGroupedEvents(events, { expectedVersion });
    const first = events[0];
    const key = `${first.domain}::${first.identifier ?? ''}`;
    return { nextVersion: versions.get(key) ?? expectedVersion };
  }

  async getAllEvents(
    pageSize: number = 100,
    startFromId?: string
  ): Promise<AsyncIterableIterator<Array<PersistedEvent>>> {
    const self = this;
    let cursorCreated: number | null = null;
    let cursorId: string | null = null;
    let hasMore = true;

    if (startFromId) {
      const startRow = (await this.db.getFirstAsync(`SELECT created, id FROM ${this.tableName} WHERE id = ?`, [
        startFromId,
      ])) as { created: number; id: string } | null;

      if (startRow) {
        cursorCreated = startRow.created;
        cursorId = startRow.id;
      } else {
        cursorCreated = null;
        cursorId = startFromId;
      }
    }

    const useFallback = startFromId != null && cursorCreated === null;

    return {
      async next() {
        if (!hasMore) {
          return { value: undefined as any, done: true };
        }

        let rows: RawEventRow[];
        if (useFallback && cursorCreated === null) {
          rows = (await self.db.getAllAsync(
            `SELECT * FROM ${self.tableName}
             WHERE id > ?
             ORDER BY created ASC, id ASC LIMIT ?`,
            [cursorId!, pageSize]
          )) as RawEventRow[];
        } else if (cursorCreated !== null && cursorId !== null) {
          rows = (await self.db.getAllAsync(
            `SELECT * FROM ${self.tableName}
             WHERE (created > ?) OR (created = ? AND id > ?)
             ORDER BY created ASC, id ASC LIMIT ?`,
            [cursorCreated, cursorCreated, cursorId, pageSize]
          )) as RawEventRow[];
        } else {
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

        const lastRow = rows[rows.length - 1];
        cursorCreated = lastRow.created;
        cursorId = lastRow.id;
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

  async getStreamEvents(domain: string, identifier: string, fromSequence: number = 0): Promise<PersistedEvent[]> {
    const rows = (await this.db.getAllAsync(
      `SELECT * FROM ${this.tableName}
       WHERE domain = ? AND identifier = ? AND sequence > ?
       ORDER BY sequence ASC`,
      [domain, identifier || '', fromSequence]
    )) as RawEventRow[];
    return rows.map((row) => this.mapRowToEvent(row));
  }

  async getSnapshot<State>(domain: string, identifier: string): Promise<Snapshot<State> | null> {
    const row = (await this.db.getFirstAsync(
      `SELECT * FROM ${this.snapshotTableName}
       WHERE domain = ? AND identifier = ?`,
      [domain, identifier]
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
}
