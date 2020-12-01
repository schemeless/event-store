import { ClientConfiguration } from 'aws-sdk/clients/dynamodb';
import { DataMapper } from '@aws/dynamodb-data-mapper';
import * as Dynamodb from 'aws-sdk/clients/dynamodb';
import { DynamodbRepo } from './dynamodb.repo';
import { Class } from './utils';

export class DynamodbManager<T extends Class> {
  public client: Dynamodb;
  public dataMapper: DataMapper;
  public repo: DynamodbRepo<T>;

  constructor(private tableNamePrefix: string, public Entity: T, private clientConfiguration: ClientConfiguration) {
    this.client = new Dynamodb(clientConfiguration);
    this.dataMapper = new DataMapper({
      client: this.client as any,
      tableNamePrefix: this.tableNamePrefix,
    });
    this.repo = new DynamodbRepo<T>(this.Entity, this.dataMapper);
  }

  async init() {
    await this.repo.ensureTableExists();
  }
}
