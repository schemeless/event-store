import {
    ConcurrencyError,
    CreatedEvent,
    IEventStoreEntity,
    IEventStoreRepo,
    IEventStoreRepoCapabilities,
    StoreEventsOptions,
} from '@schemeless/event-store-types';
import { createHash } from 'crypto';
import { Pool, PoolClient, PoolConfig } from 'pg';
import { logger } from './utils/logger';

export interface PgAdapterOptions extends PoolConfig {
    tableName?: string;
}

// Validates tableName to prevent SQL injection
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

    const hash = createHash('sha1')
        .update(tableName)
        .digest('hex')
        .slice(0, 10);
    const reservedLength = hash.length + suffix.length + 2; // "_" + hash + "_" + suffix
    const baseLength = Math.max(1, 63 - reservedLength);
    const truncatedBase = normalizedTableName.slice(0, baseLength);
    return `${truncatedBase}_${hash}_${suffix}`;
}

export class PgEventStoreRepo implements IEventStoreRepo {
    private pool: Pool;
    private tableName: string;
    private idxStreamSequence: string;
    private idxCausationId: string;

    capabilities: IEventStoreRepoCapabilities = {
        aggregate: true,
    };

    constructor(options: PgAdapterOptions) {
        const { tableName = 'event_store_entity', ...poolConfig } = options;
        assertValidTableName(tableName);
        this.pool = new Pool(poolConfig);
        this.tableName = tableName;
        // Derive index names from tableName to avoid collision when multiple tables coexist.
        // PostgreSQL identifiers are limited to 63 characters, so names must be length-safe.
        this.idxStreamSequence = buildIndexName(tableName, 'stream_sequence_idx');
        this.idxCausationId = buildIndexName(tableName, 'causation_id_idx');
    }

    async init() {
        const client = await this.pool.connect();
        try {
            await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          id VARCHAR(36) PRIMARY KEY,
          domain VARCHAR(15) NOT NULL,
          type VARCHAR(32) NOT NULL,
          meta JSONB,
          payload JSONB NOT NULL,
          identifier VARCHAR(64) NOT NULL DEFAULT '',
          "correlationId" VARCHAR(36),
          "causationId" VARCHAR(36),
          sequence INT,
          created TIMESTAMP(6) NOT NULL
        );
      `);

            await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "${this.idxStreamSequence}" 
        ON ${this.tableName} (domain, identifier, sequence);
      `);
            await client.query(`
        CREATE INDEX IF NOT EXISTS "${this.idxCausationId}" 
        ON ${this.tableName} ("causationId");
      `);

            // Migration safety check:
            // legacy tables may contain rows that only differ by NULL identifier.
            // Converting NULL -> '' would create collisions on (domain, identifier, sequence).
            const duplicateCheck = await client.query(
                `SELECT domain,
                        COALESCE(identifier, '') AS normalized_identifier,
                        sequence,
                        COUNT(*)::int AS duplicate_count
                 FROM ${this.tableName}
                 WHERE sequence IS NOT NULL
                 GROUP BY domain, COALESCE(identifier, ''), sequence
                 HAVING COUNT(*) > 1
                 LIMIT 1`
            );
            if (duplicateCheck.rows.length > 0) {
                const row = duplicateCheck.rows[0];
                throw new Error(
                    `Migration blocked for table "${this.tableName}": duplicate stream sequence rows detected for ` +
                    `(domain="${row.domain}", identifier="${row.normalized_identifier}", sequence=${row.sequence}, count=${row.duplicate_count}). ` +
                    `Please deduplicate data before init().`
                );
            }

