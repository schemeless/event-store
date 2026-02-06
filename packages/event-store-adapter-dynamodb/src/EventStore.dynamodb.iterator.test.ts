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

    // Setup send mock for QueryCommand and BatchGetCommand
    repo.ddbDocClient.send.mockImplementation((command) => {
      // Handle QueryCommand
      if (command.input.KeyConditionExpression) {
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
      }

      // Handle BatchGetCommand
      if (command.input.RequestItems) {
        const tableName = Object.keys(command.input.RequestItems)[0];
        const keys = command.input.RequestItems[tableName].Keys;
        const responses = keys.map((key: any) => ({
          ...key,
          loaded: true, // Simulating a hydrated event
          domain: 'test',
          type: 'test',
          payload: {}
        }));
        return Promise.resolve({
          Responses: {
            [tableName]: responses
          }
        });
      }
      return Promise.resolve({});
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

    // Simple test: 1 Query -> 1 BatchGet
    // But `send` is a generic mock. We can use mockImplementation to switch on command input 
    // or just chain mockResolvedValueOnce correctly.
    // Ideally we reuse the smart mock from earlier, but this test resets mocks or uses a new repo.
    // makeRepo() creates a new object but send mock is defined inside makeRepo ??
    // No, makeRepo creates: { ddbDocClient: { send: jest.fn() } ... }
    // The previous test logic updated `repo.ddbDocClient.send`.
    // Here we have a new `repo` from `makeRepo()`.

    // Let's implement a smart mock for this repo too, or simpler sequence.
    repo.ddbDocClient.send.mockImplementation((command) => {
      if (command.input.KeyConditionExpression) {
        // Query
        // We can simulate the paged responses here or simple ones.
        // This `mockResolvedValue` at 120 was intended for the first part of this test?
        // Actually lines 106-111 run `for await (const batch of iterator)`.
        // But wait, the test creates `iterator` at 106, runs loop, then checks results.
        // THEN it sets up NEW mocks at 127 and creates `iteratorPaged`.

        // So lines 120 is for first part.
        return Promise.resolve({
          Items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        });
      }
      if (command.input.RequestItems) {
        // BatchGet
        const tableName = Object.keys(command.input.RequestItems)[0];
        const keys = command.input.RequestItems[tableName].Keys;
        return Promise.resolve({
          Responses: {
            [tableName]: keys.map((k: any) => ({ ...k, loaded: true }))
          }
        });
      }
      return Promise.resolve({});
    });

    const iterator = new EventStoreDynamodbIterator(repo as any, 2);

    const batches = [];
    for await (const batch of iterator) {
      batches.push(batch);
    }

    // -------------------------------------------------------------------
    // Now setup for the Paged test.
    // We need to define behavior that returns items + LastEvaluatedKey, then next batch.

    let callCount = 0;
    repo.ddbDocClient.send.mockImplementation((command) => {
      if (command.input.KeyConditionExpression) {
        // Query
        if (callCount === 0) {
          callCount++;
          return Promise.resolve({
            Items: [{ id: 'a' }, { id: 'b' }],
            LastEvaluatedKey: { id: 'b' },
          });
        }
        if (callCount === 1) {
          callCount++;
          return Promise.resolve({
            Items: [{ id: 'c' }],
          });
        }
        return Promise.resolve({ Items: [] });
      }
      if (command.input.RequestItems) {
        // BatchGet
        const tableName = Object.keys(command.input.RequestItems)[0];
        const keys = command.input.RequestItems[tableName].Keys;
        return Promise.resolve({
          Responses: {
            [tableName]: keys.map((k: any) => ({ ...k, loaded: true }))
          }
        });
      }
    });

    const iteratorPaged = new EventStoreDynamodbIterator(repo as any, 2);
    const batchesPaged = [];
    for await (const batch of iteratorPaged) {
      batchesPaged.push(batch);
    }

    expect(batchesPaged).toHaveLength(2);
    expect(batchesPaged[0]).toHaveLength(2); // a, b
    expect(batchesPaged[1]).toHaveLength(1); // c
  });

  it('handles missing items in main table gracefully', async () => {
    mockDate('2020-01-15T00:00:00.000Z');
    const repo = makeRepo();

    repo.ddbDocClient.send.mockImplementation((command) => {
      if (command.input.KeyConditionExpression) {
        return Promise.resolve({
          Items: [{ id: '1' }, { id: '2' }], // 1 exists, 2 missing
        });
      }
      if (command.input.RequestItems) {
        const tableName = Object.keys(command.input.RequestItems)[0];
        // Only return item 1
        return Promise.resolve({
          Responses: {
            [tableName]: [{ id: '1', loaded: true }],
          },
        });
      }
      return Promise.resolve({});
    });

    const iterator = new EventStoreDynamodbIterator(repo as any, 10);
    const results = [];
    for await (const batch of iterator) {
      results.push(...batch);
    }

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('1');
  });

  it('chunks batch requests when hydrating more than 100 items', async () => {
    mockDate('2020-01-15T00:00:00.000Z');
    const repo = makeRepo();

    // Create 150 items
    const manyItems = Array.from({ length: 150 }, (_, i) => ({ id: `${i}`, created: '2020-01-01' }));

    let batchGetCallCount = 0;

    repo.ddbDocClient.send.mockImplementation((command) => {
      if (command.input.KeyConditionExpression) {
        return Promise.resolve({
          Items: manyItems,
        });
      }
      if (command.input.RequestItems) {
        batchGetCallCount++;
        const tableName = Object.keys(command.input.RequestItems)[0];
        const keys = command.input.RequestItems[tableName].Keys;

        // ensure keys length is <= 100
        if (keys.length > 100) {
          throw new Error('BatchGet request had more than 100 keys');
        }

        return Promise.resolve({
          Responses: {
            [tableName]: keys.map((k: any) => ({ ...k, loaded: true })),
          },
        });
      }
      return Promise.resolve({});
    });

    const iterator = new EventStoreDynamodbIterator(repo as any, 200); // larger page size
    const results = [];
    for await (const batch of iterator) {
      results.push(...batch);
    }

    expect(results).toHaveLength(150);
    expect(batchGetCallCount).toBeGreaterThanOrEqual(2); // Should be 2 calls (100 + 50)
  });
});
