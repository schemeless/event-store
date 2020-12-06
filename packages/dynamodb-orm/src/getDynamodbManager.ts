import * as AsyncLock from 'async-lock';
import { ClientConfiguration } from 'aws-sdk/clients/dynamodb';
import { DynamodbManager } from './dynamodb.manager';
import { tableNameKey } from './dynamodb.repo.decorator';
import { StringToAnyObjectMap } from '@aws/dynamodb-data-mapper/build/constants';

export const makeGetDynamoDbManager = (
  tableNamePrefix: string,
  clientConfiguration: ClientConfiguration
): (<T>(entity: any) => Promise<DynamodbManager<T>>) => {
  const lock = new AsyncLock();
  const map: { [key: string]: DynamodbManager<any> } = {};

  return async <T extends StringToAnyObjectMap = StringToAnyObjectMap>(entity: any) => {
    const key = (entity as any).prototype[tableNameKey] as string;
    if (map[key]) return map[key];
    await lock.acquire(tableNameKey, async () => {
      const dynamoDbManager = new DynamodbManager(tableNamePrefix, entity, clientConfiguration);
      await dynamoDbManager.init();
      map[key] = dynamoDbManager;
      return dynamoDbManager;
    });
    return map[key];
  };
};
