import type { QueryOptions, ScanOptions } from '@aws/dynamodb-data-mapper/build/namedParameters';
import type { DataMapper, QueryIterator } from '@aws/dynamodb-data-mapper';
import type { ScanIterator } from '@aws/dynamodb-data-mapper/build/ScanIterator';
import { createTableOptionsKey } from './dynamodb.repo.decorator';
import { Class } from './utils';
import { ConditionExpression, ConditionExpressionPredicate } from '@aws/dynamodb-expressions';
import {
  DeleteOptions,
  GetOptions,
  ParallelScanWorkerOptions,
  PutOptions,
  UpdateOptions,
} from '@aws/dynamodb-data-mapper/build/namedParameters';

export class DynamodbRepo<T> {
  EntityClass: Class;

  constructor(public Entity: T, public dataMapper: DataMapper) {
    if (!(this.Entity as any).prototype[createTableOptionsKey]) {
      throw new Error(`@repo decorator is required for ${Entity.toString()}`);
    }
    this.EntityClass = Entity as any;
  }

  async put(obj: Partial<T>, options?: PutOptions): Promise<T> {
    return this.dataMapper.put(Object.assign(new this.EntityClass(), obj, options));
  }

  async get(obj: Partial<T>, options?: GetOptions): Promise<T> {
    return this.dataMapper.get(Object.assign(new this.EntityClass(), obj), options);
  }

  async update(obj: Partial<T>, options?: UpdateOptions): Promise<T> {
    return this.dataMapper.update(Object.assign(new this.EntityClass(), obj, options));
  }

  async delete(obj: Partial<T>, options?: DeleteOptions): Promise<T> {
    return this.dataMapper.delete(Object.assign(new this.EntityClass(), obj, options));
  }

  async scan(options?: ScanOptions | ParallelScanWorkerOptions): Promise<ScanIterator<T>> {
    return this.dataMapper.scan(this.EntityClass, options);
  }

  async query(
    keyCondition:
      | ConditionExpression
      | {
          [propertyName: string]: ConditionExpressionPredicate | any;
        },
    options?: QueryOptions
  ): Promise<QueryIterator<T>> {
    return this.dataMapper.query(this.EntityClass, keyCondition, options);
  }

  async batchPut(objs: Array<Partial<T>>): Promise<AsyncIterableIterator<T>> {
    return this.dataMapper.batchPut(objs.map((obj) => Object.assign(new this.EntityClass(), obj)));
  }

  async batchGet(objs: Array<Partial<T>>): Promise<AsyncIterableIterator<T>> {
    return this.dataMapper.batchGet(objs.map((obj) => Object.assign(new this.EntityClass(), obj)));
  }

  async batchDelete(objs: Array<Partial<T>>): Promise<AsyncIterableIterator<T>> {
    return this.dataMapper.batchGet(objs.map((obj) => Object.assign(new this.EntityClass(), obj)));
  }

  async createTable(): Promise<void> {
    return this.dataMapper.createTable(this.EntityClass, (this.EntityClass as any).prototype[createTableOptionsKey]);
  }

  async ensureTableExists(): Promise<void> {
    return this.dataMapper.ensureTableExists(
      this.EntityClass,
      (this.EntityClass as any).prototype[createTableOptionsKey]
    );
  }

  async deleteTable(): Promise<void> {
    return this.dataMapper.deleteTable(this.EntityClass);
  }

  async ensureTableNotExists(): Promise<void> {
    return this.dataMapper.ensureTableNotExists(this.EntityClass);
  }
}