            // Idempotent migration: backfill any legacy NULL identifiers
            // so the NOT NULL + unique index works correctly on pre-existing tables.
            await client.query(`
        UPDATE ${this.tableName} SET identifier = '' WHERE identifier IS NULL;
      `);
            await client.query(`
        ALTER TABLE ${this.tableName} ALTER COLUMN identifier SET DEFAULT '';
      `);
            await client.query(`
        ALTER TABLE ${this.tableName} ALTER COLUMN identifier SET NOT NULL;
      `);
        } finally {
            client.release();
        }
    }

    async close() {
        await this.pool.end();
    }

    /**
     * Maps a raw pg row (lowercase column names) to IEventStoreEntity (camelCase).
     * pg driver returns JSONB columns as already-parsed JS objects, no manual parse needed.
     */
    private mapRowToEntity(row: any): IEventStoreEntity {
        return {
            id: row.id,
            domain: row.domain,
            type: row.type,
            meta: row.meta ?? undefined,
            payload: row.payload,
            identifier: row.identifier === '' ? undefined : (row.identifier ?? undefined),
            correlationId: row.correlationid ?? undefined,  // pg returns lowercase
            causationId: row.causationid ?? undefined,      // pg returns lowercase
            sequence: row.sequence != null ? Number(row.sequence) : undefined,
            created: row.created,
        };
    }

    async getEventById(id: string): Promise<IEventStoreEntity | null> {
        const res = await this.pool.query(
            `SELECT * FROM ${this.tableName} WHERE id = $1`,
            [id]
        );
        return res.rows.length ? this.mapRowToEntity(res.rows[0]) : null;
    }

    async findByCausationId(causationId: string): Promise<IEventStoreEntity[]> {
        const res = await this.pool.query(
            `SELECT * FROM ${this.tableName} WHERE "causationId" = $1 ORDER BY created ASC, id ASC`,
            [causationId]
        );
        return res.rows.map(row => this.mapRowToEntity(row));
    }

    async getStreamSequence(domain: string, identifier: string): Promise<number> {
        const res = await this.pool.query(
            `SELECT COALESCE(MAX(sequence), 0) as "maxseq" FROM ${this.tableName} 
       WHERE domain = $1 AND identifier = $2`,
            [domain, identifier || '']
        );
        return Number(res.rows[0].maxseq);
    }

    async getStreamEvents(domain: string, identifier: string, fromSequence: number = 0): Promise<IEventStoreEntity[]> {
        const res = await this.pool.query(
            `SELECT * FROM ${this.tableName} 
       WHERE domain = $1 AND identifier = $2 AND sequence > $3
       ORDER BY sequence ASC`,
            [domain, identifier || '', fromSequence]
        );
        return res.rows.map(row => this.mapRowToEntity(row));
    }

    /**
     * Helper to get the current max sequence for a stream within a transaction.
     * Uses SELECT ... FOR UPDATE on the actual rows to acquire row-level locks,
     * preventing concurrent writers on the same stream from interleaving.
     */
    private async getStreamSequenceForUpdate(
        client: PoolClient,
        domain: string,
        identifier: string
    ): Promise<number> {
        const res = await client.query(
            `SELECT COALESCE(MAX(sequence), 0) as "maxseq" FROM (
         SELECT sequence FROM ${this.tableName}
         WHERE domain = $1 AND identifier = $2
         FOR UPDATE
       ) locked`,
            [domain, identifier]
        );
        return Number(res.rows[0].maxseq);
    }

    async storeEvents(events: CreatedEvent<any>[], options?: StoreEventsOptions): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            const streamGroups = new Map<string, CreatedEvent<any>[]>();
            for (const event of events) {
                const key = `${event.domain}::${event.identifier ?? ''}`;
                if (!streamGroups.has(key)) streamGroups.set(key, []);
                streamGroups.get(key)!.push(event);
            }

            for (const [streamKey, streamEvents] of streamGroups.entries()) {
                const [domain, ...rest] = streamKey.split('::');
                const identifier = rest.join('::') || '';

                const currentSequence = await this.getStreamSequenceForUpdate(client, domain, identifier);

                if (options?.expectedSequence !== undefined && currentSequence !== options.expectedSequence) {
                    throw new ConcurrencyError(streamKey, options.expectedSequence, currentSequence);
                }

                let nextSequence = currentSequence + 1;
                for (const event of streamEvents) {
                    const { id, domain: d, type, payload, meta, created, correlationId, causationId, identifier: ident } = event;
                    try {
                        await client.query(
                            `INSERT INTO ${this.tableName} 
               (id, domain, type, payload, meta, identifier, "correlationId", "causationId", sequence, created)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                            [
                                id, d, type,
                                payload != null ? JSON.stringify(payload) : null,
                                meta != null ? JSON.stringify(meta) : null,
                                ident ?? '',
                                correlationId ?? null,
                                causationId ?? null,
                                nextSequence++,
                                created,
                            ]
                        );
                    } catch (err: any) {
                        if (err.code === '23505' && err.constraint === this.idxStreamSequence) {
                            const actualSequence = await this.getStreamSequenceForUpdate(client, domain, identifier);
                            throw new ConcurrencyError(streamKey, currentSequence, actualSequence);
                        }
                        throw err;
                    }
                }
            }

            await client.query('COMMIT');
        } catch (err) {
            try {
                await client.query('ROLLBACK');
            } catch {
                // Ignore rollback errors after a failed transaction
            }
            throw err;
        } finally {
            client.release();
        }
    }

    async getAllEvents(
        pageSize: number = 100,
        startFromId?: string
    ): Promise<AsyncIterableIterator<Array<IEventStoreEntity>>> {
        const self = this;
        let currentStartId = startFromId;
        let hasMore = true;

        return {
            async next() {
                if (!hasMore) return { value: undefined as any, done: true };

                let res;
                if (currentStartId) {
                    // Try cursor-based pagination using row-value comparison.
                    // If the cursor ID doesn't exist (e.g. checkpoint was cleaned up),
                    // the subquery returns NULL and (created, id) > NULL yields no rows.
                    // Detect this and fall back to lexicographic id comparison,
                    // matching TypeORM/Prisma MoreThan(id) semantics.
                    const cursorCheck = await self.pool.query(
                        `SELECT created, id FROM ${self.tableName} WHERE id = $1`,
                        [currentStartId]
                    );
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
                        // Cursor ID not found — fall back to id > startFromId
                        // This matches TypeORM MoreThan(startFromId) behavior
                        res = await self.pool.query(
                            `SELECT * FROM ${self.tableName}
               WHERE id > $1
               ORDER BY created ASC, id ASC
               LIMIT $2`,
                            [currentStartId, pageSize]
                        );
                    }
                } else {
                    res = await self.pool.query(
                        `SELECT * FROM ${self.tableName} ORDER BY created ASC, id ASC LIMIT $1`,
                        [pageSize]
                    );
                }

                if (res.rows.length === 0) {
                    hasMore = false;
                    return { value: undefined as any, done: true };
                }

                currentStartId = res.rows[res.rows.length - 1].id;
                if (res.rows.length < pageSize) {
                    hasMore = false;
                }

                return {
                    value: res.rows.map(row => self.mapRowToEntity(row)),
                    done: false,
                };
            },
            [Symbol.asyncIterator]() {
                return this;
            },
        };
    }

    async resetStore() {
        await this.pool.query(`TRUNCATE TABLE ${this.tableName}`);
        logger.info('Event Store reset (truncated)');
    }

    createEventEntity(event: CreatedEvent<any>): IEventStoreEntity {
        return {
            ...event,
            sequence: undefined,
        };
    }
}
