import * as AsyncLock from 'async-lock';
import { ClientConfiguration } from 'aws-sdk/clients/dynamodb';
import { DynamodbManager } from './dynamodb.manager';
import { Class } from './utils';
import { tableName } from './dynamodb.repo.decorator';

const makeGetDynamoDbManager = <T extends Class>(tableNamePrefix: string, clientConfiguration: ClientConfiguration) => {
  const lock = new AsyncLock();
  const map: { [key: string]: DynamodbManager<any> } = {};

  return async (entity: T) => {
    const key = (entity as any)[tableName] as string;
    if (map[key]) return map[key];
    await lock.acquire(tableName, async () => {
      const dynamoDbManager = new DynamodbManager(tableNamePrefix, entity, clientConfiguration);
      await dynamoDbManager.init();
      map[key] = dynamoDbManager;
      return dynamoDbManager;
    });
    return map[key];
  };
};
