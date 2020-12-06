import { CreateTableOptions } from '@aws/dynamodb-data-mapper/build/namedParameters';

export const createTableOptionsKey = '##createTableOption';
export const tableNameKey = '##tableName';

export const repo = (tableName: string, createTableOptions: CreateTableOptions) => (constructor: any) => {
  constructor.prototype[createTableOptionsKey] = createTableOptions;
  constructor.prototype[tableNameKey] = tableName;
  return constructor;
};
