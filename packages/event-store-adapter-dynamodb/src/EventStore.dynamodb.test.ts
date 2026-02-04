import 'reflect-metadata';

import { EventStoreRepo } from './EventStore.dynamodb.repo';
import { EventStoreEntity } from './EventStore.dynamodb.entity';

const ensureTableExistsMock = jest.fn();
const scanMock = jest.fn();
const batchPutMock = jest.fn();
const putMock = jest.fn(); // Added putMock
const batchGetMock = jest.fn();
const deleteTableMock = jest.fn();
const queryMock = jest.fn(); // Added queryMock

let dataMapperConstructorMock: jest.Mock;

jest.mock('@aws/dynamodb-data-mapper', () => ({
  DataMapper: function (...args: any[]) {
    return dataMapperConstructorMock(...args);
  },
}));

jest.mock('./EventStore.dynamodb.entity', () => ({
  EventStoreEntity: class EventStoreEntity {
    generateTimeBucket = jest.fn(); // Mock method
  },
  TIME_BUCKET_INDEX: 'timeBucketIndex', // Updated constants
  CAUSATION_INDEX: 'causationIndex',
  dateIndexGSIOptions: {},
}));

const iteratorInitMock = jest.fn();
const iteratorInstanceMock = { init: iteratorInitMock } as any;
let iteratorConstructorMock: jest.Mock;

jest.mock('./EventStore.dynamodb.iterator', () => ({
  EventStoreDynamodbIterator: function (...args: any[]) {
    return iteratorConstructorMock(...args);
  },
}));

const sizeofMock = jest.fn();
jest.mock('object-sizeof', () => (...args: any[]) => sizeofMock(...args));

const createS3Client = () => {
  const upload = jest.fn(() => ({ promise: jest.fn().mockResolvedValue(undefined) }));
  const headBucket = jest.fn(() => ({ promise: jest.fn().mockRejectedValue(new Error('missing')) }));
  const createBucket = jest.fn(() => ({ promise: jest.fn().mockResolvedValue(undefined) }));
  const getObject = jest.fn(() => ({
    promise: jest.fn().mockResolvedValue({ Body: Buffer.from(JSON.stringify({ restored: true })) }),
  }));

  return { upload, headBucket, createBucket, getObject };
};

describe('EventStoreRepo', () => {
  beforeEach(() => {
    ensureTableExistsMock.mockReset();
    scanMock.mockReset();
    batchPutMock.mockReset();
    putMock.mockReset();
    batchGetMock.mockReset();
    deleteTableMock.mockReset();
    queryMock.mockReset();

    dataMapperConstructorMock = jest.fn().mockImplementation(() => ({
      ensureTableExists: ensureTableExistsMock,
      scan: scanMock,
      batchPut: batchPutMock,
      put: putMock,
      batchGet: batchGetMock,
      query: queryMock,
      deleteTable: deleteTableMock,
    }));
    iteratorConstructorMock = jest.fn().mockImplementation(() => iteratorInstanceMock);
    iteratorInitMock.mockReset();
    sizeofMock.mockReset();
  });

  it('initializes the DynamoDB table and S3 bucket', async () => {
    const s3 = createS3Client();
    const repo = new EventStoreRepo({} as any, s3 as any, {
      tableNamePrefix: 'prefix',
      s3BucketName: 'bucket',
    });

    expect(dataMapperConstructorMock).toHaveBeenCalledWith({ client: {}, tableNamePrefix: 'prefix' });

    await repo.init();

    expect(ensureTableExistsMock).toHaveBeenCalledWith(
      EventStoreEntity,
      expect.objectContaining({
        readCapacityUnits: expect.any(Number),
        indexOptions: expect.objectContaining({
          timeBucketIndex: expect.anything(),
          causationIndex: expect.anything()
        })
      })
    );
    expect(s3.headBucket).toHaveBeenCalledWith({ Bucket: 'bucket' });
    expect(s3.createBucket).toHaveBeenCalledWith({ Bucket: 'bucket' });
  });

  it('stores events and offloads oversized payloads to S3', async () => {
    const s3 = createS3Client();
    sizeofMock.mockImplementation((event: any) => (event.id === '2' ? 400000 : 1000));
    putMock.mockResolvedValue({});

    const repo = new EventStoreRepo({} as any, s3 as any, {
      tableNamePrefix: 'prefix',
      s3BucketName: 'bucket',
    });

    const events = [
      { id: '1', domain: 'user', type: 'created', payload: { size: 'small' }, created: new Date() },
      { id: '2', domain: 'user', type: 'created', payload: { size: 'large' }, created: new Date() },
    ];

    await repo.storeEvents(events as any);

    expect(sizeofMock).toHaveBeenCalledTimes(2);
    expect(s3.upload).toHaveBeenCalledTimes(1);
    expect(s3.upload).toHaveBeenCalledWith(
      expect.objectContaining({ Bucket: 'bucket', Key: 'events/2.json' })
    );

    // Expect 'put' to be called for each event with conditional check
    expect(putMock).toHaveBeenCalledTimes(2);

    // Check first event (small)
    const smallEventCall = putMock.mock.calls.find(call => call[0].id === '1');
    expect(smallEventCall[0].payload).toEqual({ size: 'small' });
    expect(smallEventCall[0].s3Reference).toBeUndefined();
    expect(smallEventCall[1]).toEqual(expect.objectContaining({
      condition: expect.objectContaining({ name: 'attribute_not_exists', subject: 'id' })
    }));

    // Check second event (large)
    const largeEventCall = putMock.mock.calls.find(call => call[0].id === '2');
    expect(largeEventCall[0].payload).toBeUndefined();
    expect(largeEventCall[0].s3Reference).toBe('bucket::events/2.json');
    expect(largeEventCall[1]).toEqual(expect.objectContaining({
      condition: expect.objectContaining({ name: 'attribute_not_exists', subject: 'id' })
    }));
  });

  it('retrieves full events from S3 when a reference is present', async () => {
    const s3 = createS3Client();
    const repo = new EventStoreRepo({} as any, s3 as any, {
      tableNamePrefix: 'prefix',
      s3BucketName: 'bucket',
    });

    const fullEvent = await repo.getFullEvent({ s3Reference: 'bucket::events/1.json' } as any);

    expect(s3.getObject).toHaveBeenCalledWith({ Bucket: 'bucket', Key: 'events/1.json' });
    expect(fullEvent).toEqual({ restored: true });
  });

  it('creates an iterator for fetching all events', async () => {
    const s3 = createS3Client();
    const repo = new EventStoreRepo({} as any, s3 as any, {
      tableNamePrefix: 'prefix',
      s3BucketName: 'bucket',
    });

    const iterator = await repo.getAllEvents(25);

    expect(iteratorConstructorMock).toHaveBeenCalledWith(repo, 25);
    expect(iteratorInitMock).toHaveBeenCalledTimes(1);
    expect(iterator).toBe(iteratorInstanceMock);
  });

  it('resets the store by deleting and recreating the table', async () => {
    const s3 = createS3Client();
    const repo = new EventStoreRepo({} as any, s3 as any, {
      tableNamePrefix: 'prefix',
      s3BucketName: 'bucket',
    });

    await repo.resetStore();

    expect(deleteTableMock).toHaveBeenCalledWith(EventStoreEntity);
    expect(ensureTableExistsMock).toHaveBeenCalledTimes(1);
  });
});
