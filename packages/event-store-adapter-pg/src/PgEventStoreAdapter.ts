import { createHash } from 'crypto';
import { Pool, PoolClient, PoolConfig, QueryResult } from 'pg';
import { monotonicFactory } from 'ulid';
import {
  AppendableEvent,
  BatchEventStoreAdapter,
  DuplicateEventError,
  ExpectedStreamVersion,
  IncrementalEventStoreAdapter,
  StreamLogPage,
  TransactionScopeError,
  EventCursorNotFoundError,
  InvalidIdentifierError,
  InvalidStreamBatchError,
  PersistedEvent,
  Snapshot,
  StreamConcurrencyError,
  StreamAppendableEvent,
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

export class PgEventStoreAdapter implements BatchEventStoreAdapter, IncrementalEventStoreAdapter {
  private readonly pool: Pool;
  private scope?: { client: PoolClient; active: boolean; failure?: unknown; appended: boolean; pending: number };

  private assertActive(): void {
    if (this.scope && (!this.scope.active || this.scope.failure)) {
      throw new TransactionScopeError('Transaction scope has ended or failed');
    }
  }

  private assertRoot(operation: string): void {
    if (this.scope) throw new TransactionScopeError(`${operation} is not allowed on a transaction scope`);
  }

  private async query(sql: string, values?: any[]): Promise<QueryResult> {
    this.assertActive();
    if (this.scope) this.scope.pending++;
    try {
      return await (this.scope ? this.scope.client : this.pool).query(sql, values);
    } catch (error) {
      if (this.scope) this.scope.failure = error;
      throw error;
    } finally {
      if (this.scope) this.scope.pending--;
    }
  }

  /** The callback must await every operation. Nested transactions are rejected. */
  async withTransaction<T>(task: (adapter: PgTransactionAdapter) => Promise<T>): Promise<T> {
    this.assertRoot('Nested transactions');
    const client = await this.pool.connect();
    let discardClient = false;
    const scoped: PgEventStoreAdapter = Object.create(this);
    scoped.scope = { client, active: true, appended: false, pending: 0 };
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const result = await task(scoped);
      scoped.assertActive();
      if (scoped.scope.pending) throw new TransactionScopeError('Await every transaction operation before returning');
      scoped.scope.active = false;
      await client.query('COMMIT');
      return result;
    } catch (error) {
      scoped.scope.active = false;
      try {
        await client.query('ROLLBACK');
      } catch {
        discardClient = true;
      }
      throw error;
    } finally {
      scoped.scope.active = false;
      client.release(discardClient);
    }
  }

  /** Parameterized consumer SQL on the transaction connection only. */
  async execute(sql: string, values?: any[]): Promise<QueryResult> {
    this.assertActive();
    if (!this.scope) throw new TransactionScopeError('execute requires withTransaction');
    // Consumer SQL is trusted, but transaction ownership must stay with the adapter.
    // Accept one DML statement; use parameters for values (including semicolons).
    if (!/^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(sql) || sql.includes(';')) {
      const error = new TransactionScopeError('execute accepts one SELECT/INSERT/UPDATE/DELETE/WITH statement');
      this.scope.failure = error;
      throw error;
    }
    return this.query(sql, values);
  }

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
    this.assertRoot('init');
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
    this.assertRoot('close');
    await this.pool.end();
  }

  async reset(): Promise<void> {
    this.assertRoot('reset');
    await this.query(`TRUNCATE TABLE ${this.tableName}, ${this.snapshotTableName} RESTART IDENTITY`);
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

  private streamKey(stream: { domain: string; identifier?: string }): string {
    return JSON.stringify([stream.domain, stream.identifier ?? '']);
  }

  private validateVersions(expected: readonly ExpectedStreamVersion[]): Map<string, ExpectedStreamVersion> {
    const versions = new Map<string, ExpectedStreamVersion>();
    for (const stream of expected) {
      this.normalizeOptionalIdentifier(stream.identifier, 'Expected stream');
      if (!Number.isSafeInteger(stream.expectedVersion) || stream.expectedVersion < 0) {
        throw new InvalidStreamBatchError('Expected versions must be non-negative safe integers');
      }
      const key = this.streamKey(stream);
      if (versions.has(key)) throw new InvalidStreamBatchError('Duplicate expected stream version');
      versions.set(key, stream);
    }
    return versions;
  }

  async getStreamVersions(
    streams: readonly Pick<ExpectedStreamVersion, 'domain' | 'identifier'>[]
  ): Promise<ExpectedStreamVersion[]> {
    this.assertActive();
    const input = streams.map((stream) => ({
      domain: stream.domain,
      identifier: this.normalizeOptionalIdentifier(stream.identifier, 'getStreamVersions'),
    }));
    const res = await this.query(
      `SELECT requested.domain, requested.identifier, COALESCE(MAX(events.sequence), 0) AS version
       FROM jsonb_to_recordset($1::jsonb) AS requested(domain text, identifier text)
       LEFT JOIN ${this.tableName} events
       ON events.domain = requested.domain AND events.identifier = requested.identifier
       GROUP BY requested.domain, requested.identifier`,
      [JSON.stringify(input)]
    );
    return res.rows.map((row) => ({
      domain: row.domain,
      identifier: row.identifier || undefined,
      expectedVersion: Number(row.version),
    }));
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

  private async appendEvents(events: AppendableEvent[], expected?: readonly ExpectedStreamVersion[]): Promise<void> {
    this.assertActive();
    if (!this.scope) {
      return this.withTransaction((scoped) => (scoped as PgEventStoreAdapter).appendEvents(events, expected));
    }
    try {
      if (this.scope.appended) throw new TransactionScopeError('Use one append batch per transaction');
      this.scope.appended = true;
      const versions = expected === undefined ? undefined : this.validateVersions(expected);
      const prepared = this.ensureEventIds(events);
      const streams = new Map<string, { domain: string; identifier?: string }>();
      for (const event of prepared) {
        const key = this.streamKey(event);
        if (versions && !versions.has(key))
          throw new InvalidStreamBatchError('Every written stream needs an expected version');
        streams.set(key, { domain: event.domain, identifier: event.identifier || undefined });
      }
      if (versions) for (const [key, stream] of versions) streams.set(key, stream);

      // Relation OID makes qualified/unqualified names of the same table share locks.
      const relation = await this.query('SELECT $1::regclass::oid AS oid', [this.tableName]);
      const locks = [...streams.keys()]
        .map((key) => {
          const hex = createHash('sha256').update(`${relation.rows[0].oid}:${key}`).digest('hex').slice(0, 16);
          return hex;
        })
        .sort();
      // Sort actual lock keys, including rare hash collisions, before taking any lock.
      for (const lock of new Set(locks))
        await this.query("SELECT pg_advisory_xact_lock(('x' || $1)::bit(64)::bigint)", [lock]);
      const current = new Map(
        (await this.getStreamVersions([...streams.values()])).map((stream) => [
          this.streamKey(stream),
          stream.expectedVersion,
        ])
      );
      if (versions)
        for (const [key, stream] of versions) {
          const actual = current.get(key)!;
          if (actual !== stream.expectedVersion) {
            throw new StreamConcurrencyError(stream.domain, stream.identifier ?? '', stream.expectedVersion, actual);
          }
        }
      // Insert in caller order, not grouped order; sequence advances independently per stream.
      for (const event of prepared) {
        const key = this.streamKey(event);
        const sequence = current.get(key)! + 1;
        try {
          const inserted = await this.query(
            `INSERT INTO ${this.tableName}
             (id, domain, type, payload, meta, identifier, "correlationId", "causationId", sequence, created)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (id) DO NOTHING RETURNING id`,
            [
              event.id,
              event.domain,
              event.type,
              event.payload != null ? JSON.stringify(event.payload) : null,
              event.meta != null ? JSON.stringify(event.meta) : null,
              event.identifier,
              event.correlationId ?? null,
              event.causationId ?? null,
              sequence,
              event.created,
            ]
          );
          if (!inserted.rowCount) throw new DuplicateEventError(event.id);
        } catch (error: any) {
          if (error.code === '23505' && error.constraint === this.idxStreamSequence) {
            throw new StreamConcurrencyError(
              event.domain,
              event.identifier,
              versions?.get(key)?.expectedVersion ?? sequence - 1,
              sequence
            );
          }
          throw error;
        }
        current.set(key, sequence);
      }
    } catch (error) {
      this.scope.failure = error;
      throw error;
    }
  }

  async append(events: AppendableEvent[]): Promise<void> {
    this.assertActive();
    if (!events.length) return;
    await this.appendEvents(events);
  }

  async appendBatch(events: AppendableEvent[], expectedVersions: readonly ExpectedStreamVersion[]): Promise<void> {
    await this.appendEvents(events, expectedVersions);
  }

  async appendToStream(events: StreamAppendableEvent[], expectedVersion: number): Promise<{ nextVersion: number }> {
    this.assertActive();
    try {
      this.validateVersions([{ domain: events[0]?.domain ?? '', identifier: events[0]?.identifier, expectedVersion }]);
      if (!events.length) return { nextVersion: expectedVersion };
      const first = this.assertSingleStream(
        events.map((event) => ({
          domain: event.domain,
          identifier: this.normalizeOptionalIdentifier(event.identifier, 'appendToStream'),
        }))
      );
      await this.appendBatch(events, [{ ...first, expectedVersion }]);
      return { nextVersion: expectedVersion + events.length };
    } catch (error) {
      if (this.scope) this.scope.failure = error;
      throw error;
    }
  }

  /** No commit-order promise: a stream vector cannot skip late commits on other streams. */
  async getLogPage(cursor: readonly ExpectedStreamVersion[] = [], pageSize: number = 100): Promise<StreamLogPage> {
    this.assertActive();
    // ponytail: checkpoint size grows with stream count; use CDC for large/unbounded logs.
    const versions = this.validateVersions(cursor);
    if (!Number.isSafeInteger(pageSize) || pageSize <= 0)
      throw new InvalidStreamBatchError('pageSize must be a positive safe integer');
    const res = await this.query(
      `WITH checkpoint AS (
         SELECT * FROM jsonb_to_recordset($1::jsonb) AS c(domain text, identifier text, "expectedVersion" bigint)
       )
       SELECT events.* FROM ${this.tableName} events
       LEFT JOIN checkpoint c ON c.domain = events.domain AND c.identifier = events.identifier
       WHERE events.sequence > COALESCE(c."expectedVersion", 0) OR events.sequence IS NULL
       ORDER BY events.position ASC LIMIT $2`,
      [JSON.stringify(cursor.map((stream) => ({ ...stream, identifier: stream.identifier ?? '' }))), pageSize]
    );
    if (res.rows.some((row) => row.sequence == null)) {
      throw new InvalidStreamBatchError(
        'Incremental log requires sequenced V6 events; use an offline export for legacy rows'
      );
    }
    for (const row of res.rows)
      versions.set(this.streamKey(row), {
        domain: row.domain,
        identifier: row.identifier || undefined,
        expectedVersion: Number(row.sequence),
      });
    return { events: res.rows.map((row) => this.mapRowToEvent(row)), cursor: [...versions.values()] };
  }

  async getAllEvents(
    pageSize: number = 100,
    startFromId?: string
  ): Promise<AsyncIterableIterator<Array<PersistedEvent>>> {
    this.assertActive();
    const self = this;
    let currentPosition: string | null = null;
    let hasMore = true;

    if (startFromId) {
      const cursorCheck = await this.query(`SELECT position FROM ${this.tableName} WHERE id = $1`, [startFromId]);
      if (cursorCheck.rows.length === 0) {
        throw new EventCursorNotFoundError(startFromId);
      }
      currentPosition = String(cursorCheck.rows[0].position);
    }

    return {
      async next() {
        self.assertActive();
        if (!hasMore) {
          return { value: undefined as any, done: true };
        }

        let res;
        if (currentPosition != null) {
          res = await self.query(
            `SELECT * FROM ${self.tableName}
             WHERE position > $1
             ORDER BY position ASC
             LIMIT $2`,
            [currentPosition, pageSize]
          );
        } else {
          res = await self.query(`SELECT * FROM ${self.tableName} ORDER BY position ASC LIMIT $1`, [pageSize]);
        }

        if (res.rows.length === 0) {
          hasMore = false;
          return { value: undefined as any, done: true };
        }

        currentPosition = String(res.rows[res.rows.length - 1].position);
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
    const res = await this.query(`SELECT * FROM ${this.tableName} WHERE id = $1`, [id]);
    if (!res.rows.length) return null;
    return this.mapRowToEvent(res.rows[0]);
  }

  async findByCausationId(causationId: string): Promise<PersistedEvent[]> {
    const res = await this.query(`SELECT * FROM ${this.tableName} WHERE "causationId" = $1 ORDER BY position ASC`, [
      causationId,
    ]);
    return res.rows.map((row) => this.mapRowToEvent(row));
  }

  async getStreamEvents(domain: string, identifier: string, fromSequence: number = 0): Promise<PersistedEvent[]> {
    const canonicalIdentifier = this.normalizeOptionalIdentifier(identifier, 'getStreamEvents');
    const res = await this.query(
      `SELECT * FROM ${this.tableName}
       WHERE domain = $1 AND identifier = $2 AND sequence > $3
       ORDER BY sequence ASC`,
      [domain, canonicalIdentifier, fromSequence]
    );
    return res.rows.map((row) => this.mapRowToEvent(row));
  }

  async getSnapshot<State>(domain: string, identifier: string): Promise<Snapshot<State> | null> {
    const canonicalIdentifier = this.normalizeOptionalIdentifier(identifier, 'getSnapshot');
    const res = await this.query(
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
    const identifier = this.normalizeOptionalIdentifier(snapshot.identifier, 'saveSnapshot');
    await this.query(
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

/** Only transaction-safe operations are exposed in the callback type. */
export type PgTransactionAdapter = Pick<
  PgEventStoreAdapter,
  | 'append'
  | 'appendBatch'
  | 'appendToStream'
  | 'getStreamVersions'
  | 'getLogPage'
  | 'getAllEvents'
  | 'getEventById'
  | 'findByCausationId'
  | 'getStreamEvents'
  | 'getSnapshot'
  | 'saveSnapshot'
  | 'execute'
>;
