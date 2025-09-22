import 'reflect-metadata';

import { EventStoreRepo } from './EventStore.dynamodb.repo';
import { EventStoreEntity } from './EventStore.dynamodb.entity';

const ensureTableExistsMock = jest.fn();
const scanMock = jest.fn();
const batchPutMock = jest.fn();
const batchGetMock = jest.fn();
const deleteTableMock = jest.fn();

let dataMapperConstructorMock: jest.Mock;

jest.mock('@aws/dynamodb-data-mapper', () => ({
  DataMapper: function (...args: any[]) {
    return dataMapperConstructorMock(...args);
  },
}));

jest.mock('./EventStore.dynamodb.entity', () => ({
  EventStoreEntity: class EventStoreEntity {},
  dateIndexName: 'eventCreated',
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
    batchGetMock.mockReset();
    deleteTableMock.mockReset();
    dataMapperConstructorMock = jest.fn().mockImplementation(() => ({
      ensureTableExists: ensureTableExistsMock,
      scan: scanMock,
      batchPut: batchPutMock,
      batchGet: batchGetMock,
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
      expect.objectContaining({ readCapacityUnits: expect.any(Number) })
    );
    expect(s3.headBucket).toHaveBeenCalledWith({ Bucket: 'bucket' });
    expect(s3.createBucket).toHaveBeenCalledWith({ Bucket: 'bucket' });

    await repo.init();
    expect(ensureTableExistsMock).toHaveBeenCalledTimes(1);
    expect(s3.headBucket).toHaveBeenCalledTimes(1);

    await repo.init(true);
    expect(ensureTableExistsMock).toHaveBeenCalledTimes(2);
  });

  it('stores events and offloads oversized payloads to S3', async () => {
    const s3 = createS3Client();
    sizeofMock.mockImplementation((event: any) => (event.id === '2' ? 400000 : 1000));
    batchPutMock.mockImplementation(() => (async function* () {
      return;
    })());

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

    expect(batchPutMock).toHaveBeenCalledTimes(1);
    const savedEvents = batchPutMock.mock.calls[0][0];
    const largeEvent = savedEvents.find((event: EventStoreEntity) => event.id === '2');
    const smallEvent = savedEvents.find((event: EventStoreEntity) => event.id === '1');

    expect(largeEvent.payload).toBeUndefined();
    expect(largeEvent.s3Reference).toBe('bucket::events/2.json');
    expect(smallEvent.payload).toEqual({ size: 'small' });
    expect(smallEvent.s3Reference).toBeUndefined();
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

    const originalEvent = { id: 'no-ref' } as any;
    expect(await repo.getFullEvent(originalEvent)).toBe(originalEvent);
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
