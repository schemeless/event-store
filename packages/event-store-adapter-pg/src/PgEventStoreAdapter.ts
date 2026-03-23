import { createHash } from 'crypto';
import { Pool, PoolClient, PoolConfig } from 'pg';
import {
  PersistedEvent,
  Snapshot,
  StreamConcurrencyError,
  StreamEventStoreAdapter,
} from '@schemeless/event-store-types';

export interface PgAdapterOptions extends PoolConfig {
  tableName?: string;
}

const VALID_TABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;

function assertValidTableName(name: string): void {
  if (!VALID_TABLE_NAME.test(name)) {
    throw new Error(`Invalid table name: "${name}". Must match ${VALID_TABLE_NAME}`);
  }
}

function buildIndexName(tableName: string, suffix: string): string {
  const normalizedTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '_');
  const plain = `${normalizedTableName}_${suffix}`;
  if (plain.length <= 63) {
    return plain;
  }

  const hash = createHash('sha1').update(tableName).digest('hex').slice(0, 10);
  const reservedLength = hash.length + suffix.length + 2;
  const baseLength = Math.max(1, 63 - reservedLength);
  const truncatedBase = normalizedTableName.slice(0, baseLength);
  return `${truncatedBase}_${hash}_${suffix}`;
}

export class PgEventStoreAdapter implements StreamEventStoreAdapter {
  readonly capabilities = {
    streamQuery: true as const,
    optimisticConcurrency: true as const,
    snapshot: true as const,
  };

  private readonly pool: Pool;
  private readonly tableName: string;
  private readonly idxStreamSequence: string;
  private readonly idxSnapshotKey: string;

  constructor(options: PgAdapterOptions) {
    const { tableName = 'event_store_entity', ...poolConfig } = options;
    assertValidTableName(tableName);
    this.pool = new Pool(poolConfig);
    this.tableName = tableName;
    this.idxStreamSequence = buildIndexName(tableName, 'stream_sequence_idx');
    this.idxSnapshotKey = buildIndexName(tableName, 'snapshot_key_idx');
  }

