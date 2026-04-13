import { createHash } from 'crypto';
import { Pool, PoolClient, PoolConfig } from 'pg';
import { monotonicFactory } from 'ulid';
import {
  AppendableEvent,
  EventCursorNotFoundError,
  InvalidIdentifierError,
  InvalidStreamBatchError,
  PersistedEvent,
  Snapshot,
  StreamConcurrencyError,
  StreamAppendableEvent,
  StreamEventStoreAdapter,
} from '@schemeless/event-store-types';

export interface PgAdapterOptions extends PoolConfig {
  tableName?: string;
}

const VALID_TABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;
const monotonicUlid = monotonicFactory();

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
  private readonly snapshotTableName: string;
  private readonly eventPositionSequence: string;
  private readonly idxStreamSequence: string;
  private readonly idxSnapshotKey: string;
  private readonly idxEventPosition: string;

  constructor(options: PgAdapterOptions) {
    const { tableName = 'event_store_entity', ...poolConfig } = options;
    assertValidTableName(tableName);
    this.pool = new Pool(poolConfig);
    this.tableName = tableName;
    this.snapshotTableName = `${tableName}_snapshots`;
    this.eventPositionSequence = buildIndexName(tableName, 'position_seq');
    this.idxStreamSequence = buildIndexName(tableName, 'stream_sequence_idx');
    this.idxSnapshotKey = buildIndexName(tableName, 'snapshot_key_idx');
    this.idxEventPosition = buildIndexName(tableName, 'position_idx');
  }

  async init(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE SEQUENCE IF NOT EXISTS "${this.eventPositionSequence}";
      `);

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
          position BIGINT NOT NULL DEFAULT nextval('"${this.eventPositionSequence}"'),
          created TIMESTAMP(6) NOT NULL
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.snapshotTableName} (
          domain VARCHAR(64) NOT NULL,
          identifier VARCHAR(255) NOT NULL DEFAULT '',
          state JSONB NOT NULL,
          sequence INT NOT NULL,
          created TIMESTAMP(6) NOT NULL,
          PRIMARY KEY (domain, identifier)
        );
      `);

      await client.query(`
        ALTER TABLE ${this.tableName}
        ADD COLUMN IF NOT EXISTS position BIGINT;
      `);
      await client.query(`
        ALTER TABLE ${this.tableName}
        ALTER COLUMN position SET DEFAULT nextval('"${this.eventPositionSequence}"');
      `);
      await client.query(`
        ALTER SEQUENCE "${this.eventPositionSequence}"
        OWNED BY ${this.tableName}.position;
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
        WITH ordered AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY created ASC, id ASC) AS next_position
          FROM ${this.tableName}
          WHERE position IS NULL
        )
        UPDATE ${this.tableName} target
        SET position = ordered.next_position
        FROM ordered
        WHERE target.id = ordered.id;
      `);
      const maxPositionResult = await client.query(`
        SELECT COALESCE(MAX(position), 0) AS "maxPosition"
        FROM ${this.tableName};
      `);
      const maxPosition = Number(maxPositionResult.rows[0].maxPosition);
      await client.query(`SELECT setval($1::regclass, $2, $3)`, [
        this.eventPositionSequence,
        Math.max(maxPosition, 1),
        maxPosition > 0,
      ]);
      await client.query(`
        ALTER TABLE ${this.tableName}
        ALTER COLUMN position SET NOT NULL;
      `);

      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "${this.idxStreamSequence}"
        ON ${this.tableName} (domain, identifier, sequence);
      `);

      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "${this.idxEventPosition}"
        ON ${this.tableName} (position);
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS "${this.idxSnapshotKey}"
        ON ${this.snapshotTableName} (domain, identifier);
      `);
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async reset(): Promise<void> {
    await this.pool.query(`TRUNCATE TABLE ${this.tableName}, ${this.snapshotTableName} RESTART IDENTITY`);
  }

  private mapRowToEvent(row: any): PersistedEvent {
    return {
      id: row.id,
      domain: row.domain,
      type: row.type,
      meta: row.meta ?? undefined,
      payload: row.payload,
      identifier: row.identifier === '' ? undefined : row.identifier,
      correlationId: row.correlationId ?? undefined,
      causationId: row.causationId ?? undefined,
      sequence: row.sequence != null ? Number(row.sequence) : undefined,
      created: row.created instanceof Date ? row.created : new Date(row.created),
    };
  }

  private normalizeOptionalIdentifier(identifier: string | undefined, context: string): string {
    if (identifier == null) {
      return '';
    }
    if (identifier.trim().length === 0) {
      throw new InvalidIdentifierError(`${context} requires a non-empty identifier`);
    }
    return identifier;
  }

  private assertStreamIdentifier(identifier: string, context: string): string {
    return this.normalizeOptionalIdentifier(identifier, context);
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

  private groupEventsByStream(
    events: Array<PersistedEvent & { identifier: string }>
  ): Map<string, Array<PersistedEvent & { identifier: string }>> {
    const grouped = new Map<string, Array<PersistedEvent & { identifier: string }>>();
    for (const event of events) {
      const key = `${event.domain}::${event.identifier}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(event);
    }
    return grouped;
  }

  private async appendGroupedEvents(
    events: AppendableEvent[],
    options?: { expectedVersion?: number }
  ): Promise<Map<string, number>> {
    if (!events.length) {
      return new Map();
    }

    const eventsWithIds = this.ensureEventIds(events);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const versions = new Map<string, number>();
      for (const [streamKey, streamEvents] of this.groupEventsByStream(eventsWithIds).entries()) {
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

      if (error?.code === '23505' && error?.constraint === this.idxStreamSequence && eventsWithIds[0]) {
        const identifier = eventsWithIds[0].identifier ?? '';
        const actualVersion = await this.getStreamVersion(client, eventsWithIds[0].domain, identifier, false);
        throw new StreamConcurrencyError(
          eventsWithIds[0].domain,
          identifier,
          options?.expectedVersion ?? 0,
          actualVersion
        );
      }

      throw error;
    } finally {
      client.release();
    }
  }

  async append(events: AppendableEvent[]): Promise<void> {
    await this.appendGroupedEvents(events);
  }

  async appendToStream(events: StreamAppendableEvent[], expectedVersion: number): Promise<{ nextVersion: number }> {
    if (!events.length) {
      return { nextVersion: expectedVersion };
    }

    const first = this.assertSingleStream(
      events.map((event) => ({
        domain: event.domain,
        identifier: this.assertStreamIdentifier(event.identifier, 'appendToStream'),
      }))
    );
    const versions = await this.appendGroupedEvents(events, { expectedVersion });
    const key = `${first.domain}::${first.identifier}`;
    return { nextVersion: versions.get(key) ?? expectedVersion };
  }

  async getAllEvents(
    pageSize: number = 100,
    startFromId?: string
  ): Promise<AsyncIterableIterator<Array<PersistedEvent>>> {
    const self = this;
    let currentPosition: number | null = null;
    let hasMore = true;

    if (startFromId) {
      const cursorCheck = await this.pool.query(`SELECT position FROM ${this.tableName} WHERE id = $1`, [startFromId]);
      if (cursorCheck.rows.length === 0) {
        throw new EventCursorNotFoundError(startFromId);
      }
      currentPosition = Number(cursorCheck.rows[0].position);
    }

    return {
      async next() {
        if (!hasMore) {
          return { value: undefined as any, done: true };
        }

        let res;
        if (currentPosition != null) {
          res = await self.pool.query(
            `SELECT * FROM ${self.tableName}
             WHERE position > $1
             ORDER BY position ASC
             LIMIT $2`,
            [currentPosition, pageSize]
          );
        } else {
          res = await self.pool.query(`SELECT * FROM ${self.tableName} ORDER BY position ASC LIMIT $1`, [pageSize]);
        }

        if (res.rows.length === 0) {
          hasMore = false;
          return { value: undefined as any, done: true };
        }

        currentPosition = Number(res.rows[res.rows.length - 1].position);
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

  async getEventById(id: string): Promise<PersistedEvent | null> {
    const res = await this.pool.query(`SELECT * FROM ${this.tableName} WHERE id = $1`, [id]);
    if (!res.rows.length) return null;
    return this.mapRowToEvent(res.rows[0]);
  }

  async findByCausationId(causationId: string): Promise<PersistedEvent[]> {
    const res = await this.pool.query(
      `SELECT * FROM ${this.tableName} WHERE "causationId" = $1 ORDER BY position ASC`,
      [causationId]
    );
    return res.rows.map((row) => this.mapRowToEvent(row));
  }

  async getStreamEvents(domain: string, identifier: string, fromSequence: number = 0): Promise<PersistedEvent[]> {
    const canonicalIdentifier = this.assertStreamIdentifier(identifier, 'getStreamEvents');
    const res = await this.pool.query(
      `SELECT * FROM ${this.tableName}
       WHERE domain = $1 AND identifier = $2 AND sequence > $3
       ORDER BY sequence ASC`,
      [domain, canonicalIdentifier, fromSequence]
    );
    return res.rows.map((row) => this.mapRowToEvent(row));
  }

  async getSnapshot<State>(domain: string, identifier: string): Promise<Snapshot<State> | null> {
    const canonicalIdentifier = this.assertStreamIdentifier(identifier, 'getSnapshot');
    const res = await this.pool.query(
      `SELECT domain, identifier, state, sequence, created
       FROM ${this.snapshotTableName}
       WHERE domain = $1 AND identifier = $2`,
      [domain, canonicalIdentifier]
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
    const identifier = this.assertStreamIdentifier(snapshot.identifier, 'saveSnapshot');
    await this.pool.query(
      `INSERT INTO ${this.snapshotTableName} (domain, identifier, state, sequence, created)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (domain, identifier) DO UPDATE
       SET state = EXCLUDED.state,
           sequence = EXCLUDED.sequence,
           created = EXCLUDED.created`,
      [snapshot.domain, identifier, snapshot.state, snapshot.sequence, snapshot.created]
    );
  }
}
