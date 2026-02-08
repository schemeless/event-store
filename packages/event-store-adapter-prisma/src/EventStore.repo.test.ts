import * as path from 'path';
import { promises as fs } from 'fs';

import { PrismaClient } from '@prisma/client';
import type { CreatedEvent, IEventStoreEntity } from '@schemeless/event-store-types';

import { EventStoreRepo } from './EventStore.repo';

const packageRoot = path.resolve(__dirname, '..');
const databaseFile = path.join(packageRoot, 'prisma', 'test.db');
const databaseUrl = `file:${databaseFile}`;

const ensureSchema = async (prisma: PrismaClient): Promise<void> => {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "EventStoreEntity" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "domain" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "meta" TEXT,
      "payload" TEXT NOT NULL,
      "identifier" TEXT,
      "correlationId" TEXT,
      "causationId" TEXT,
      "created" DATETIME NOT NULL
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "EventStoreEntity_created_id_idx"
      ON "EventStoreEntity" ("created", "id")
  `);
};

const makeEvent = (index: number): CreatedEvent<any, any> => ({
  id: `event-${index.toString().padStart(6, '0')}`,
  domain: 'test',
  type: 'test',
  payload: { id: index },
  meta: { index },
  created: new Date(Date.now() + index * 1000),
});

describe('EventStoreRepo (Prisma)', () => {
  let prisma: PrismaClient;
  let repo: EventStoreRepo;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: {
        db: { url: databaseUrl },
      },
    });
    await prisma.$connect();
    await ensureSchema(prisma);
    repo = new EventStoreRepo(prisma);
    await repo.init();
  });

  beforeEach(async () => {
    if (!repo) {
      throw new Error('Prisma test setup failed: repository was not initialized');
    }
    await repo.resetStore();
  });

  afterAll(async () => {
    if (repo) {
      await repo.resetStore();
    }
    if (prisma) {
      await prisma.$disconnect();
    }
    await fs.rm(databaseFile, { force: true });
  });

  it('creates a Prisma data payload from a created event', () => {
    const created: CreatedEvent<any, any> = {
      id: 'event-1',
      domain: 'test',
      type: 'created',
      payload: { foo: 'bar' },
      meta: { requestId: '123' },
      identifier: 'user-1',
      correlationId: 'corr-1',
      causationId: 'cause-1',
      created: new Date(),
    };

    const entity = repo.createEventEntity(created);

    expect(entity).toMatchObject({
      id: created.id,
      domain: created.domain,
      type: created.type,
      identifier: created.identifier,
      correlationId: created.correlationId,
      causationId: created.causationId,
    });
    expect(entity.payload).toBe(JSON.stringify(created.payload));
    expect(entity.meta).toBe(JSON.stringify(created.meta));
  });

  it('persists and replays events in order', async () => {
    const eventsToStore = Array.from({ length: 120 }, (_, index) => makeEvent(index));

    await repo.storeEvents(eventsToStore);

    const iterator = await repo.getAllEvents(25);
    const received: IEventStoreEntity[] = [];

    for await (const batch of iterator) {
      received.push(...batch);
    }

    expect(received).toHaveLength(eventsToStore.length);
    const isSorted = received.every((event, index, list) => {
      if (index === list.length - 1) {
        return true;
      }

      return list[index + 1].created >= event.created;
    });
    expect(isSorted).toBe(true);
  });

  it('continues replay from a provided event id', async () => {
    const eventsToStore = Array.from({ length: 75 }, (_, index) => makeEvent(index));
    await repo.storeEvents(eventsToStore);

    const stopAt = eventsToStore[29];

    const resumedIterator = await repo.getAllEvents(20, stopAt.id);
    const resumed: IEventStoreEntity[] = [];

    for await (const batch of resumedIterator) {
      resumed.push(...batch);
    }

    expect(resumed).toHaveLength(eventsToStore.length - 30);
    expect(resumed[0].id).toBe(eventsToStore[30].id);
  });
});
