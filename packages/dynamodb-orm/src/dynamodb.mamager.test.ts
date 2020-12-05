import { makeGetDynamoDbManager } from './getDynamodbManager';
import { repo } from './dynamodb.repo.decorator';
import { attribute, hashKey, table } from '@aws/dynamodb-data-mapper-annotations';

interface TestType {
  a: string;
  b: string;
}

@repo('test', {
  readCapacityUnits: 10,
  writeCapacityUnits: 10,
})
@table('test')
class Test implements TestType {
  @hashKey({ type: 'String' })
  a: string;

  @attribute({ type: 'String' })
  b: string;
}

const getDynamoDbManager = makeGetDynamoDbManager('test', {
  region: 'test',
  endpoint: 'http://127.0.0.1:8000',
});

describe('dynamodb manager', () => {
  it('should not throw error on get item not found', async () => {
    const manager = await getDynamoDbManager<TestType>(Test);
    const repo = manager.repo;
    const result = await repo.get({ a: '0' });
    expect(result).toBeUndefined();
  });

  it('should normally get item', async () => {
    const manager = await getDynamoDbManager<TestType>(Test);
    const repo = manager.repo;
    await repo.put({
      a: 'found',
      b: 'test',
    });
    const result = await repo.get({ a: 'found' });
    expect(result.a).toBe('found');
    expect(result.b).toBe('test');
  });
});
