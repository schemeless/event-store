import { makeEventStoreCore } from '../makeEventStoreCore';
import { AdapterCapabilityError } from '@schemeless/event-store-types';
import type { EventStoreCoreRepo, PersistedEvent } from '../types';
import * as exportImport from '../exportImport';
import * as rebuildReadModelsModule from '../rebuildReadModels';

const mockRepo = (overrides = {}): EventStoreCoreRepo =>
  ({
    append: jest.fn().mockResolvedValue(undefined),
    getStreamEvents: jest.fn(),
    getAllEvents: jest.fn(),
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

describe('makeEventStoreCore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('append', () => {
    it('delegates to repo.append', async () => {
      const repo = mockRepo();
      const core = makeEventStoreCore(repo);
      const events = [makeEvent({ id: 'event-1' })];

      await core.append(events);

      expect(repo.append).toHaveBeenCalledWith(events);
    });
  });

  describe('stream', () => {
    it('uses getStreamEvents when available', async () => {
      const repo = mockRepo();
      const events = [makeEvent({ id: 'event-1' })];
      (repo.getStreamEvents as jest.Mock).mockResolvedValue(events);
      const core = makeEventStoreCore(repo);

      const result = await core.stream('test', 'agg-1');

      expect(repo.getStreamEvents).toHaveBeenCalledWith('test', 'agg-1', 0);
      expect(result).toEqual(events);
    });

    it('uses fromSequence option', async () => {
      const repo = mockRepo();
      const events = [makeEvent({ id: 'event-1' })];
      (repo.getStreamEvents as jest.Mock).mockResolvedValue(events);
      const core = makeEventStoreCore(repo);

      await core.stream('test', 'agg-1', { fromSequence: 5 });

      expect(repo.getStreamEvents).toHaveBeenCalledWith('test', 'agg-1', 5);
    });

    it('throws a capability error when getStreamEvents is not available', async () => {
      const repo = mockRepo({
        getStreamEvents: undefined,
      });
      const core = makeEventStoreCore(repo);

      await expect(core.stream('test', 'agg-1')).rejects.toBeInstanceOf(AdapterCapabilityError);
      expect(repo.getAllEvents).not.toHaveBeenCalled();
    });
  });

  describe('scan', () => {
    it('yields pages from repo.getAllEvents', async () => {
      const repo = mockRepo();
      const page1 = [makeEvent({ id: 'event-1' }), makeEvent({ id: 'event-2' })];
      const page2 = [makeEvent({ id: 'event-3' })];
      const mockIterator = {
        [Symbol.asyncIterator]: jest.fn().mockReturnValue({
          next: jest
            .fn()
            .mockResolvedValueOnce({ value: page1, done: false })
            .mockResolvedValueOnce({ value: page2, done: false })
            .mockResolvedValueOnce({ value: undefined, done: true }),
        }),
      };
      (repo.getAllEvents as jest.Mock).mockResolvedValue(mockIterator);
      const core = makeEventStoreCore(repo);

      const results: PersistedEvent[][] = [];
      for await (const page of core.scan()) {
        results.push(page);
      }

      expect(results).toEqual([page1, page2]);
    });

    it('uses custom pageSize', async () => {
      const repo = mockRepo();
      (repo.getAllEvents as jest.Mock).mockResolvedValue({
        [Symbol.asyncIterator]: jest.fn().mockReturnValue({
          next: jest
            .fn()
            .mockResolvedValueOnce({ value: [], done: false })
            .mockResolvedValueOnce({ value: undefined, done: true }),
        }),
      });
      const core = makeEventStoreCore(repo);

      for await (const _page of core.scan({ pageSize: 50 })) {
        // consume the iterator
      }

      expect(repo.getAllEvents).toHaveBeenCalledWith(50, undefined);
    });

    it('uses startFromId', async () => {
      const repo = mockRepo();
      (repo.getAllEvents as jest.Mock).mockResolvedValue({
        [Symbol.asyncIterator]: jest.fn().mockReturnValue({
          next: jest
            .fn()
            .mockResolvedValueOnce({ value: [], done: false })
            .mockResolvedValueOnce({ value: undefined, done: true }),
        }),
      });
      const core = makeEventStoreCore(repo);

      for await (const _page of core.scan({ pageSize: 200, startFromId: 'e10' })) {
        // consume the iterator
      }

      expect(repo.getAllEvents).toHaveBeenCalledWith(200, 'e10');
    });

    it('stops on empty page', async () => {
      const repo = mockRepo();
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
      (repo.getAllEvents as jest.Mock).mockResolvedValue(mockIterator);
      const core = makeEventStoreCore(repo);

      const results: PersistedEvent[][] = [];
      for await (const page of core.scan()) {
        results.push(page);
      }

      expect(results).toEqual([events]);
    });
  });

  describe('rebuildReadModels', () => {
    it('delegates to rebuildReadModels', async () => {
      const repo = mockRepo();
      const rebuildReadModelsSpy = jest
        .spyOn(rebuildReadModelsModule, 'rebuildReadModels')
        .mockResolvedValue(undefined);
      const core = makeEventStoreCore(repo);

      await core.rebuildReadModels();

      expect(rebuildReadModelsSpy).toHaveBeenCalledWith(repo, {});
      rebuildReadModelsSpy.mockRestore();
    });
  });

  describe('export', () => {
    it('returns an async iterable from exportEvents', async () => {
      const repo = mockRepo();
      const page = [makeEvent({ id: 'event-1' })];
      const exportEventsSpy = jest.spyOn(exportImport, 'exportEvents').mockReturnValue(
        (async function* () {
          yield page;
        })()
      );
      const core = makeEventStoreCore(repo);

      const results: PersistedEvent[][] = [];
      for await (const p of core.export()) {
        results.push(p);
      }

      expect(results).toEqual([page]);
      exportEventsSpy.mockRestore();
    });
  });

  describe('import', () => {
    it('delegates to importEvents', async () => {
      const repo = mockRepo();
      const importEventsSpy = jest.spyOn(exportImport, 'importEvents').mockResolvedValue(undefined);
      const core = makeEventStoreCore(repo);
      const events = [makeEvent({ id: 'event-1' })];

      await core.import(events);

      expect(importEventsSpy).toHaveBeenCalledWith(repo, events, {});
      importEventsSpy.mockRestore();
    });
  });
});
