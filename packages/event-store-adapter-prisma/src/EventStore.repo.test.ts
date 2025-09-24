import * as path from 'path';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { pathToFileURL } from 'url';

import { PrismaClient } from '@prisma/client';
import type { CreatedEvent, IEventStoreEntity } from '@schemeless/event-store-types';

import { EventStoreRepo } from './EventStore.repo';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(__dirname, '..');
const schemaPath = path.join(packageRoot, 'prisma', 'schema.prisma');
const prismaBinary =
  process.platform === 'win32'
    ? path.join(packageRoot, 'node_modules', '.bin', 'prisma.cmd')
    : path.join(packageRoot, 'node_modules', '.bin', 'prisma');
const databaseFile = path.join(packageRoot, 'prisma', 'test.db');
const databaseUrl = pathToFileURL(databaseFile).toString();
const prismaCliOptions = {
  cwd: packageRoot,
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
  },
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
    process.env.DATABASE_URL = databaseUrl;

    await execFileAsync(prismaBinary, ['generate', '--schema', schemaPath], prismaCliOptions);

    await execFileAsync(prismaBinary, ['db', 'push', '--schema', schemaPath, '--skip-generate'], prismaCliOptions);

    prisma = new PrismaClient();
    repo = new EventStoreRepo(prisma);
    await repo.init();
  });

  beforeEach(async () => {
    await repo.resetStore();
  });

  afterAll(async () => {
    await repo.resetStore();
    await prisma.$disconnect();
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
