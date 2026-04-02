import { exportEvents, importEvents } from '../exportImport';
import type { EventStoreCoreRepo, PersistedEvent } from '../types';

const mockRepo = (overrides = {}): EventStoreCoreRepo =>
  ({
    getAllEvents: jest.fn(),
    append: jest.fn(),
    init: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as EventStoreCoreRepo);

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

describe('exportImport', () => {
  describe('exportEvents', () => {
    // Test 1: yields pages of events from getAllEvents iterator
    it('yields pages of events from getAllEvents iterator', async () => {
      const page1 = [makeEvent({ id: 'event-1' }), makeEvent({ id: 'event-2' })];
      const page2 = [makeEvent({ id: 'event-3' })];
      const page3 = [makeEvent({ id: 'event-4' }), makeEvent({ id: 'event-5' })];
      const mockIterator = {
        [Symbol.asyncIterator]: jest.fn().mockReturnValue({
          next: jest
            .fn()
            .mockResolvedValueOnce({ value: page1, done: false })
            .mockResolvedValueOnce({ value: page2, done: false })
            .mockResolvedValueOnce({ value: page3, done: false })
            .mockResolvedValueOnce({ value: undefined, done: true }),
        }),
      };
      const repo = mockRepo();
      (repo.getAllEvents as jest.Mock).mockResolvedValue(mockIterator);

      const results: PersistedEvent[][] = [];
      for await (const page of exportEvents(repo)) {
        results.push(page);
      }

      expect(results).toEqual([page1, page2, page3]);
    });

    // Test 2: uses default pageSize of 200
    it('uses default pageSize of 200', async () => {
      const repo = mockRepo();
      (repo.getAllEvents as jest.Mock).mockResolvedValue({
        [Symbol.asyncIterator]: jest.fn().mockReturnValue({
          next: jest
            .fn()
            .mockResolvedValueOnce({ value: [], done: false })
            .mockResolvedValueOnce({ value: undefined, done: true }),
        }),
      });

      for await (const _page of exportEvents(repo)) {
        // consume the iterator
      }

      expect(repo.getAllEvents).toHaveBeenCalledWith(200);
    });

    // Test 3: uses custom pageSize when provided
    it('uses custom pageSize when provided', async () => {
      const repo = mockRepo();
      (repo.getAllEvents as jest.Mock).mockResolvedValue({
        [Symbol.asyncIterator]: jest.fn().mockReturnValue({
          next: jest
            .fn()
            .mockResolvedValueOnce({ value: [], done: false })
            .mockResolvedValueOnce({ value: undefined, done: true }),
        }),
      });

      for await (const _page of exportEvents(repo, { pageSize: 50 })) {
        // consume the iterator
      }

      expect(repo.getAllEvents).toHaveBeenCalledWith(50);
    });

    // Test 4: stops yielding when getAllEvents returns empty page
    it('stops yielding when getAllEvents returns empty page', async () => {
      const events = [makeEvent({ id: 'event-1' })];
      const moreEvents = [makeEvent({ id: 'event-2' })];
      const mockIterator = {
        [Symbol.asyncIterator]: jest.fn().mockReturnValue({
          next: jest
            .fn()
            .mockResolvedValueOnce({ value: events, done: false })
            .mockResolvedValueOnce({ value: [], done: false })
            .mockResolvedValueOnce({ value: moreEvents, done: false })
            .mockResolvedValueOnce({ value: undefined, done: true }),
        }),
      };
      const repo = mockRepo();
      (repo.getAllEvents as jest.Mock).mockResolvedValue(mockIterator);

      const results: PersistedEvent[][] = [];
      for await (const page of exportEvents(repo)) {
        results.push(page);
      }

      expect(results).toEqual([events]);
    });
  });

  describe('importEvents', () => {
    // Test 1: appends events to the repo
    it('appends events to the repo', async () => {
      const repo = mockRepo();
      (repo.append as jest.Mock).mockResolvedValue(undefined);
      const events = [makeEvent({ id: 'event-1' }), makeEvent({ id: 'event-2' })];

      await importEvents(repo, events);

      expect(repo.append).toHaveBeenCalledWith(events);
    });

    // Test 2: normalises created dates from plain objects to Date instances
    it('normalises created dates from plain objects to Date instances', async () => {
      const repo = mockRepo();
      (repo.append as jest.Mock).mockResolvedValue(undefined);
      const event = {
        id: 'event-1',
        domain: 'test',
        type: 'Created',
        payload: {},
        identifier: 'agg-1',
        sequence: 1,
        correlationId: 'corr-1',
        causationId: null,
        created: '2026-04-01T00:00:00.000Z',
      } as unknown as PersistedEvent;

      await importEvents(repo, [event]);

      const appendedEvents = (repo.append as jest.Mock).mock.calls[0][0];
      expect(appendedEvents[0].created).toBeInstanceOf(Date);
    });

    // Test 3: throws when replace=true but repo.reset is not available
    it('throws when replace=true but repo.reset is not available', async () => {
      const repo = mockRepo();

      await expect(importEvents(repo, [], { replace: true })).rejects.toThrow(
        'replace=true requires repo.reset() support'
      );
    });

    // Test 4: calls repo.reset when replace=true and reset is available
    it('calls repo.reset when replace=true and reset is available', async () => {
      const repo = mockRepo({
        reset: jest.fn().mockResolvedValue(undefined),
      });
      (repo.append as jest.Mock).mockResolvedValue(undefined);
      const events = [makeEvent({ id: 'event-1' })];

      await importEvents(repo, events, { replace: true });

      expect(repo.reset).toHaveBeenCalled();
      expect(repo.append).toHaveBeenCalled();
      // reset should be called before append
      const appendCallIndex = (repo.append as jest.Mock).mock.invocationCallOrder[0];
      const resetCallIndex = (repo.reset as jest.Mock).mock.invocationCallOrder[0];
      expect(resetCallIndex).toBeLessThan(appendCallIndex);
    });
  });
});
