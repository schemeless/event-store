import type { IEventStoreRepo } from '@schemeless/event-store-types';
import { makeEventStore } from './makeEventStore';

const createRepo = (): IEventStoreRepo =>
  ({
    init: jest.fn(async () => undefined),
    getAllEvents: jest.fn(async () => (async function* () {})()),
    createEventEntity: jest.fn((event) => event as any),
    storeEvents: jest.fn(async () => undefined),
    resetStore: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
  } as unknown as IEventStoreRepo);

describe('makeEventStore shutdown', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('clears the shutdown timeout timer when shutdown resolves', async () => {
    jest.useFakeTimers();

    const repo = createRepo();
    const eventStore = await makeEventStore(repo)([]);

    const timerCountBeforeShutdown = jest.getTimerCount();
    await expect(eventStore.shutdown(2000)).resolves.toBeUndefined();

    expect(jest.getTimerCount()).toBe(timerCountBeforeShutdown);
    expect(repo.close).toHaveBeenCalledTimes(1);
  });
});
