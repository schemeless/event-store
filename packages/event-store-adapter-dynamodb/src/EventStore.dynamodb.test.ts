import 'reflect-metadata';

import { EventStoreRepo } from './EventStore.dynamodb.repo';
import { EventStoreEntity } from './EventStore.dynamodb.entity';

const sendMock = jest.fn();
const uploadMock = jest.fn();
const doneMock = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({
    send: sendMock,
  })),
  DescribeTableCommand: jest.fn(),
  CreateTableCommand: jest.fn(),
  DeleteTableCommand: jest.fn(),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockImplementation(() => ({
      send: sendMock,
    })),
  },
  PutCommand: jest.fn(),
  GetCommand: jest.fn(),
  QueryCommand: jest.fn(),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: sendMock,
  })),
  HeadBucketCommand: jest.fn(),
  CreateBucketCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
}));

jest.mock('@aws-sdk/lib-storage', () => ({
  Upload: jest.fn().mockImplementation(() => ({
    done: doneMock,
  })),
}));

jest.mock('./EventStore.dynamodb.entity', () => {
  const original = jest.requireActual('./EventStore.dynamodb.entity');
  return {
    ...original,
    EventStoreEntity: class extends original.EventStoreEntity {
      generateTimeBucket = jest.fn();
    },
  };
});

const iteratorInitMock = jest.fn();
const iteratorInstanceMock = { init: iteratorInitMock } as any;
let iteratorConstructorMock: jest.Mock;

jest.mock('./EventStore.dynamodb.iterator', () => ({
  EventStoreDynamodbIterator: function (...args: any[]) {
    return iteratorConstructorMock(...args);
  },
}));

const sizeofMock = jest.fn();
jest.mock('object-sizeof', () => ({
  default: (...args: any[]) => sizeofMock(...args),
  __esModule: true,
}));

describe('EventStoreRepo', () => {
  beforeEach(() => {
    sendMock.mockReset();
    uploadMock.mockReset();
    doneMock.mockReset();
    iteratorConstructorMock = jest.fn().mockImplementation(() => iteratorInstanceMock);
    iteratorInitMock.mockReset();
    sizeofMock.mockReset();
  });

  it('initializes the DynamoDB table and S3 bucket', async () => {
    const ddb = { send: sendMock };
    const s3 = { send: sendMock };
    const repo = new EventStoreRepo(ddb as any, s3 as any, {
      tableNamePrefix: 'prefix',
      s3BucketName: 'bucket',
    });

    sendMock.mockImplementation((command) => {
      if (command.constructor.name === 'DescribeTableCommand') {
        throw { name: 'ResourceNotFoundException' };
      }
      return Promise.resolve({});
    });

    await repo.init();

    expect(sendMock).toHaveBeenCalled();
  });

  it('stores events and offloads oversized payloads to S3', async () => {
    const ddb = { send: sendMock };
    const s3 = { send: sendMock };
    sizeofMock.mockImplementation((event: any) => (event.id === '2' ? 400000 : 1000));
    sendMock.mockResolvedValue({});
    doneMock.mockResolvedValue({});

    const repo = new EventStoreRepo(ddb as any, s3 as any, {
      tableNamePrefix: 'prefix',
      s3BucketName: 'bucket',
    });

    const events = [
      { id: '1', domain: 'user', type: 'created', payload: { size: 'small' }, created: new Date() },
      { id: '2', domain: 'user', type: 'created', payload: { size: 'large' }, created: new Date() },
    ];

    await repo.storeEvents(events as any);

    expect(sizeofMock).toHaveBeenCalledTimes(2);
    expect(doneMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalled();
  });

  it('retrieves full events from S3 when a reference is present', async () => {
    const ddb = { send: sendMock };
    const s3 = { send: sendMock };
    const repo = new EventStoreRepo(ddb as any, s3 as any, {
      tableNamePrefix: 'prefix',
      s3BucketName: 'bucket',
    });

    sendMock.mockResolvedValue({
      Body: {
        transformToString: jest.fn().mockResolvedValue(JSON.stringify({ restored: true })),
      },
    });

    const fullEvent = await repo.getFullEvent({ s3Reference: 'bucket::events/1.json' } as any);

    expect(fullEvent).toEqual({ restored: true });
  });

  it('creates an iterator for fetching all events', async () => {
    const ddb = { send: sendMock };
    const s3 = { send: sendMock };
    const repo = new EventStoreRepo(ddb as any, s3 as any, {
      tableNamePrefix: 'prefix',
      s3BucketName: 'bucket',
    });

    const iterator = await repo.getAllEvents(25);

    expect(iteratorConstructorMock).toHaveBeenCalledWith(repo, 25);
    expect(iteratorInitMock).toHaveBeenCalledTimes(1);
    expect(iterator).toBe(iteratorInstanceMock);
  });

  it('resets the store by deleting and recreating the table', async () => {
    const ddb = { send: sendMock };
    const s3 = { send: sendMock };
    const repo = new EventStoreRepo(ddb as any, s3 as any, {
      tableNamePrefix: 'prefix',
      s3BucketName: 'bucket',
    });

    sendMock.mockResolvedValue({});

    await repo.resetStore();

    expect(sendMock).toHaveBeenCalled();
  });
});
