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

  put(obj: Partial<T>, options?: PutOptions): Promise<T> {
    return this.dataMapper.put(Object.assign(new this.EntityClass(), obj, options));
  }

  get(obj: Partial<T>, options?: GetOptions): Promise<T | undefined> {
    return this.dataMapper.get(Object.assign(new this.EntityClass(), obj), options).catch((e) => {
      if (e.name === 'ItemNotFoundException') return undefined;
      else throw e;
    });
  }

  update(obj: Partial<T>, options?: UpdateOptions): Promise<T> {
    return this.dataMapper.update(Object.assign(new this.EntityClass(), obj, options));
  }

  delete(obj: Partial<T>, options?: DeleteOptions): Promise<T> {
    return this.dataMapper.delete(Object.assign(new this.EntityClass(), obj, options));
  }

  scan(options?: ScanOptions | ParallelScanWorkerOptions): ScanIterator<T> {
    return this.dataMapper.scan(this.EntityClass, options);
  }

  query(
    keyCondition:
      | ConditionExpression
      | {
          [propertyName: string]: ConditionExpressionPredicate | any;
        },
    options?: QueryOptions
  ): QueryIterator<T> {
    return this.dataMapper.query(this.EntityClass, keyCondition, options);
  }

  batchPut(objs: Array<Partial<T>>): AsyncIterableIterator<T> {
    return this.dataMapper.batchPut(objs.map((obj) => Object.assign(new this.EntityClass(), obj)));
  }

  batchGet(objs: Array<Partial<T>>): AsyncIterableIterator<T> {
    return this.dataMapper.batchGet(objs.map((obj) => Object.assign(new this.EntityClass(), obj)));
  }

  async batchDelete(objs: Array<Partial<T>>): Promise<AsyncIterableIterator<T>> {
    return this.dataMapper.batchGet(objs.map((obj) => Object.assign(new this.EntityClass(), obj)));
  }

  createTable(): Promise<void> {
    return this.dataMapper.createTable(this.EntityClass, (this.EntityClass as any).prototype[createTableOptionsKey]);
  }

  ensureTableExists(): Promise<void> {
    return this.dataMapper.ensureTableExists(
      this.EntityClass,
      (this.EntityClass as any).prototype[createTableOptionsKey]
    );
  }

  deleteTable(): Promise<void> {
    return this.dataMapper.deleteTable(this.EntityClass);
  }

  ensureTableNotExists(): Promise<void> {
    return this.dataMapper.ensureTableNotExists(this.EntityClass);
  }
}
