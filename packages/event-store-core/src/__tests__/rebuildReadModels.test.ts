import { rebuildReadModels } from '../rebuildReadModels';
import type { EventStoreCoreRepo, PersistedEvent } from '../types';

const mockRepo = (overrides = {}): EventStoreCoreRepo =>
  ({
    getAllEvents: jest.fn(),
    append: jest.fn(),
    init: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as EventStoreCoreRepo);

const mockObserver = (apply = jest.fn()) => ({
  name: 'testObserver',
  filters: [{ domain: 'test', type: 'Created' }],
  apply,
});

const makeEvent = (overrides = {}): PersistedEvent => ({
  id: 'event-1',
  domain: 'test',
  type: 'Created',
  payload: {},
  identifier: 'agg-1',
  sequence: 1,
  correlationId: 'corr-1',
  causationId: null,
  created: new Date(),
  ...overrides,
});

const makeIterator = (pages: PersistedEvent[][]) => ({
  [Symbol.asyncIterator]: jest.fn().mockReturnValue({
    next: jest
      .fn()
      .mockResolvedValueOnce({ value: pages[0], done: false })
      .mockResolvedValueOnce(
        pages[1] !== undefined ? { value: pages[1], done: false } : { value: undefined, done: true }
      ),
  }),
});

describe('rebuildReadModels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls reset before rebuilding when reset is provided', async () => {
    const reset = jest.fn().mockResolvedValue(undefined);
    const repo = mockRepo();
    const mockIterator = {
      [Symbol.asyncIterator]: jest.fn().mockReturnValue({
        next: jest
          .fn()
          .mockResolvedValueOnce({ value: [], done: false })
          .mockResolvedValueOnce({ value: undefined, done: true }),
      }),
    };
    (repo.getAllEvents as jest.Mock).mockResolvedValue(mockIterator);

    await rebuildReadModels(repo, { reset });

    expect(reset).toHaveBeenCalledTimes(1);
    const resetCallIndex = (reset as jest.Mock).mock.invocationCallOrder[0];
    const getAllEventsCallIndex = (repo.getAllEvents as jest.Mock).mock.invocationCallOrder[0];
    expect(resetCallIndex).toBeLessThan(getAllEventsCallIndex);
  });

  it('does not throw when reset is not provided', async () => {
    const repo = mockRepo();
    const mockIterator = {
      [Symbol.asyncIterator]: jest.fn().mockReturnValue({
        next: jest
          .fn()
          .mockResolvedValueOnce({ value: [], done: false })
          .mockResolvedValueOnce({ value: undefined, done: true }),
      }),
    };
    (repo.getAllEvents as jest.Mock).mockResolvedValue(mockIterator);

    await expect(rebuildReadModels(repo, {})).resolves.not.toThrow();
  });

  it('uses default pageSize of 200', async () => {
    const repo = mockRepo();
    const mockIterator = {
      [Symbol.asyncIterator]: jest.fn().mockReturnValue({
        next: jest
          .fn()
          .mockResolvedValueOnce({ value: [], done: false })
          .mockResolvedValueOnce({ value: undefined, done: true }),
      }),
    };
    (repo.getAllEvents as jest.Mock).mockResolvedValue(mockIterator);

    await rebuildReadModels(repo, {});

    expect(repo.getAllEvents).toHaveBeenCalledWith(200, undefined);
  });

  it('uses custom pageSize', async () => {
    const repo = mockRepo();
    const mockIterator = {
      [Symbol.asyncIterator]: jest.fn().mockReturnValue({
        next: jest
          .fn()
          .mockResolvedValueOnce({ value: [], done: false })
          .mockResolvedValueOnce({ value: undefined, done: true }),
      }),
    };
    (repo.getAllEvents as jest.Mock).mockResolvedValue(mockIterator);

    await rebuildReadModels(repo, { pageSize: 100 });

    expect(repo.getAllEvents).toHaveBeenCalledWith(100, undefined);
  });

  it('uses startFromId', async () => {
    const repo = mockRepo();
    const mockIterator = {
      [Symbol.asyncIterator]: jest.fn().mockReturnValue({
        next: jest
          .fn()
          .mockResolvedValueOnce({ value: [], done: false })
          .mockResolvedValueOnce({ value: undefined, done: true }),
      }),
    };
    (repo.getAllEvents as jest.Mock).mockResolvedValue(mockIterator);

    await rebuildReadModels(repo, { startFromId: 'event-50' });

    expect(repo.getAllEvents).toHaveBeenCalledWith(200, 'event-50');
  });

  it('runs observers on each page of events', async () => {
    const apply = jest.fn().mockResolvedValue(undefined);
    const observer = mockObserver(apply);
    const repo = mockRepo();

    const page1 = [makeEvent({ id: 'event-1' }), makeEvent({ id: 'event-2' })];
    const page2 = [makeEvent({ id: 'event-3' })];
    const mockIterator = {
      [Symbol.asyncIterator]: jest.fn().mockReturnValue({
        next: jest
          .fn()
          .mockResolvedValueOnce({ value: page1, done: false })
          .mockResolvedValueOnce({ value: page2, done: false })
          .mockResolvedValueOnce({ value: [], done: false })
          .mockResolvedValueOnce({ value: undefined, done: true }),
      }),
    };
    (repo.getAllEvents as jest.Mock).mockResolvedValue(mockIterator);

    await rebuildReadModels(repo, { observers: [observer] });

    // apply should be called 3 times total (2 from page1 + 1 from page2)
    expect(apply).toHaveBeenCalledTimes(3);
    expect(apply).toHaveBeenCalledWith(page1[0]);
    expect(apply).toHaveBeenCalledWith(page1[1]);
    expect(apply).toHaveBeenCalledWith(page2[0]);
  });

  it('stops after empty page is returned', async () => {
    const apply = jest.fn().mockResolvedValue(undefined);
    const observer = mockObserver(apply);
    const repo = mockRepo();

    const page1 = [makeEvent({ id: 'event-1' })];
    const moreEvents = [makeEvent({ id: 'event-2' })];
    const mockIterator = {
      [Symbol.asyncIterator]: jest.fn().mockReturnValue({
        next: jest
          .fn()
          .mockResolvedValueOnce({ value: page1, done: false })
          .mockResolvedValueOnce({ value: [], done: false })
          .mockResolvedValueOnce({ value: moreEvents, done: false })
          .mockResolvedValueOnce({ value: undefined, done: true }),
      }),
    };
    (repo.getAllEvents as jest.Mock).mockResolvedValue(mockIterator);

    await rebuildReadModels(repo, { observers: [observer] });

    // apply should only be called for page1 (1 call), not for moreEvents
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(page1[0]);
  });
});
