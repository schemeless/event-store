const { makeEventStoreCore } = require('../dist/index.js');

const event = (overrides = {}) => ({
  id: 'e1',
  domain: 'test',
  type: 'created',
  payload: {},
  created: new Date('2024-01-01T00:00:00.000Z'),
  ...overrides,
});

const makeRepo = (overrides = {}) => ({
  getAllEvents: jest.fn(),
  append: jest.fn().mockResolvedValue(undefined),
  reset: jest.fn().mockResolvedValue(undefined),
  getStreamEvents: jest.fn(),
  ...overrides,
});

const buildIterator = (pages) =>
  (async function* () {
    for (const page of pages) yield page;
  })();

describe('event-store-core', () => {
  it('append stores persisted events', async () => {
    const repo = makeRepo();
    const core = makeEventStoreCore(repo);
    const events = [event({ id: 'e1' }), event({ id: 'e2' })];

    await core.append(events);

    expect(repo.append).toHaveBeenCalledWith(events);
  });

  it('stream prefers repo stream query', async () => {
    const repo = makeRepo({
      getStreamEvents: jest.fn().mockResolvedValue([event({ id: 'e2' })]),
    });
    const core = makeEventStoreCore(repo);

    const result = await core.stream('test', 'abc', { fromSequence: 2 });

    expect(repo.getStreamEvents).toHaveBeenCalledWith('test', 'abc', 2);
    expect(result).toHaveLength(1);
  });

  it('scan returns paginated iterator', async () => {
    const repo = makeRepo({ getAllEvents: jest.fn(async () => buildIterator([[event()], []])) });
    const core = makeEventStoreCore(repo);
    const pages = [];
    for await (const page of core.scan({ pageSize: 25, startFromId: 'cursor-1' })) pages.push(page);

    expect(repo.getAllEvents).toHaveBeenCalledWith(25, 'cursor-1');
    expect(pages).toHaveLength(1);
  });

  it('rebuildReadModels runs observers in priority order', async () => {
    const calls = [];
    const observers = [
      {
        name: 'late',
        filters: [{ domain: 'test', type: 'created' }],
        priority: 10,
        apply: async () => calls.push('late'),
      },
      {
        name: 'early',
        filters: [{ domain: 'test', type: 'created' }],
        priority: 1,
        apply: async () => calls.push('early'),
      },
    ];
    const repo = makeRepo({ getAllEvents: jest.fn(async () => buildIterator([[event()], []])) });
    const core = makeEventStoreCore(repo);

    await core.rebuildReadModels({ observers });

    expect(calls).toEqual(['early', 'late']);
  });

  it('fire-and-forget observer does not block rebuild', async () => {
    let done = false;
    const observers = [
      {
        name: 'async',
        filters: [{ domain: 'test', type: 'created' }],
        fireAndForget: true,
        apply: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          done = true;
        },
      },
    ];
    const repo = makeRepo({ getAllEvents: jest.fn(async () => buildIterator([[event()], []])) });
    const core = makeEventStoreCore(repo);

    await core.rebuildReadModels({ observers });
    expect(done).toBe(false);
  });

  it('export and import round trip', async () => {
    const repo = makeRepo({
      getAllEvents: jest.fn(async () => buildIterator([[event({ id: 'e1' })], []])),
    });
    const core = makeEventStoreCore(repo);

    const events = [];
    for await (const page of core.export()) events.push(...page);
    await core.import(events, { replace: true });

    expect(repo.reset).toHaveBeenCalledTimes(1);
    expect(repo.append).toHaveBeenCalledTimes(1);
  });
});
