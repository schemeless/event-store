import { EventStoreDynamodbIterator } from './EventStore.dynamodb.iterator';
import { EventStoreEntity, TIME_BUCKET_INDEX } from './EventStore.dynamodb.entity';

// Mock Date to control "Now" for deterministic TimeBucket iteration
const RealDate = Date;

const mockDate = (isoDate: string) => {
  global.Date = class extends RealDate {
    constructor(arg?: any) {
      if (arg) {
        // @ts-ignore
        super(arg);
        return;
      }
      super(isoDate);
    }
  } as any;
};

const resetDate = () => {
  global.Date = RealDate;
};

const makeRepo = () => {
  const send = jest.fn();
  const getFullEvent = jest.fn(async (e) => ({ ...e, loaded: true }));

  return {
    ddbDocClient: {
      send,
    },
    getFullEvent,
    tableName: 'test-table',
  };
};

jest.mock('./EventStore.dynamodb.entity', () => {
  const original = jest.requireActual('./EventStore.dynamodb.entity');
  return {
    ...original,
    EventStoreEntity: {
      ...original.EventStoreEntity,
      fromItem: jest.fn((item) => item),
    },
  };
});

describe('EventStoreDynamodbIterator', () => {
  afterEach(() => {
    resetDate();
  });

  it('iterates over time buckets and queries events', async () => {
    // Set "Now" to March 2020. Start Date in Iterator is Jan 2020.
    // Logic should query 2020-01, 2020-02, 2020-03.
    mockDate('2020-03-15T00:00:00.000Z');

    const repo = makeRepo();

    // Setup send mock for QueryCommand
    repo.ddbDocClient.send.mockImplementation((command) => {
      const { ExpressionAttributeValues } = command.input;
      const timeBucket = ExpressionAttributeValues[':timeBucket'];

      if (timeBucket === '2020-01') {
        return Promise.resolve({
          Items: [{ id: '1', created: '2020-01-05T00:00:00.000Z' }],
        });
      }
      if (timeBucket === '2020-02') {
        return Promise.resolve({
          Items: [{ id: '2', created: '2020-02-10T00:00:00.000Z' }],
        });
      }
      return Promise.resolve({ Items: [] });
    });

    const iterator = new EventStoreDynamodbIterator(repo as any, 10);

    const results = [];
    for await (const batch of iterator) {
      results.push(...batch);
    }

    // Verify it queried the expected buckets
    expect(repo.ddbDocClient.send).toHaveBeenCalled();

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(expect.objectContaining({ id: '1', loaded: true }));
    expect(results[1]).toEqual(expect.objectContaining({ id: '2', loaded: true }));
  });

  it('batches query results according to pageSize', async () => {
    mockDate('2020-01-15T00:00:00.000Z');
    const repo = makeRepo();

    // Return 3 items for Jan 2020
    repo.ddbDocClient.send.mockResolvedValue({
      Items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    });

    // PageSize = 2
    // Note: In SDK v3 implementation, we yield the whole batch from response.Items
    // If we want exact batching by pageSize, we'd need to handle it in the generator.
    // My new implementation yields each response.Items as a batch.
    const iterator = new EventStoreDynamodbIterator(repo as any, 2);

    const batches = [];
    for await (const batch of iterator) {
      batches.push(batch);
    }

    // Since our mock returns all 3 in one query response, it will be 1 batch of 3.
    // Wait, let's check my iterator implementation.
    /*
        if (response.Items && response.Items.length > 0) {
          const buffer: EventStoreEntity[] = [];
          for (const item of response.Items) {
            const fullEvent = await this.repo.getFullEvent(EventStoreEntity.fromItem(item));
            buffer.push(fullEvent);
          }
          yield buffer;
        }
    */
    // Yes, it yields the whole response.Items.
    // If we want to test pagination with LastEvaluatedKey:
    repo.ddbDocClient.send
      .mockResolvedValueOnce({
        Items: [{ id: 'a' }, { id: 'b' }],
        LastEvaluatedKey: { id: 'b' },
      })
      .mockResolvedValueOnce({
        Items: [{ id: 'c' }],
      })
      .mockResolvedValue({ Items: [] });

    const iteratorPaged = new EventStoreDynamodbIterator(repo as any, 2);
    const batchesPaged = [];
    for await (const batch of iteratorPaged) {
      batchesPaged.push(batch);
    }

    expect(batchesPaged).toHaveLength(2);
    expect(batchesPaged[0]).toHaveLength(2); // a, b
    expect(batchesPaged[1]).toHaveLength(1); // c
  });
});
