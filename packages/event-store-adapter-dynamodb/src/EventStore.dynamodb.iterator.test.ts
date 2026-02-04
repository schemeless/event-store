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
  const query = jest.fn();
  const getFullEvent = jest.fn(async (e) => ({ ...e, loaded: true }));

  return {
    mapper: {
      query,
    },
    getFullEvent,
  };
};

describe('EventStoreDynamodbIterator', () => {
  afterEach(() => {
    resetDate();
  });

  it('iterates over time buckets and queries events', async () => {
    // Set "Now" to March 2020. Start Date in Iterator is Jan 2020.
    // Logic should query 2020-01, 2020-02, 2020-03.
    mockDate('2020-03-15T00:00:00.000Z');

    const repo = makeRepo();

    // Setup query mock
    repo.mapper.query.mockImplementation((entityClass, { timeBucket }) => {
      if (timeBucket === '2020-01') {
        return (async function* () { yield { id: '1', created: new Date('2020-01-05') }; })();
      }
      if (timeBucket === '2020-02') {
        return (async function* () { yield { id: '2', created: new Date('2020-02-10') }; })();
      }
      return (async function* () { })(); // Empty for others
    });

    const iterator = new EventStoreDynamodbIterator(repo as any, 10);

    const results = [];
    for await (const batch of iterator) {
      results.push(...batch);
    }

    // Verify it queried the expected buckets
    expect(repo.mapper.query).toHaveBeenCalledWith(
      EventStoreEntity,
      { timeBucket: '2020-01' },
      expect.objectContaining({ indexName: TIME_BUCKET_INDEX })
    );
    expect(repo.mapper.query).toHaveBeenCalledWith(
      EventStoreEntity,
      { timeBucket: '2020-02' },
      expect.anything()
    );
    expect(repo.mapper.query).toHaveBeenCalledWith(
      EventStoreEntity,
      { timeBucket: '2020-03' },
      expect.anything()
    );

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(expect.objectContaining({ id: '1', loaded: true }));
    expect(results[1]).toEqual(expect.objectContaining({ id: '2', loaded: true }));
  });

  it('batches query results according to pageSize', async () => {
    mockDate('2020-01-15T00:00:00.000Z');
    const repo = makeRepo();

    // Return 3 items for Jan 2020
    repo.mapper.query.mockImplementation(() => {
      return (async function* () {
        yield { id: 'a' };
        yield { id: 'b' };
        yield { id: 'c' };
      })();
    });

    // PageSize = 2
    const iterator = new EventStoreDynamodbIterator(repo as any, 2);

    const batches = [];
    for await (const batch of iterator) {
      batches.push(batch);
    }

    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(2); // a, b
    expect(batches[1]).toHaveLength(1); // c
    expect(batches[0][0].id).toBe('a');
    expect(batches[1][0].id).toBe('c');
  });
});
