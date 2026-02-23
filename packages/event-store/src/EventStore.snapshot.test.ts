import { CreatedEvent, IEventStoreEntity, IEventStoreRepo, StoreEventsOptions } from '@schemeless/event-store-types';
import { makeEventStore } from './makeEventStore';
import { EventStore } from './EventStore.types';

const mockDomain = 'test-domain';
const mockType = 'test-type';
const mockIdentifier = 'user-123';

const createMockEvent = (sequence: number): IEventStoreEntity => ({
  id: `event-${sequence}`,
  domain: mockDomain,
  type: mockType,
  identifier: mockIdentifier,
  payload: { value: sequence },
  sequence,
  created: new Date(),
});

const createEmptyEventIterator = async function* (): AsyncIterableIterator<IEventStoreEntity[]> {
  yield [];
};

describe('EventStore Snapshot Support', () => {
  let eventStoreRepo: IEventStoreRepo;
  let eventStore: EventStore;

  const mockReducer = (state: { count: number }, event: IEventStoreEntity) => ({
    count: state.count + event.payload.value,
  });

  const initialState = { count: 0 };

  beforeEach(async () => {
    eventStoreRepo = {
      init: jest.fn().mockResolvedValue(undefined),
      getAllEvents: jest.fn(),
      createEventEntity: jest.fn(),
      storeEvents: jest.fn(),
      resetStore: jest.fn(),
      getStreamEvents: jest.fn(),
      getSnapshot: jest.fn(),
      saveSnapshot: jest.fn(),
    };

    eventStore = await makeEventStore(eventStoreRepo)([]);
  });

  it('should throw if repo does not support getStreamEvents', async () => {
    const repoWithoutStreamSupport = { ...eventStoreRepo, getStreamEvents: undefined };
    const es = await makeEventStore(repoWithoutStreamSupport)([]);

    await expect(es.getAggregate(mockDomain, mockIdentifier, mockReducer, initialState)).rejects.toThrow(
      'getAggregate is unavailable for this repository'
    );
  });

  it('should throw if adapter explicitly disables aggregate capability', async () => {
    const repoWithExplicitAggregateOff = {
      ...eventStoreRepo,
      capabilities: { aggregate: false },
    };
    const es = await makeEventStore(repoWithExplicitAggregateOff)([]);

    await expect(es.getAggregate(mockDomain, mockIdentifier, mockReducer, initialState)).rejects.toThrow(
      'declares capabilities.aggregate=false'
    );
  });

  it('should expose inferred aggregate capability', async () => {
    expect(eventStore.capabilities.aggregate).toBe(true);

    const repoWithoutStreamSupport = { ...eventStoreRepo, getStreamEvents: undefined };
    const es = await makeEventStore(repoWithoutStreamSupport)([]);

    expect(es.capabilities.aggregate).toBe(false);
  });

  it('should replay all events from 0 when no snapshot exists', async () => {
    const events = [createMockEvent(1), createMockEvent(2), createMockEvent(3)];
    (eventStoreRepo.getStreamEvents as jest.Mock).mockResolvedValue(events);
    (eventStoreRepo.getSnapshot as jest.Mock).mockResolvedValue(null);

    const result = await eventStore.getAggregate(mockDomain, mockIdentifier, mockReducer, initialState);

    expect(eventStoreRepo.getSnapshot).toHaveBeenCalledWith(mockDomain, mockIdentifier);
    expect(eventStoreRepo.getStreamEvents).toHaveBeenCalledWith(mockDomain, mockIdentifier, 0);
    expect(result.state).toEqual({ count: 6 }); // 1 + 2 + 3
    expect(result.sequence).toBe(3);
  });

  it('should replay events from snapshot sequence when snapshot exists', async () => {
    const snapshot = {
      domain: mockDomain,
      identifier: mockIdentifier,
      state: { count: 10 },
      sequence: 10,
      created: new Date(),
    };
    (eventStoreRepo.getSnapshot as jest.Mock).mockResolvedValue(snapshot);

    const events = [createMockEvent(11), createMockEvent(12)];
    (eventStoreRepo.getStreamEvents as jest.Mock).mockResolvedValue(events);

    const result = await eventStore.getAggregate(mockDomain, mockIdentifier, mockReducer, initialState);

    expect(eventStoreRepo.getSnapshot).toHaveBeenCalledWith(mockDomain, mockIdentifier);
    expect(eventStoreRepo.getStreamEvents).toHaveBeenCalledWith(mockDomain, mockIdentifier, 10);
    expect(result.state).toEqual({ count: 33 }); // 10 (snapshot) + 11 + 12
    expect(result.sequence).toBe(12);
  });

  it('should keep repo context when getStreamEvents uses this', async () => {
    const poolQuery = jest.fn().mockResolvedValue([createMockEvent(1), createMockEvent(2)]);
    const repoWithBoundContext = {
      pool: { query: poolQuery },
      init: jest.fn().mockResolvedValue(undefined),
      getAllEvents: jest.fn().mockResolvedValue(createEmptyEventIterator()),
      createEventEntity: jest.fn(),
      storeEvents: jest.fn(),
      resetStore: jest.fn(),
      getSnapshot: jest.fn().mockResolvedValue(null),
      getStreamEvents(domain: string, identifier: string, fromSequence: number = 0) {
        return this.pool.query(domain, identifier, fromSequence);
      },
    } as unknown as IEventStoreRepo;

    const es = await makeEventStore(repoWithBoundContext)([]);
    const result = await es.getAggregate(mockDomain, mockIdentifier, mockReducer, initialState);

    expect(poolQuery).toHaveBeenCalledWith(mockDomain, mockIdentifier, 0);
    expect(result.state).toEqual({ count: 3 });
    expect(result.sequence).toBe(2);
  });
});
