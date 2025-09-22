import type { CreatedEvent } from '@schemeless/event-store-types';

import { EventStoreRepo } from './EventStore.repo';
import { logger } from './utils/logger';

jest.mock('./utils/logger', () => ({
  logger: {
    fatal: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  },
}));

describe('EventStoreRepo (null adapter)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws when getAllEvents is called', async () => {
    const repo = new EventStoreRepo();

    await expect(repo.getAllEvents()).rejects.toThrow('Not implemented');
  });

  it('returns the original event from createEventEntity', () => {
    const repo = new EventStoreRepo();
    const event: CreatedEvent<{ value: number }> = {
      id: 'event-id',
      domain: 'test-domain',
      type: 'EVENT_TYPE',
      payload: { value: 42 },
      created: new Date('2023-01-01T00:00:00.000Z'),
    };

    const entity = repo.createEventEntity(event);

    expect(entity).toBe(event);
  });

  it('resolves when storeEvents is called', async () => {
    const repo = new EventStoreRepo();
    const event: CreatedEvent<Record<string, never>> = {
      id: 'event-id',
      domain: 'domain',
      type: 'TYPE',
      payload: {},
      created: new Date(),
    };

    await expect(repo.storeEvents([event])).resolves.toBeUndefined();
  });

  it('logs when resetStore is called', async () => {
    const repo = new EventStoreRepo();

    await expect(repo.resetStore()).resolves.toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith('not needed');
  });
});
