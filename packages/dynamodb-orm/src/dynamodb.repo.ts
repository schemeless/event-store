import type { QueryOptions, ScanOptions } from '@aws/dynamodb-data-mapper/build/namedParameters';
import type { DataMapper, QueryIterator } from '@aws/dynamodb-data-mapper';
import type { ScanIterator } from '@aws/dynamodb-data-mapper/build/ScanIterator';
import { createTableOptionsKey } from './dynamodb.repo.decorator';
import { Class } from './utils';

export class DynamodbRepo<T extends Class> {
  constructor(public Entity: T, public dataMapper: DataMapper) {
    if (!(this.Entity as any).prototype[createTableOptionsKey]) {
      throw new Error(`@repo decorator is required for ${Entity.toString()}`);
    }
  }

  async put(obj: Partial<T>): Promise<T> {
    return this.dataMapper.put(Object.assign(new this.Entity(), obj));
  }

  async get(obj: Partial<T>): Promise<T> {
    return this.dataMapper.get(Object.assign(new this.Entity(), obj));
  }

  async update(obj: Partial<T>): Promise<T> {
    return this.dataMapper.update(Object.assign(new this.Entity(), obj));
  }

  async delete(obj: Partial<T>): Promise<T> {
    return this.dataMapper.delete(Object.assign(new this.Entity(), obj));
  }

  async scan(options: ScanOptions): Promise<ScanIterator<T>> {
    return this.dataMapper.scan(this.Entity, options);
  }

  async query(queryOptions: QueryOptions): Promise<QueryIterator<T>> {
    return this.dataMapper.query(this.Entity, queryOptions);
  }

  async batchPut(objs: Array<Partial<T>>): Promise<AsyncIterableIterator<T>> {
    return this.dataMapper.batchPut(objs.map((obj) => Object.assign(new this.Entity(), obj)));
  }

  async batchGet(objs: Array<Partial<T>>): Promise<AsyncIterableIterator<T>> {
    return this.dataMapper.batchGet(objs.map((obj) => Object.assign(new this.Entity(), obj)));
  }

  async batchDelete(objs: Array<Partial<T>>): Promise<AsyncIterableIterator<T>> {
    return this.dataMapper.batchGet(objs.map((obj) => Object.assign(new this.Entity(), obj)));
  }

  async createTable(): Promise<void> {
    return this.dataMapper.createTable(this.Entity, (this.Entity as any).prototype[createTableOptionsKey]);
  }

  async ensureTableExists(): Promise<void> {
    return this.dataMapper.ensureTableExists(this.Entity, (this.Entity as any).prototype[createTableOptionsKey]);
  }

  async deleteTable(): Promise<void> {
    return this.dataMapper.deleteTable(this.Entity);
  }

  async ensureTableNotExists(): Promise<void> {
    return this.dataMapper.ensureTableNotExists(this.Entity);
  }
}
