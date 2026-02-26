import type { IEventStoreEntity, IEventStoreRepo } from '@schemeless/event-store-types';
import { exportEventsToArray, importEventsFromArray, createSnapshot, parseSnapshot } from './exportImport';

// ─── helpers ────────────────────────────────────────────────────────────────

const buildIterator = (pages: IEventStoreEntity[][]) =>
  (async function* () {
    for (const page of pages) yield page;
  })();

const makeEvent = (overrides: Partial<IEventStoreEntity> = {}): IEventStoreEntity => ({
  id: 'evt-1',
  domain: 'test',
  type: 'standard',
  payload: { key: 'a', value: 1 },
  created: new Date('2024-01-01T00:00:00.000Z'),
  ...overrides,
});

const makeRepo = (overrides: Partial<IEventStoreRepo> = {}): IEventStoreRepo =>
  ({
    init: jest.fn(),
    getAllEvents: jest.fn(),
    createEventEntity: jest.fn(),
    storeEvents: jest.fn().mockResolvedValue(undefined),
    resetStore: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as IEventStoreRepo);

// ─── exportEventsToArray ─────────────────────────────────────────────────────

describe('exportEventsToArray', () => {
  it('collects all pages into a flat array', async () => {
    const e1 = makeEvent({ id: 'evt-1' });
    const e2 = makeEvent({ id: 'evt-2' });
    const e3 = makeEvent({ id: 'evt-3' });

    const repo = makeRepo({
      getAllEvents: jest.fn(async () => buildIterator([[e1, e2], [e3], []])),
    });

    const result = await exportEventsToArray(repo);

    expect(result).toHaveLength(3);
    expect(result.map((e) => e.id)).toEqual(['evt-1', 'evt-2', 'evt-3']);
  });

  it('uses default pageSize of 200', async () => {
    const getAllEvents = jest.fn(async () => buildIterator([[]]));
    const repo = makeRepo({ getAllEvents });

    await exportEventsToArray(repo);

    expect(getAllEvents).toHaveBeenCalledWith(200);
  });

  it('accepts a custom pageSize', async () => {
    const getAllEvents = jest.fn(async () => buildIterator([[]]));
    const repo = makeRepo({ getAllEvents });

    await exportEventsToArray(repo, { pageSize: 50 });

    expect(getAllEvents).toHaveBeenCalledWith(50);
  });

  it('calls onProgress with running total after each page', async () => {
    const e1 = makeEvent({ id: 'evt-1' });
    const e2 = makeEvent({ id: 'evt-2' });
    const repo = makeRepo({
      getAllEvents: jest.fn(async () => buildIterator([[e1], [e2], []])),
    });

    const progress: number[] = [];
    await exportEventsToArray(repo, { onProgress: (n) => progress.push(n) });

    expect(progress).toEqual([1, 2]);
  });

  it('returns empty array when there are no events', async () => {
    const repo = makeRepo({
      getAllEvents: jest.fn(async () => buildIterator([[]])),
    });

    const result = await exportEventsToArray(repo);
    expect(result).toEqual([]);
  });
});

// ─── importEventsFromArray ───────────────────────────────────────────────────

describe('importEventsFromArray', () => {
  it('writes all events via storeEvents in batches', async () => {
    const events = Array.from({ length: 250 }, (_, i) => makeEvent({ id: `evt-${i}` }));
    const storeEvents = jest.fn().mockResolvedValue(undefined);
    const repo = makeRepo({ storeEvents });

    await importEventsFromArray(repo, events, { batchSize: 100 });

    // 250 events in batches of 100 → 3 calls (100, 100, 50)
    expect(storeEvents).toHaveBeenCalledTimes(3);
    expect(storeEvents.mock.calls[0][0]).toHaveLength(100);
    expect(storeEvents.mock.calls[1][0]).toHaveLength(100);
    expect(storeEvents.mock.calls[2][0]).toHaveLength(50);
  });

  it('converts created strings to Date objects', async () => {
    const raw = [{ ...makeEvent(), created: '2024-06-15T12:00:00.000Z' as any }];
    const storeEvents = jest.fn().mockResolvedValue(undefined);
    const repo = makeRepo({ storeEvents });

    await importEventsFromArray(repo, raw);

    const written: IEventStoreEntity[] = storeEvents.mock.calls[0][0];
    expect(written[0].created).toBeInstanceOf(Date);
    expect(written[0].created.toISOString()).toBe('2024-06-15T12:00:00.000Z');
  });

  it('calls resetStore before importing when replace is true', async () => {
    const resetStore = jest.fn().mockResolvedValue(undefined);
    const repo = makeRepo({ resetStore });

    await importEventsFromArray(repo, [makeEvent()], { replace: true });

    expect(resetStore).toHaveBeenCalledTimes(1);
  });

  it('does NOT call resetStore when replace is false (default)', async () => {
    const resetStore = jest.fn();
    const repo = makeRepo({ resetStore });

    await importEventsFromArray(repo, [makeEvent()]);

    expect(resetStore).not.toHaveBeenCalled();
  });

  it('calls onProgress with cumulative count after each batch', async () => {
    const events = Array.from({ length: 5 }, (_, i) => makeEvent({ id: `evt-${i}` }));
    const repo = makeRepo();

    const progress: number[] = [];
    await importEventsFromArray(repo, events, {
      batchSize: 2,
      onProgress: (n) => progress.push(n),
    });

    expect(progress).toEqual([2, 4, 5]);
  });
});

// ─── createSnapshot / parseSnapshot ─────────────────────────────────────────

describe('createSnapshot', () => {
  it('produces a snapshot with correct count and recent exportedAt', () => {
    const events = [makeEvent({ id: 'evt-1' }), makeEvent({ id: 'evt-2' })];
    const before = new Date();
    const snapshot = createSnapshot(events);
    const after = new Date();

    expect(snapshot.count).toBe(2);
    expect(snapshot.events).toBe(events);
    const ts = new Date(snapshot.exportedAt);
    expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(ts.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

describe('parseSnapshot', () => {
  it('round-trips a snapshot through JSON serialisation', () => {
    const events = [makeEvent({ id: 'evt-1' }), makeEvent({ id: 'evt-2' })];
    const snapshot = createSnapshot(events);
    const json = JSON.stringify(snapshot);

    const parsed = parseSnapshot(json);

    expect(parsed.count).toBe(2);
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0].created).toBeInstanceOf(Date);
    expect(parsed.events[0].id).toBe('evt-1');
  });

  it('converts created string fields to Date instances', () => {
    const snapshot = {
      exportedAt: new Date().toISOString(),
      count: 1,
      events: [{ ...makeEvent(), created: '2024-03-10T08:00:00.000Z' }],
    };
    const json = JSON.stringify(snapshot);

    const parsed = parseSnapshot(json);

    expect(parsed.events[0].created).toBeInstanceOf(Date);
    expect(parsed.events[0].created.toISOString()).toBe('2024-03-10T08:00:00.000Z');
  });
});
