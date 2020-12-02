import { makeGetDynamoDbManager } from './getDynamodbManager';

describe('dynamodb manager', () => {
  it('should make typescript type happy', async () => {
    class Test {
      a: string;
      b: number;
    }
    const getDynamoDbManager = makeGetDynamoDbManager<typeof Test>('dev', {});
    const manager = await getDynamoDbManager(Test);
    const repo = manager.repo;
    await repo.get({ a: 1 });
  });
});
