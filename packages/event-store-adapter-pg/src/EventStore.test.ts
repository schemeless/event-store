import { PgEventStoreRepo } from './PgEventStore.repo';
import { ConcurrencyError, CreatedEvent } from '@schemeless/event-store-types';

const connectionOptions = {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432', 10),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'event_store_test',
};

const makeEvent = (num: number): CreatedEvent<any, any> => {
    const d = new Date(Date.now() + num * 1000);
    return {
        id: `event-${num.toString().padStart(6, '0')}`,
        domain: 'test',
        type: 'test',
        payload: { id: num },
        created: d,
    };
};

const makeEventWithIdentifier = (num: number, identifier: string): CreatedEvent<any, any> => {
    const d = new Date(Date.now() + num * 1000);
    return {
        id: `event-${identifier}-${num}`,
        domain: 'test',
        type: 'test',
        payload: { id: num },
        identifier,
        created: d,
    };
};

describe('PgEventStoreRepo', () => {
    let repo: PgEventStoreRepo;

    beforeAll(async () => {
        repo = new PgEventStoreRepo({
            ...connectionOptions,
        });
        await repo.init();
    });

    afterAll(async () => {
        await repo.close();
    });

    beforeEach(async () => {
        await repo.resetStore();
    });

    it('should store and retrieve 500 events', async () => {
        const eventsToStore = [...new Array(500).keys()].map(makeEvent);
        await repo.storeEvents(eventsToStore);

        const pages = await repo.getAllEvents(100);
        let allEvents: any[] = [];
        for await (const events of pages) {
            allEvents = allEvents.concat(events);
        }

        expect(allEvents.length).toBe(500);
        const rightOrder = allEvents.every((currentEvent, index) => {
            const nextEvent = allEvents[index + 1];
            if (!nextEvent) return true;
            return nextEvent.created >= currentEvent.created;
        });
        expect(rightOrder).toBe(true);
    }, 10000);

    it('should handle pagination (replay after)', async () => {
        const eventsToStore = [...new Array(500).keys()].map(makeEvent);
        await repo.storeEvents(eventsToStore);

        let allEvents: any[] = [];
        const firstPages = await repo.getAllEvents(100);
        for await (const events of firstPages) {
            allEvents = allEvents.concat(events);
        }

        const stopped = allEvents[199];
        const remainingPages = await repo.getAllEvents(100, stopped.id);
        let remainingEvents: any[] = [];
        for await (const events of remainingPages) {
            remainingEvents = remainingEvents.concat(events);
        }

        expect(remainingEvents.length).toBe(300);
        // String IDs are ordered lexicographically, which matches our zero-padded IDs
        expect(remainingEvents[0].id > stopped.id).toBe(true);
    });

    describe('OCC - Optimistic Concurrency Control', () => {
        it('should assign sequence numbers to events', async () => {
            const events = [
                makeEventWithIdentifier(1, 'user-123'),
                makeEventWithIdentifier(2, 'user-123'),
            ];
            await repo.storeEvents(events);

            const seq = await repo.getStreamSequence('test', 'user-123');
            expect(seq).toBe(2);
        });

        it('should throw ConcurrencyError on sequence mismatch', async () => {
            await repo.storeEvents([makeEventWithIdentifier(1, 'user-123')]);

            await expect(
                repo.storeEvents([makeEventWithIdentifier(2, 'user-123')], { expectedSequence: 0 })
            ).rejects.toThrow(ConcurrencyError);
        });

        it('should succeed when expectedSequence matches', async () => {
            await repo.storeEvents([makeEventWithIdentifier(1, 'user-123')]);

            await expect(
                repo.storeEvents([makeEventWithIdentifier(2, 'user-123')], { expectedSequence: 1 })
            ).resolves.not.toThrow();

            const seq = await repo.getStreamSequence('test', 'user-123');
            expect(seq).toBe(2);
        });

        it('should handle independent streams correctly', async () => {
            await repo.storeEvents([makeEventWithIdentifier(1, 'user-A')]);
            await repo.storeEvents([makeEventWithIdentifier(1, 'user-B')]);

            expect(await repo.getStreamSequence('test', 'user-A')).toBe(1);
            expect(await repo.getStreamSequence('test', 'user-B')).toBe(1);

            await repo.storeEvents([makeEventWithIdentifier(2, 'user-A')], { expectedSequence: 1 });

            expect(await repo.getStreamSequence('test', 'user-A')).toBe(2);
            expect(await repo.getStreamSequence('test', 'user-B')).toBe(1);
        });
    });

    describe('NULL identifier handling', () => {
        it('should correctly sequence events without identifier', async () => {
            const event1: CreatedEvent<any> = {
                id: 'no-ident-1',
                domain: 'test',
                type: 'test',
                payload: { n: 1 },
                created: new Date(),
            };
            const event2: CreatedEvent<any> = {
                id: 'no-ident-2',
                domain: 'test',
                type: 'test',
                payload: { n: 2 },
                created: new Date(),
            };

            await repo.storeEvents([event1]);
            await repo.storeEvents([event2]);

            // Both belong to stream (test, ''), so sequence should be 2
            const seq = await repo.getStreamSequence('test', '');
            expect(seq).toBe(2);
        });

        it('should enforce OCC on NULL identifier streams', async () => {
            const event1: CreatedEvent<any> = {
                id: 'null-occ-1',
                domain: 'test',
                type: 'test',
                payload: {},
                created: new Date(),
            };
            await repo.storeEvents([event1]);

            const event2: CreatedEvent<any> = {
                id: 'null-occ-2',
                domain: 'test',
                type: 'test',
                payload: {},
                created: new Date(),
            };
            // expectedSequence 0 should fail since current is 1
            await expect(
                repo.storeEvents([event2], { expectedSequence: 0 })
            ).rejects.toThrow(ConcurrencyError);
        });
    });

    it('should store and retrieve meta and payload as JSONB', async () => {
        const event = makeEvent(1);
        event.meta = { custom: 'data', version: 2 };
        event.payload = { nested: { value: true }, tags: ['a', 'b'] };

        await repo.storeEvents([event]);
        const stored = await repo.getEventById(event.id);

        expect(stored?.meta).toEqual(event.meta);
        expect(stored?.payload).toEqual(event.payload);
    });

    it('should reject invalid table names', () => {
        expect(() => new PgEventStoreRepo({
            ...connectionOptions,
            tableName: 'DROP TABLE foo; --',
        })).toThrow(/Invalid table name/);
    });
});
