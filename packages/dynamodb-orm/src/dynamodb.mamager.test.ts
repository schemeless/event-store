import { makeGetDynamoDbManager } from './getDynamodbManager';

describe('dynamodb manager', () => {
  it('should make typescript type happy', async () => {
    interface TestType {
      a: string;
      b: number;
    }

    class Test implements TestType {
      a: string;
      b: number;
    }
    const getDynamoDbManager = makeGetDynamoDbManager('dev', {});
    const manager = await getDynamoDbManager<TestType>(Test);
    const repo = manager.repo;
    const a = await repo.get({ a: '1' });
  });
});
