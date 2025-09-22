import { makeGetDynamoDbManager } from './getDynamodbManager';
import { tableNameKey } from './dynamodb.repo.decorator';
import { DynamodbManager } from './dynamodb.manager';

jest.mock('./dynamodb.manager');

const mockedManager = DynamodbManager as jest.MockedClass<typeof DynamodbManager>;

class EntityA {}
EntityA.prototype[tableNameKey] = 'entityA';

class EntityB {}
EntityB.prototype[tableNameKey] = 'entityB';

describe('makeGetDynamoDbManager', () => {
  let instances: Array<{ init: jest.Mock } & Record<string, unknown>>;

  beforeEach(() => {
    instances = [];
    mockedManager.mockReset();
    mockedManager.mockImplementation(() => {
      const instance = { init: jest.fn().mockResolvedValue(undefined) } as any;
      instances.push(instance);
      return instance;
    });
  });

  it('creates a manager and initializes it on first access', async () => {
    const getManager = makeGetDynamoDbManager('prefix', { region: 'test' } as any);

    const manager = await getManager(EntityA);

    expect(manager).toBe(instances[0]);
    expect(instances[0].init).toHaveBeenCalledTimes(1);
    expect(mockedManager).toHaveBeenCalledWith('prefix', EntityA, { region: 'test' });
  });

  it('caches managers per entity table name', async () => {
    const getManager = makeGetDynamoDbManager('prefix', {} as any);

    const first = await getManager(EntityA);
    const second = await getManager(EntityA);

    expect(first).toBe(second);
    expect(mockedManager).toHaveBeenCalledTimes(1);
    expect(instances[0].init).toHaveBeenCalledTimes(1);
  });

  it('creates separate managers for different entities', async () => {
    const getManager = makeGetDynamoDbManager('prefix', {} as any);

    const [first, second] = await Promise.all([getManager(EntityA), getManager(EntityB)]);

    expect(first).not.toBe(second);
    expect(mockedManager).toHaveBeenCalledTimes(2);
  });
});