  async init(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          id VARCHAR(128) PRIMARY KEY,
          domain VARCHAR(64) NOT NULL,
          type VARCHAR(128) NOT NULL,
          meta JSONB,
          payload JSONB NOT NULL,
          identifier VARCHAR(255) NOT NULL DEFAULT '',
          "correlationId" VARCHAR(128),
          "causationId" VARCHAR(128),
          sequence INT,
          created TIMESTAMP(6) NOT NULL
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.tableName}_snapshots (
          domain VARCHAR(64) NOT NULL,
          identifier VARCHAR(255) NOT NULL DEFAULT '',
          state JSONB NOT NULL,
          sequence INT NOT NULL,
          created TIMESTAMP(6) NOT NULL,
          PRIMARY KEY (domain, identifier)
        );
      `);

      // Normalise legacy NULL identifiers before creating the unique index.
      // On older tables NULL values are distinct in Postgres, so two rows can
      // share (domain, sequence) with identifier IS NULL. Converting them to ''
      // first avoids a 23505 collision when the unique index is created below.
      await client.query(`
        UPDATE ${this.tableName}
        SET identifier = ''
        WHERE identifier IS NULL;
      `);
      await client.query(`
        ALTER TABLE ${this.tableName}
        ALTER COLUMN identifier SET DEFAULT '';
      `);
      await client.query(`
        ALTER TABLE ${this.tableName}
        ALTER COLUMN identifier SET NOT NULL;
      `);

      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "${this.idxStreamSequence}"
        ON ${this.tableName} (domain, identifier, sequence);
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS "${this.idxSnapshotKey}"
        ON ${this.tableName}_snapshots (domain, identifier);
      `);
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async reset(): Promise<void> {
    await this.pool.query(`TRUNCATE TABLE ${this.tableName}, ${this.tableName}_snapshots`);
  }

  private mapRowToEvent(row: any): PersistedEvent {
    return {
      id: row.id,
      domain: row.domain,
      type: row.type,
      meta: row.meta ?? undefined,
      payload: row.payload,
      identifier: row.identifier === '' ? undefined : row.identifier,
      correlationId: row.correlationid ?? undefined,
      causationId: row.causationid ?? undefined,
      sequence: row.sequence != null ? Number(row.sequence) : undefined,
      created: row.created instanceof Date ? row.created : new Date(row.created),
    };
  }

  private async getStreamVersion(
    client: PoolClient,
    domain: string,
    identifier: string,
    lock: boolean
  ): Promise<number> {
    const query = lock
      ? `SELECT COALESCE(MAX(sequence), 0) as "maxseq" FROM (
           SELECT sequence FROM ${this.tableName}
           WHERE domain = $1 AND identifier = $2
           FOR UPDATE
         ) locked`
      : `SELECT COALESCE(MAX(sequence), 0) as "maxseq"
         FROM ${this.tableName}
         WHERE domain = $1 AND identifier = $2`;
    const res = await client.query(query, [domain, identifier]);
    return Number(res.rows[0].maxseq);
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

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const versions = new Map<string, number>();
      for (const [streamKey, streamEvents] of this.groupEventsByStream(events).entries()) {
        const [domain, ...rest] = streamKey.split('::');
        const identifier = rest.join('::');
        const currentVersion = await this.getStreamVersion(client, domain, identifier, true);

        if (options?.expectedVersion !== undefined && currentVersion !== options.expectedVersion) {
          throw new StreamConcurrencyError(domain, identifier, options.expectedVersion, currentVersion);
        }

        let nextSequence = currentVersion + 1;
        for (const event of streamEvents) {
          await client.query(
            `INSERT INTO ${this.tableName}
             (id, domain, type, payload, meta, identifier, "correlationId", "causationId", sequence, created)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              event.id,
              event.domain,
              event.type,
              event.payload != null ? JSON.stringify(event.payload) : null,
              event.meta != null ? JSON.stringify(event.meta) : null,
              event.identifier ?? '',
              event.correlationId ?? null,
              event.causationId ?? null,
              nextSequence++,
              event.created,
            ]
          );
        }

        versions.set(streamKey, currentVersion + streamEvents.length);
      }

      await client.query('COMMIT');
      return versions;
    } catch (error: any) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback failures after transaction abort.
      }

      if (error?.code === '23505' && error?.constraint === this.idxStreamSequence && events[0]) {
        const identifier = events[0].identifier ?? '';
        const actualVersion = await this.getStreamVersion(client, events[0].domain, identifier, false);
        throw new StreamConcurrencyError(events[0].domain, identifier, options?.expectedVersion ?? 0, actualVersion);
      }

      throw error;
    } finally {
      client.release();
    }
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
    let currentStartId = startFromId;
    let hasMore = true;

    return {
      async next() {
        if (!hasMore) {
          return { value: undefined as any, done: true };
        }

        let res;
        if (currentStartId) {
          const cursorCheck = await self.pool.query(`SELECT created, id FROM ${self.tableName} WHERE id = $1`, [
            currentStartId,
          ]);
          if (cursorCheck.rows.length > 0) {
            const cursor = cursorCheck.rows[0];
            res = await self.pool.query(
              `SELECT * FROM ${self.tableName}
               WHERE (created, id) > ($1, $2)
               ORDER BY created ASC, id ASC
               LIMIT $3`,
              [cursor.created, cursor.id, pageSize]
            );
          } else {
            res = await self.pool.query(
              `SELECT * FROM ${self.tableName}
               WHERE id > $1
               ORDER BY created ASC, id ASC
               LIMIT $2`,
              [currentStartId, pageSize]
            );
          }
        } else {
          res = await self.pool.query(`SELECT * FROM ${self.tableName} ORDER BY created ASC, id ASC LIMIT $1`, [
            pageSize,
          ]);
        }

        if (res.rows.length === 0) {
          hasMore = false;
          return { value: undefined as any, done: true };
        }

        currentStartId = res.rows[res.rows.length - 1].id;
        if (res.rows.length < pageSize) {
          hasMore = false;
        }

        return { value: res.rows.map((row) => self.mapRowToEvent(row)), done: false };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  async getStreamEvents(domain: string, identifier: string, fromSequence: number = 0): Promise<PersistedEvent[]> {
    const res = await this.pool.query(
      `SELECT * FROM ${this.tableName}
       WHERE domain = $1 AND identifier = $2 AND sequence > $3
       ORDER BY sequence ASC`,
      [domain, identifier || '', fromSequence]
    );
    return res.rows.map((row) => this.mapRowToEvent(row));
  }

  async getSnapshot<State>(domain: string, identifier: string): Promise<Snapshot<State> | null> {
    const res = await this.pool.query(
      `SELECT domain, identifier, state, sequence, created
       FROM ${this.tableName}_snapshots
       WHERE domain = $1 AND identifier = $2`,
      [domain, identifier || '']
    );

    if (!res.rows.length) {
      return null;
    }

    const row = res.rows[0];
    return {
      domain: row.domain,
      identifier: row.identifier,
      state: row.state,
      sequence: Number(row.sequence),
      created: row.created instanceof Date ? row.created : new Date(row.created),
    } as Snapshot<State>;
  }

  async saveSnapshot<State>(snapshot: Snapshot<State>): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.tableName}_snapshots (domain, identifier, state, sequence, created)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (domain, identifier) DO UPDATE
       SET state = EXCLUDED.state,
           sequence = EXCLUDED.sequence,
           created = EXCLUDED.created`,
      [snapshot.domain, snapshot.identifier || '', snapshot.state, snapshot.sequence, snapshot.created]
    );
  }
}
